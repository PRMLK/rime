package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/unicode/norm"

	"rime/backend/internal/id"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrInvalidInput       = errors.New("invalid identity input")
	ErrSetupComplete      = errors.New("setup is already complete")
	ErrUsernameExists     = errors.New("username already exists")
	ErrUserNotFound       = errors.New("user not found")
	ErrLastAdmin          = errors.New("the last active admin cannot be changed")
	ErrRateLimited        = errors.New("too many sign-in attempts")
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{3,32}$`)

type Repository interface {
	CountUsers(context.Context) (int, error)
	CreateInitialAdmin(context.Context, User, string, string) error
	CreateUser(context.Context, User, string, string) error
	UserByUsernameKey(context.Context, string) (Credential, error)
	UserBySessionHash(context.Context, string, time.Time) (User, error)
	CreateAuthSession(context.Context, string, string, time.Time, time.Time) error
	DeleteAuthSession(context.Context, string) error
	DeleteUserSessions(context.Context, string) error
	ListUsers(context.Context) ([]User, error)
	UpdateUser(context.Context, string, UpdateUserRequest, time.Time) (User, error)
	ResetUserPassword(context.Context, string, string, time.Time) error
	UpdateOwnPassword(context.Context, string, string, time.Time) error
	RecordLogin(context.Context, string, time.Time) error
}

type Service struct {
	repo          Repository
	now           func() time.Time
	setupMu       sync.Mutex
	loginMu       sync.Mutex
	loginFailures map[string]loginFailure
}

type loginFailure struct {
	count        int
	blockedUntil time.Time
}

func New(ctx context.Context, repo Repository) (*Service, error) {
	s := &Service{repo: repo, now: time.Now, loginFailures: make(map[string]loginFailure)}
	if _, err := repo.CountUsers(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Service) SetupRequired(ctx context.Context) (bool, error) {
	count, err := s.repo.CountUsers(ctx)
	return count == 0, err
}

func (s *Service) Setup(ctx context.Context, request SetupRequest) (Session, error) {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	required, err := s.SetupRequired(ctx)
	if err != nil {
		return Session{}, err
	}
	if !required {
		return Session{}, ErrSetupComplete
	}
	user, hash, favoriteID, err := newUser(request.Username, request.DisplayName, request.Password, RoleAdmin, false, s.now().UTC())
	if err != nil {
		return Session{}, err
	}
	if err := s.repo.CreateInitialAdmin(ctx, user, hash, favoriteID); err != nil {
		return Session{}, err
	}
	return s.newSession(ctx, user)
}

func (s *Service) Login(ctx context.Context, request LoginRequest) (Session, error) {
	key := usernameKey(request.Username)
	if s.loginBlocked(key) {
		return Session{}, ErrRateLimited
	}
	credential, err := s.repo.UserByUsernameKey(ctx, key)
	if err != nil {
		_, _ = hashPassword(request.Password)
		s.recordLoginFailure(key)
		return Session{}, ErrInvalidCredentials
	}
	if credential.Disabled || !verifyPassword(request.Password, credential.PasswordHash) {
		s.recordLoginFailure(key)
		return Session{}, ErrInvalidCredentials
	}
	s.loginMu.Lock()
	delete(s.loginFailures, key)
	s.loginMu.Unlock()
	now := s.now().UTC()
	_ = s.repo.RecordLogin(ctx, credential.ID, now)
	credential.LastLoginAt = &now
	return s.newSession(ctx, credential.User)
}

func (s *Service) loginBlocked(key string) bool {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	failure := s.loginFailures[key]
	if failure.blockedUntil.After(s.now()) {
		return true
	}
	if !failure.blockedUntil.IsZero() {
		delete(s.loginFailures, key)
	}
	return false
}

func (s *Service) recordLoginFailure(key string) {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	failure := s.loginFailures[key]
	failure.count++
	if failure.count >= 5 {
		failure.blockedUntil = s.now().Add(time.Minute)
	}
	s.loginFailures[key] = failure
}

func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrInvalidCredentials
	}
	return s.repo.UserBySessionHash(ctx, tokenHash(token), s.now().UTC())
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.repo.DeleteAuthSession(ctx, tokenHash(token))
}

func (s *Service) CreateUser(ctx context.Context, request CreateUserRequest) (User, error) {
	role := request.Role
	if role == "" {
		role = RoleUser
	}
	user, hash, favoriteID, err := newUser(request.Username, request.DisplayName, request.Password, role, true, s.now().UTC())
	if err != nil {
		return User{}, err
	}
	if err := s.repo.CreateUser(ctx, user, hash, favoriteID); err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Service) ListUsers(ctx context.Context) ([]User, error) { return s.repo.ListUsers(ctx) }

func (s *Service) UpdateUser(ctx context.Context, userID string, request UpdateUserRequest) (User, error) {
	if request.DisplayName != nil {
		name := strings.TrimSpace(*request.DisplayName)
		if name == "" || len([]rune(name)) > 40 {
			return User{}, fmt.Errorf("%w: displayName must contain 1 to 40 characters", ErrInvalidInput)
		}
		request.DisplayName = &name
	}
	if request.Role != nil && *request.Role != RoleAdmin && *request.Role != RoleUser {
		return User{}, fmt.Errorf("%w: role must be admin or user", ErrInvalidInput)
	}
	user, err := s.repo.UpdateUser(ctx, userID, request, s.now().UTC())
	if err == nil && (request.Role != nil || (request.Disabled != nil && *request.Disabled)) {
		_ = s.repo.DeleteUserSessions(ctx, userID)
	}
	return user, err
}

func (s *Service) ResetPassword(ctx context.Context, userID, password string) error {
	hash, err := hashPasswordValidated(password)
	if err != nil {
		return err
	}
	if err := s.repo.ResetUserPassword(ctx, userID, hash, s.now().UTC()); err != nil {
		return err
	}
	return s.repo.DeleteUserSessions(ctx, userID)
}

func (s *Service) ResetPasswordByUsername(ctx context.Context, username, password string) error {
	credential, err := s.repo.UserByUsernameKey(ctx, usernameKey(username))
	if err != nil || credential.Role != RoleAdmin {
		return ErrUserNotFound
	}
	return s.ResetPassword(ctx, credential.ID, password)
}

func (s *Service) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	// Resolve the current credential through the authenticated user's stable username.
	users, err := s.repo.ListUsers(ctx)
	if err != nil {
		return err
	}
	var username string
	for _, user := range users {
		if user.ID == userID {
			username = user.Username
			break
		}
	}
	credential, err := s.repo.UserByUsernameKey(ctx, usernameKey(username))
	if err != nil || !verifyPassword(currentPassword, credential.PasswordHash) {
		return ErrInvalidCredentials
	}
	hash, err := hashPasswordValidated(newPassword)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateOwnPassword(ctx, userID, hash, s.now().UTC()); err != nil {
		return err
	}
	return s.repo.DeleteUserSessions(ctx, userID)
}

func (s *Service) newSession(ctx context.Context, user User) (Session, error) {
	token, err := randomToken(32)
	if err != nil {
		return Session{}, err
	}
	createdAt := s.now().UTC()
	expiresAt := createdAt.Add(30 * 24 * time.Hour)
	if err := s.repo.CreateAuthSession(ctx, tokenHash(token), user.ID, createdAt, expiresAt); err != nil {
		return Session{}, err
	}
	return Session{Token: token, User: user, ExpiresAt: expiresAt}, nil
}

func newUser(username, displayName, password, role string, mustChange bool, now time.Time) (User, string, string, error) {
	username = strings.TrimSpace(username)
	displayName = strings.TrimSpace(displayName)
	if !usernamePattern.MatchString(username) {
		return User{}, "", "", fmt.Errorf("%w: username must be 3 to 32 letters, digits, dots, underscores, or hyphens", ErrInvalidInput)
	}
	if displayName == "" {
		displayName = username
	}
	if len([]rune(displayName)) > 40 {
		return User{}, "", "", fmt.Errorf("%w: displayName must contain at most 40 characters", ErrInvalidInput)
	}
	if role != RoleAdmin && role != RoleUser {
		return User{}, "", "", fmt.Errorf("%w: invalid role", ErrInvalidInput)
	}
	hash, err := hashPasswordValidated(password)
	if err != nil {
		return User{}, "", "", err
	}
	userID, err := id.New("usr")
	if err != nil {
		return User{}, "", "", err
	}
	favoriteID, err := id.New("pls")
	if err != nil {
		return User{}, "", "", err
	}
	return User{ID: userID, Username: username, DisplayName: displayName, Role: role, MustChangePassword: mustChange, CreatedAt: now}, hash, favoriteID, nil
}

func usernameKey(username string) string {
	return strings.ToLower(norm.NFKC.String(strings.TrimSpace(username)))
}

func hashPasswordValidated(password string) (string, error) {
	if len([]rune(password)) < 8 || len([]byte(password)) > 128 {
		return "", fmt.Errorf("%w: password must contain 8 to 128 characters", ErrInvalidInput)
	}
	return hashPassword(password)
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 2, 19*1024, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=19456,t=2,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	params := strings.Split(parts[3], ",")
	if len(params) != 3 {
		return false
	}
	memory, errM := strconv.Atoi(strings.TrimPrefix(params[0], "m="))
	iterations, errT := strconv.Atoi(strings.TrimPrefix(params[1], "t="))
	parallelism, errP := strconv.Atoi(strings.TrimPrefix(params[2], "p="))
	salt, errS := base64.RawStdEncoding.DecodeString(parts[4])
	want, errH := base64.RawStdEncoding.DecodeString(parts[5])
	if errM != nil || errT != nil || errP != nil || errS != nil || errH != nil || memory < 1 || iterations < 1 || parallelism < 1 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, uint32(iterations), uint32(memory), uint8(parallelism), uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func randomToken(size int) (string, error) {
	random := make([]byte, size)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(random), nil
}

func tokenHash(token string) string {
	hash := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

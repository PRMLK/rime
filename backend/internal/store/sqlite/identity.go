package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"rime/backend/internal/identity"
)

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

func (s *Store) CreateInitialAdmin(ctx context.Context, user identity.User, passwordHash, favoriteID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return identity.ErrSetupComplete
	}
	if err := insertUserAndFavorites(ctx, tx, user, passwordHash, favoriteID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CreateUser(ctx context.Context, user identity.User, passwordHash, favoriteID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertUserAndFavorites(ctx, tx, user, passwordHash, favoriteID); err != nil {
		return err
	}
	return tx.Commit()
}

func insertUserAndFavorites(ctx context.Context, tx *sql.Tx, user identity.User, passwordHash, favoriteID string) error {
	now := user.CreatedAt.UTC().Format(time.RFC3339Nano)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO users(id, username, username_key, display_name, password_hash, role, disabled, must_change_password, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, user.ID, user.Username, normalized(user.Username), user.DisplayName,
		passwordHash, user.Role, user.Disabled, user.MustChangePassword, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "users.username_key") {
			return identity.ErrUsernameExists
		}
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO playlists(id, owner_user_id, name, kind, created_at, updated_at) VALUES(?, ?, '我喜欢的音乐', 'favorites', ?, ?)`, favoriteID, user.ID, now, now)
	return err
}

func (s *Store) UserByUsernameKey(ctx context.Context, key string) (identity.Credential, error) {
	return scanCredential(s.db.QueryRowContext(ctx, `
		SELECT id, username, display_name, password_hash, role, disabled, must_change_password, created_at, last_login_at
		FROM users WHERE username_key = ?`, key))
}

func (s *Store) UserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (identity.User, error) {
	credential, err := scanCredential(s.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.display_name, u.password_hash, u.role, u.disabled, u.must_change_password, u.created_at, u.last_login_at
		FROM auth_sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`, tokenHash, now.Format(time.RFC3339Nano)))
	if errors.Is(err, sql.ErrNoRows) {
		return identity.User{}, identity.ErrInvalidCredentials
	}
	return credential.User, err
}

func (s *Store) CreateAuthSession(ctx context.Context, tokenHash, userID string, createdAt, expiresAt time.Time) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at <= ?`, createdAt.Format(time.RFC3339Nano)); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO auth_sessions(token_hash, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)`,
		tokenHash, userID, createdAt.Format(time.RFC3339Nano), expiresAt.Format(time.RFC3339Nano))
	return err
}

func (s *Store) DeleteAuthSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE user_id = ?`, userID)
	return err
}

func (s *Store) ListUsers(ctx context.Context) ([]identity.User, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, username, display_name, role, disabled, must_change_password, created_at, last_login_at
		FROM users ORDER BY disabled, role = 'admin' DESC, username_key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []identity.User{}
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) UpdateUser(ctx context.Context, userID string, request identity.UpdateUserRequest, now time.Time) (identity.User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return identity.User{}, err
	}
	defer tx.Rollback()
	credential, err := scanCredential(tx.QueryRowContext(ctx, `
		SELECT id, username, display_name, password_hash, role, disabled, must_change_password, created_at, last_login_at FROM users WHERE id = ?`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return identity.User{}, identity.ErrUserNotFound
	}
	if err != nil {
		return identity.User{}, err
	}
	updated := credential.User
	if request.DisplayName != nil {
		updated.DisplayName = *request.DisplayName
	}
	if request.Role != nil {
		updated.Role = *request.Role
	}
	if request.Disabled != nil {
		updated.Disabled = *request.Disabled
	}
	if credential.Role == identity.RoleAdmin && !credential.Disabled && (updated.Role != identity.RoleAdmin || updated.Disabled) {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0`).Scan(&count); err != nil {
			return identity.User{}, err
		}
		if count <= 1 {
			return identity.User{}, identity.ErrLastAdmin
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE users SET display_name = ?, role = ?, disabled = ?, updated_at = ? WHERE id = ?`,
		updated.DisplayName, updated.Role, updated.Disabled, now.Format(time.RFC3339Nano), userID)
	if err != nil {
		return identity.User{}, err
	}
	if err := tx.Commit(); err != nil {
		return identity.User{}, err
	}
	return updated, nil
}

func (s *Store) ResetUserPassword(ctx context.Context, userID, passwordHash string, now time.Time) error {
	result, err := s.db.ExecContext(ctx, `UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?`, passwordHash, now.Format(time.RFC3339Nano), userID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Store) UpdateOwnPassword(ctx context.Context, userID, passwordHash string, now time.Time) error {
	result, err := s.db.ExecContext(ctx, `UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`, passwordHash, now.Format(time.RFC3339Nano), userID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Store) RecordLogin(ctx context.Context, userID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET last_login_at = ? WHERE id = ?`, now.Format(time.RFC3339Nano), userID)
	return err
}

type rowScanner interface{ Scan(...any) error }

func scanCredential(row rowScanner) (identity.Credential, error) {
	var credential identity.Credential
	var createdAt string
	var lastLogin sql.NullString
	err := row.Scan(&credential.ID, &credential.Username, &credential.DisplayName, &credential.PasswordHash, &credential.Role,
		&credential.Disabled, &credential.MustChangePassword, &createdAt, &lastLogin)
	if err != nil {
		return identity.Credential{}, err
	}
	if err := populateUserTimes(&credential.User, createdAt, lastLogin); err != nil {
		return identity.Credential{}, err
	}
	return credential, nil
}

func scanUser(row rowScanner) (identity.User, error) {
	var user identity.User
	var createdAt string
	var lastLogin sql.NullString
	err := row.Scan(&user.ID, &user.Username, &user.DisplayName, &user.Role, &user.Disabled, &user.MustChangePassword, &createdAt, &lastLogin)
	if err != nil {
		return identity.User{}, err
	}
	if err := populateUserTimes(&user, createdAt, lastLogin); err != nil {
		return identity.User{}, err
	}
	return user, nil
}

func populateUserTimes(user *identity.User, createdAt string, lastLogin sql.NullString) error {
	created, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return err
	}
	user.CreatedAt = created
	if lastLogin.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, lastLogin.String)
		if err != nil {
			return err
		}
		user.LastLoginAt = &parsed
	}
	return nil
}

func requireAffected(result sql.Result) error {
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return identity.ErrUserNotFound
	}
	return nil
}

package v1

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"rime/backend/internal/identity"
	"rime/backend/internal/playlists"
)

const sessionCookieName = "rime_session"

type userContextKey struct{}

func authenticationMiddleware(handler *Handler, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isPublicRoute(r) {
			next.ServeHTTP(w, r)
			return
		}
		token, fromCookie := authenticationToken(r)
		if token == "" {
			writeProblem(w, r, http.StatusUnauthorized, "authentication_required", "Authentication required", "Please sign in to continue.")
			return
		}
		user, err := handler.identity.Authenticate(r.Context(), token)
		if err != nil {
			if fromCookie {
				clearSessionCookie(w, r)
			}
			writeProblem(w, r, http.StatusUnauthorized, "session_invalid", "Session expired", "Please sign in again.")
			return
		}
		if user.MustChangePassword && !(r.Method == http.MethodPatch && r.URL.Path == "/api/v1/me/password") && !(r.Method == http.MethodDelete && r.URL.Path == "/api/v1/auth/session") && !(r.Method == http.MethodGet && r.URL.Path == "/api/v1/me") {
			writeProblem(w, r, http.StatusForbidden, "password_change_required", "Password change required", "Change your temporary password before continuing.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func isPublicRoute(r *http.Request) bool {
	return r.URL.Path == "/healthz" ||
		(r.Method == http.MethodGet && r.URL.Path == "/api/v1/system/info") ||
		((r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, "/api/v1/playback/sessions/") && strings.HasSuffix(r.URL.Path, "/stream")) ||
		(r.Method == http.MethodGet && r.URL.Path == "/api/v1/auth/status") ||
		(r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/setup") ||
		(r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/login") ||
		(r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/token/setup") ||
		(r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/token")
}

func bearerToken(r *http.Request) string {
	scheme, token, ok := strings.Cut(strings.TrimSpace(r.Header.Get("Authorization")), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func hasBearerToken(r *http.Request) bool {
	return bearerToken(r) != ""
}

func authenticationToken(r *http.Request) (string, bool) {
	if token := bearerToken(r); token != "" {
		return token, false
	}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return "", false
	}
	return cookie.Value, true
}

func currentUser(r *http.Request) identity.User {
	user, _ := r.Context().Value(userContextKey{}).(identity.User)
	return user
}

func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if currentUser(r).Role == identity.RoleAdmin {
		return true
	}
	writeProblem(w, r, http.StatusForbidden, "admin_required", "Administrator required", "This action is only available to administrators.")
	return false
}

func (h *Handler) authStatus(w http.ResponseWriter, r *http.Request) {
	required, err := h.identity.SetupRequired(r.Context())
	if err != nil {
		h.logger.Error("read setup status", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "Authentication status could not be loaded.")
		return
	}
	response := map[string]any{"setupRequired": required, "authenticated": false}
	if !required {
		if token, _ := authenticationToken(r); token != "" {
			if user, err := h.identity.Authenticate(r.Context(), token); err == nil {
				response["authenticated"] = true
				response["user"] = user
			}
		}
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) setupAdmin(w http.ResponseWriter, r *http.Request) {
	var request identity.SetupRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	session, err := h.identity.Setup(r.Context(), request)
	if err != nil {
		handleIdentityError(w, r, err)
		return
	}
	setSessionCookie(w, r, session)
	w.Header().Set("Location", "/api/v1/me")
	writeJSON(w, http.StatusCreated, session.User)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var request identity.LoginRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	session, err := h.identity.Login(r.Context(), request)
	if err != nil {
		if errors.Is(err, identity.ErrRateLimited) {
			w.Header().Set("Retry-After", "60")
			writeProblem(w, r, http.StatusTooManyRequests, "login_rate_limited", "Try again later", "Too many sign-in attempts. Wait one minute and try again.")
			return
		}
		if errors.Is(err, identity.ErrInvalidCredentials) {
			writeProblem(w, r, http.StatusUnauthorized, "invalid_credentials", "Sign in failed", "The username or password is incorrect.")
			return
		}
		h.logger.Error("login", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "Sign in could not be completed.")
		return
	}
	setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, session.User)
}

type tokenSessionResponse struct {
	AccessToken string        `json:"accessToken"`
	ExpiresAt   time.Time     `json:"expiresAt"`
	User        identity.User `json:"user"`
}

func newTokenSessionResponse(session identity.Session) tokenSessionResponse {
	return tokenSessionResponse{AccessToken: session.Token, ExpiresAt: session.ExpiresAt, User: session.User}
}

func (h *Handler) setupAdminToken(w http.ResponseWriter, r *http.Request) {
	var request identity.SetupRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	session, err := h.identity.Setup(r.Context(), request)
	if err != nil {
		handleIdentityError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, newTokenSessionResponse(session))
}

func (h *Handler) loginToken(w http.ResponseWriter, r *http.Request) {
	var request identity.LoginRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	session, err := h.identity.Login(r.Context(), request)
	if err != nil {
		if errors.Is(err, identity.ErrRateLimited) {
			w.Header().Set("Retry-After", "60")
			writeProblem(w, r, http.StatusTooManyRequests, "login_rate_limited", "Try again later", "Too many sign-in attempts. Wait one minute and try again.")
			return
		}
		if errors.Is(err, identity.ErrInvalidCredentials) {
			writeProblem(w, r, http.StatusUnauthorized, "invalid_credentials", "Sign in failed", "The username or password is incorrect.")
			return
		}
		h.logger.Error("token login", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "Sign in could not be completed.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, newTokenSessionResponse(session))
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if token, _ := authenticationToken(r); token != "" {
		_ = h.identity.Logout(r.Context(), token)
	}
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, currentUser(r))
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	var request struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	if err := h.identity.ChangePassword(r.Context(), currentUser(r).ID, request.CurrentPassword, request.NewPassword); err != nil {
		handleIdentityError(w, r, err)
		return
	}
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) listUsers(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	users, err := h.identity.ListUsers(r.Context())
	if err != nil {
		h.logger.Error("list users", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "Users could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users})
}

func (h *Handler) createUser(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var request identity.CreateUserRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	user, err := h.identity.CreateUser(r.Context(), request)
	if err != nil {
		handleIdentityError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/admin/users/"+user.ID)
	writeJSON(w, http.StatusCreated, user)
}

func (h *Handler) updateUser(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var request identity.UpdateUserRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	user, err := h.identity.UpdateUser(r.Context(), r.PathValue("userID"), request)
	if err != nil {
		handleIdentityError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *Handler) resetPassword(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var request struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	if err := h.identity.ResetPassword(r.Context(), r.PathValue("userID"), request.Password); err != nil {
		handleIdentityError(w, r, err)
		return
	}
	if r.PathValue("userID") == currentUser(r).ID {
		clearSessionCookie(w, r)
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleIdentityError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, identity.ErrInvalidInput):
		writeProblem(w, r, http.StatusBadRequest, "invalid_identity_input", "Invalid account details", err.Error())
	case errors.Is(err, identity.ErrInvalidCredentials):
		writeProblem(w, r, http.StatusUnauthorized, "invalid_credentials", "Authentication failed", "The current password is incorrect.")
	case errors.Is(err, identity.ErrSetupComplete):
		writeProblem(w, r, http.StatusConflict, "setup_complete", "Setup complete", "The first administrator has already been created.")
	case errors.Is(err, identity.ErrUsernameExists):
		writeProblem(w, r, http.StatusConflict, "username_exists", "Username unavailable", "That username is already in use.")
	case errors.Is(err, identity.ErrUserNotFound):
		writeProblem(w, r, http.StatusNotFound, "user_not_found", "User not found", "The requested user does not exist.")
	case errors.Is(err, identity.ErrLastAdmin):
		writeProblem(w, r, http.StatusConflict, "last_admin", "Administrator required", "The last active administrator cannot be disabled or changed to a user.")
	default:
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The account operation could not be completed.")
	}
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, session identity.Session) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: session.Token, Path: "/", HttpOnly: true, Secure: requestIsHTTPS(r),
		SameSite: http.SameSiteLaxMode, Expires: session.ExpiresAt, MaxAge: int(time.Until(session.ExpiresAt).Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", HttpOnly: true, Secure: requestIsHTTPS(r), SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

func requestIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https")
}

// listPlaylists 返回当前用户的一批歌单。
// 参数 w 写入分页响应，r 读取可选的 limit 和 cursor 查询参数；无效参数返回 400，
// 游标有效时响应仅包含当前批次和下一批游标，避免一次性传输全部歌单。
func (h *Handler) listPlaylists(w http.ResponseWriter, r *http.Request) {
	limit, err := optionalInt(r.URL.Query().Get("limit"))
	if err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_limit", "Invalid limit", "Limit must be an integer.")
		return
	}
	page, err := h.playlists.List(r.Context(), currentUser(r).ID, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		if errors.Is(err, playlists.ErrInvalidLimit) {
			writeProblem(w, r, http.StatusBadRequest, "invalid_limit", "Invalid limit", err.Error())
			return
		}
		if errors.Is(err, playlists.ErrInvalidCursor) {
			writeProblem(w, r, http.StatusBadRequest, "invalid_cursor", "Invalid cursor", "Cursor must be a value returned by this endpoint.")
			return
		}
		h.playlistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *Handler) createPlaylist(w http.ResponseWriter, r *http.Request) {
	var request playlists.CreateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	playlist, err := h.playlists.Create(r.Context(), currentUser(r).ID, request)
	if err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/me/playlists/"+playlist.ID)
	writeJSON(w, http.StatusCreated, playlist)
}

func (h *Handler) getPlaylist(w http.ResponseWriter, r *http.Request) {
	playlist, err := h.playlists.Get(r.Context(), currentUser(r).ID, r.PathValue("playlistID"))
	if err != nil {
		h.playlistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, playlist)
}

func (h *Handler) renamePlaylist(w http.ResponseWriter, r *http.Request) {
	var request playlists.RenameRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	playlist, err := h.playlists.Rename(r.Context(), currentUser(r).ID, r.PathValue("playlistID"), request)
	if err != nil {
		h.playlistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, playlist)
}

func (h *Handler) deletePlaylist(w http.ResponseWriter, r *http.Request) {
	if err := h.playlists.Delete(r.Context(), currentUser(r).ID, r.PathValue("playlistID")); err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) addPlaylistTrack(w http.ResponseWriter, r *http.Request) {
	var request playlists.AddTrackRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	if err := h.playlists.AddTrack(r.Context(), currentUser(r).ID, r.PathValue("playlistID"), request.TrackID); err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) removePlaylistTrack(w http.ResponseWriter, r *http.Request) {
	if err := h.playlists.RemoveTrack(r.Context(), currentUser(r).ID, r.PathValue("playlistID"), r.PathValue("trackID")); err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// favoriteAlbums 返回当前用户直接喜欢的可播放专辑。
//
// 参数 w 用于写入 JSON 响应，r 提供可选 limit 和认证后的用户身份。歌曲喜欢推导出的专辑
// 由首页额外读取收藏歌单后合并；本接口只描述用户显式喜欢的专辑。非法 limit 返回 400，
// 其余错误遵循歌单与收藏领域的统一错误映射。
func (h *Handler) favoriteAlbums(w http.ResponseWriter, r *http.Request) {
	limit, err := optionalInt(r.URL.Query().Get("limit"))
	if err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_limit", "Invalid limit", "Limit must be an integer.")
		return
	}
	items, err := h.playlists.FavoriteAlbums(r.Context(), currentUser(r).ID, limit)
	if err != nil {
		h.playlistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// favoriteAlbumStatus 返回当前用户对目标专辑的直接喜欢状态。
//
// 参数 w 写入 JSON 响应，r 提供 albumID 路径参数与认证用户。返回值只反映专辑本身的
// 喜欢状态，不会因为其中任何歌曲被喜欢而变化。
func (h *Handler) favoriteAlbumStatus(w http.ResponseWriter, r *http.Request) {
	favorite, err := h.playlists.IsAlbumFavorite(r.Context(), currentUser(r).ID, r.PathValue("albumID"))
	if err != nil {
		h.playlistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"favorite": favorite})
}

// addFavoriteAlbum 将目标专辑加入当前用户的直接喜欢列表。
//
// 参数 w 写入无内容成功响应，r 提供 albumID 和认证用户。重复添加是幂等操作；目标专辑
// 不存在时返回 404，其他领域错误由 playlistError（歌单错误映射）转换为问题响应。
func (h *Handler) addFavoriteAlbum(w http.ResponseWriter, r *http.Request) {
	if err := h.playlists.SetAlbumFavorite(r.Context(), currentUser(r).ID, r.PathValue("albumID"), true); err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// removeFavoriteAlbum 从当前用户的直接喜欢列表移除目标专辑。
//
// 参数 w 写入无内容成功响应，r 提供 albumID 和认证用户。未收藏的专辑同样返回成功，使
// 客户端在重试或多端同步时不需要额外读取状态。
func (h *Handler) removeFavoriteAlbum(w http.ResponseWriter, r *http.Request) {
	if err := h.playlists.SetAlbumFavorite(r.Context(), currentUser(r).ID, r.PathValue("albumID"), false); err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) favoriteStatus(w http.ResponseWriter, r *http.Request) {
	favorite, err := h.playlists.IsFavorite(r.Context(), currentUser(r).ID, r.PathValue("trackID"))
	if err != nil {
		h.playlistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"favorite": favorite})
}

func (h *Handler) addFavorite(w http.ResponseWriter, r *http.Request) {
	if err := h.playlists.SetFavorite(r.Context(), currentUser(r).ID, r.PathValue("trackID"), true); err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) removeFavorite(w http.ResponseWriter, r *http.Request) {
	if err := h.playlists.SetFavorite(r.Context(), currentUser(r).ID, r.PathValue("trackID"), false); err != nil {
		h.playlistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) playlistError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, playlists.ErrInvalidName):
		writeProblem(w, r, http.StatusBadRequest, "invalid_playlist_name", "Invalid playlist name", err.Error())
	case errors.Is(err, playlists.ErrNotFound):
		writeProblem(w, r, http.StatusNotFound, "playlist_not_found", "Playlist not found", "The requested playlist or track does not exist.")
	case errors.Is(err, playlists.ErrAlbumNotFound):
		writeProblem(w, r, http.StatusNotFound, "favorite_album_not_found", "Favorite album not found", "The requested album does not exist.")
	case errors.Is(err, playlists.ErrInvalidLimit):
		writeProblem(w, r, http.StatusBadRequest, "invalid_limit", "Invalid limit", err.Error())
	case errors.Is(err, playlists.ErrProtected):
		writeProblem(w, r, http.StatusConflict, "favorites_protected", "Playlist protected", "The favorites playlist cannot be renamed or deleted.")
	case errors.Is(err, playlists.ErrDuplicate):
		writeProblem(w, r, http.StatusConflict, "track_already_added", "Track already added", "This track is already in the playlist.")
	default:
		h.logger.Error("playlist operation", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The playlist operation could not be completed.")
	}
}

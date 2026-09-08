package v1

import (
	"errors"
	"net/http"

	"rime/backend/internal/settings"
)

// getAccountSettings 返回当前账号的播放器诊断偏好。
//
// 参数 w 写入 JSON（JavaScript 对象表示法）响应，r 提供已认证用户及请求上下文。
// 返回值无；存储读取失败时返回 500（服务器内部错误）。
func (h *Handler) getAccountSettings(w http.ResponseWriter, r *http.Request) {
	configuration, err := h.settings.Get(r.Context(), currentUser(r).ID)
	if err != nil {
		h.logger.Error("get account settings", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "Account settings could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, configuration)
}

// updateAccountSettings 允许管理员更新仅归属自己的播放诊断偏好。
//
// 参数 w 写入更新后的 JSON 响应，r 提供请求体和已认证管理员身份。
// 返回值无；非管理员返回 403（禁止访问），写入不会影响其他账号，空更新返回 400（错误请求）。
func (h *Handler) updateAccountSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var request settings.UpdateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	configuration, err := h.settings.Update(r.Context(), currentUser(r).ID, request)
	if err != nil {
		if errors.Is(err, settings.ErrInvalidUpdate) {
			writeProblem(w, r, http.StatusBadRequest, "invalid_settings_update", "Invalid settings update", "Provide at least one account setting to update.")
			return
		}
		h.logger.Error("update account settings", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "Account settings could not be updated.")
		return
	}
	writeJSON(w, http.StatusOK, configuration)
}

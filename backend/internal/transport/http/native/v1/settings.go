package v1

import (
	"errors"
	"net/http"

	"rime/backend/internal/settings"
)

// getSystemSettings 返回当前用户可据此决定是否展示播放器诊断信息的全局设置。
//
// 参数 w 写入 JSON（JavaScript 对象表示法）响应，r 提供已认证用户及请求上下文。
// 返回值无；存储读取失败时返回 500（服务器内部错误）。
func (h *Handler) getSystemSettings(w http.ResponseWriter, r *http.Request) {
	configuration, err := h.settings.Get(r.Context())
	if err != nil {
		h.logger.Error("get system settings", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "System settings could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, configuration)
}

// updateSystemSettings 允许管理员更新会影响所有客户端的设置。
//
// 参数 w 写入更新后的 JSON 响应，r 提供请求体和已认证管理员身份。
// 返回值无；非管理员返回 403（禁止访问），空更新返回 400（错误请求）。
func (h *Handler) updateSystemSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var request settings.UpdateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	configuration, err := h.settings.Update(r.Context(), request)
	if err != nil {
		if errors.Is(err, settings.ErrInvalidUpdate) {
			writeProblem(w, r, http.StatusBadRequest, "invalid_settings_update", "Invalid settings update", "Provide at least one system setting to update.")
			return
		}
		h.logger.Error("update system settings", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "System settings could not be updated.")
		return
	}
	writeJSON(w, http.StatusOK, configuration)
}

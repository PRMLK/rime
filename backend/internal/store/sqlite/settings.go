package sqlite

import (
	"context"
	"fmt"
	"time"

	"rime/backend/internal/settings"
)

// GetSystemSettings 读取唯一的全局设置记录。
//
// 参数 ctx 用于取消查询。
// 返回值包含调试开关状态；数据库读取失败时返回包装后的错误。
func (s *Store) GetSystemSettings(ctx context.Context) (settings.Settings, error) {
	var debugEnabled bool
	if err := s.db.QueryRowContext(ctx, `SELECT debug_enabled FROM system_settings WHERE id = 1`).Scan(&debugEnabled); err != nil {
		return settings.Settings{}, fmt.Errorf("get system settings: %w", err)
	}
	return settings.Settings{DebugEnabled: debugEnabled}, nil
}

// SetDebugEnabled 更新全局调试开关。
//
// 参数 ctx 用于取消写入，enabled 是管理员指定的开关状态，updatedAt 记录统一的 UTC（协调世界时）更新时间。
// 返回值为写入后的完整设置；更新失败时返回包装后的错误。
func (s *Store) SetDebugEnabled(ctx context.Context, enabled bool, updatedAt time.Time) (settings.Settings, error) {
	if _, err := s.db.ExecContext(ctx,
		`UPDATE system_settings SET debug_enabled = ?, updated_at = ? WHERE id = 1`,
		enabled, updatedAt.Format(time.RFC3339Nano),
	); err != nil {
		return settings.Settings{}, fmt.Errorf("set debug enabled: %w", err)
	}
	return settings.Settings{DebugEnabled: enabled}, nil
}

package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"rime/backend/internal/settings"
)

// GetAccountSettings 读取指定账号的播放诊断偏好。
//
// 参数 ctx 用于取消查询，userID 限定当前会话的账号范围。
// 返回值包含该账号的调试开关状态；尚未写入记录时返回默认关闭。
func (s *Store) GetAccountSettings(ctx context.Context, userID string) (settings.Settings, error) {
	var debugEnabled bool
	if err := s.db.QueryRowContext(ctx, `SELECT debug_enabled FROM user_settings WHERE user_id = ?`, userID).Scan(&debugEnabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return settings.Settings{}, nil
		}
		return settings.Settings{}, fmt.Errorf("get account settings: %w", err)
	}
	return settings.Settings{DebugEnabled: debugEnabled}, nil
}

// SetDebugEnabled 更新指定账号的调试开关。
//
// 参数 ctx 用于取消写入，userID 限定写入账号，enabled 是管理员指定的开关状态，updatedAt 记录统一的 UTC（协调世界时）更新时间。
// 返回值为写入后的完整设置；更新失败时返回包装后的错误。
func (s *Store) SetDebugEnabled(ctx context.Context, userID string, enabled bool, updatedAt time.Time) (settings.Settings, error) {
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO user_settings(user_id, debug_enabled, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET debug_enabled = excluded.debug_enabled, updated_at = excluded.updated_at`,
		userID, enabled, updatedAt.Format(time.RFC3339Nano),
	); err != nil {
		return settings.Settings{}, fmt.Errorf("set debug enabled: %w", err)
	}
	return settings.Settings{DebugEnabled: enabled}, nil
}

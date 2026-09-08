package settings

import (
	"context"
	"errors"
	"time"
)

// ErrInvalidUpdate 表示更新请求未携带任何可修改的账号设置字段。
var ErrInvalidUpdate = errors.New("account settings update is empty")

// Settings 表示当前登录账号拥有的播放诊断偏好。
type Settings struct {
	DebugEnabled bool `json:"debugEnabled"`
}

// UpdateRequest 表示管理员可写入的当前账号设置字段。指针用于区分 false（明确关闭）和缺失。
type UpdateRequest struct {
	DebugEnabled *bool `json:"debugEnabled"`
}

// Repository 定义账号设置服务所需的持久化操作。
type Repository interface {
	GetAccountSettings(context.Context, string) (Settings, error)
	SetDebugEnabled(context.Context, string, bool, time.Time) (Settings, error)
}

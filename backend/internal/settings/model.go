package settings

import (
	"context"
	"errors"
	"time"
)

// ErrInvalidUpdate 表示更新请求未携带任何可修改的系统设置字段。
var ErrInvalidUpdate = errors.New("system settings update is empty")

// Settings 表示由管理员统一维护、会影响全部客户端的系统设置。
type Settings struct {
	DebugEnabled bool `json:"debugEnabled"`
}

// UpdateRequest 表示管理员可写入的系统设置字段。指针用于区分 false（明确关闭）和缺失。
type UpdateRequest struct {
	DebugEnabled *bool `json:"debugEnabled"`
}

// Repository 定义系统设置服务所需的持久化操作。
type Repository interface {
	GetSystemSettings(context.Context) (Settings, error)
	SetDebugEnabled(context.Context, bool, time.Time) (Settings, error)
}

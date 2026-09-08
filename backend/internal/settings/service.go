package settings

import (
	"context"
	"time"
)

// Service 处理系统级设置的读取和管理员更新。
type Service struct {
	repo Repository
	now  func() time.Time
}

// New 创建系统设置服务。
//
// 参数 repo 提供持久化实现。
// 返回值为可安全被 HTTP（超文本传输协议）层复用的系统设置服务。
func New(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

// Get 读取当前全局系统设置。
//
// 参数 ctx 用于取消底层数据库读取。
// 返回值包含当前调试模式状态；读取失败时返回错误。
func (s *Service) Get(ctx context.Context) (Settings, error) {
	return s.repo.GetSystemSettings(ctx)
}

// Update 写入管理员提交的系统设置。
//
// 参数 ctx 用于取消数据库写入，request 仅允许包含已声明的系统设置字段。
// 返回值为持久化后的完整设置；空请求返回 ErrInvalidUpdate（无效更新）。
func (s *Service) Update(ctx context.Context, request UpdateRequest) (Settings, error) {
	if request.DebugEnabled == nil {
		return Settings{}, ErrInvalidUpdate
	}
	return s.repo.SetDebugEnabled(ctx, *request.DebugEnabled, s.now().UTC())
}

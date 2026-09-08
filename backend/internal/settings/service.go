package settings

import (
	"context"
	"time"
)

// Service 处理按账号隔离的播放诊断偏好读取和更新。
type Service struct {
	repo Repository
	now  func() time.Time
}

// New 创建账号设置服务。
//
// 参数 repo 提供持久化实现。
// 返回值为可安全被 HTTP（超文本传输协议）层复用的账号设置服务。
func New(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

// Get 读取指定账号的播放诊断偏好。
//
// 参数 ctx 用于取消底层数据库读取，userID 是当前已认证账号的稳定标识。
// 返回值包含该账号的调试模式状态；首次读取尚未保存过偏好时返回默认关闭。
func (s *Service) Get(ctx context.Context, userID string) (Settings, error) {
	return s.repo.GetAccountSettings(ctx, userID)
}

// Update 写入管理员当前账号的播放诊断偏好。
//
// 参数 ctx 用于取消数据库写入，userID 是仅允许写入的当前管理员账号，request 仅允许包含已声明字段。
// 返回值为持久化后的完整设置；空请求返回 ErrInvalidUpdate（无效更新）。
func (s *Service) Update(ctx context.Context, userID string, request UpdateRequest) (Settings, error) {
	if request.DebugEnabled == nil {
		return Settings{}, ErrInvalidUpdate
	}
	return s.repo.SetDebugEnabled(ctx, userID, *request.DebugEnabled, s.now().UTC())
}

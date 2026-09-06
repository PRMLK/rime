package playlists

import (
	"context"
	"fmt"
	"strings"
	"time"

	"rime/backend/internal/catalog"
	"rime/backend/internal/id"
)

type Repository interface {
	ListPlaylists(context.Context, string, int, string) (Page, error)
	GetPlaylist(context.Context, string, string) (Detail, error)
	CreatePlaylist(context.Context, string, string, string, time.Time) (Playlist, error)
	RenamePlaylist(context.Context, string, string, string, time.Time) (Playlist, error)
	DeletePlaylist(context.Context, string, string) error
	AddPlaylistTrack(context.Context, string, string, string, time.Time) error
	RemovePlaylistTrack(context.Context, string, string, string, time.Time) error
	FavoritePlaylistID(context.Context, string) (string, error)
	IsFavorite(context.Context, string, string) (bool, error)
	FavoriteAlbums(context.Context, string, int) ([]catalog.Album, error)
	SetFavoriteAlbum(context.Context, string, string, bool, time.Time) error
	IsFavoriteAlbum(context.Context, string, string) (bool, error)
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func New(repo Repository) *Service { return &Service{repo: repo, now: time.Now} }

// List 返回当前用户的一批歌单。
// 参数 limit 为单批数量，未提供时默认 10；cursor 为上一批响应返回的续页游标。
func (s *Service) List(ctx context.Context, userID string, limit int, cursor string) (Page, error) {
	if limit == 0 {
		limit = 10
	}
	if limit < 1 || limit > 50 {
		return Page{}, ErrInvalidLimit
	}
	return s.repo.ListPlaylists(ctx, userID, limit, cursor)
}

func (s *Service) Get(ctx context.Context, userID, playlistID string) (Detail, error) {
	return s.repo.GetPlaylist(ctx, playlistID, userID)
}

func (s *Service) Create(ctx context.Context, userID string, request CreateRequest) (Playlist, error) {
	name, err := validName(request.Name)
	if err != nil {
		return Playlist{}, err
	}
	playlistID, err := id.New("pls")
	if err != nil {
		return Playlist{}, err
	}
	return s.repo.CreatePlaylist(ctx, playlistID, userID, name, s.now().UTC())
}

func (s *Service) Rename(ctx context.Context, userID, playlistID string, request RenameRequest) (Playlist, error) {
	name, err := validName(request.Name)
	if err != nil {
		return Playlist{}, err
	}
	return s.repo.RenamePlaylist(ctx, playlistID, userID, name, s.now().UTC())
}

func (s *Service) Delete(ctx context.Context, userID, playlistID string) error {
	return s.repo.DeletePlaylist(ctx, playlistID, userID)
}

func (s *Service) AddTrack(ctx context.Context, userID, playlistID, trackID string) error {
	if trackID == "" {
		return fmt.Errorf("trackId is required")
	}
	err := s.repo.AddPlaylistTrack(ctx, playlistID, userID, trackID, s.now().UTC())
	if err == ErrDuplicate {
		return nil
	}
	return err
}

func (s *Service) RemoveTrack(ctx context.Context, userID, playlistID, trackID string) error {
	return s.repo.RemovePlaylistTrack(ctx, playlistID, userID, trackID, s.now().UTC())
}

func (s *Service) SetFavorite(ctx context.Context, userID, trackID string, favorite bool) error {
	playlistID, err := s.repo.FavoritePlaylistID(ctx, userID)
	if err != nil {
		return err
	}
	if favorite {
		err = s.repo.AddPlaylistTrack(ctx, playlistID, userID, trackID, s.now().UTC())
		if err == ErrDuplicate {
			return nil
		}
		return err
	}
	return s.repo.RemovePlaylistTrack(ctx, playlistID, userID, trackID, s.now().UTC())
}

func (s *Service) IsFavorite(ctx context.Context, userID, trackID string) (bool, error) {
	return s.repo.IsFavorite(ctx, userID, trackID)
}

// FavoriteAlbums 返回当前用户直接喜欢、且仍有可播放曲目的专辑。
//
// 参数 ctx 用于取消读取，userID 限定偏好归属，limit 是首页所需的数量；留空时默认返回
// 12 张，允许范围为 1 至 50。歌曲喜欢推导出的专辑由客户端与本结果合并，避免把“喜欢
// 专辑”错误地扩展成喜欢其中所有歌曲。
func (s *Service) FavoriteAlbums(ctx context.Context, userID string, limit int) ([]catalog.Album, error) {
	if limit == 0 {
		limit = 12
	}
	if limit < 1 || limit > 50 {
		return nil, ErrInvalidLimit
	}
	return s.repo.FavoriteAlbums(ctx, userID, limit)
}

// SetAlbumFavorite 设置当前用户对单张专辑的喜欢状态。
//
// 参数 ctx 用于取消写入，userID 是偏好所属用户，albumID 为目标专辑，favorite 为 true
// 时添加、为 false 时移除。歌曲喜欢仍由独立的 SetFavorite（设置歌曲喜欢）维护，两个
// 操作不会互相修改对方的数据。
func (s *Service) SetAlbumFavorite(ctx context.Context, userID, albumID string, favorite bool) error {
	return s.repo.SetFavoriteAlbum(ctx, userID, albumID, favorite, s.now().UTC())
}

// IsAlbumFavorite 返回当前用户是否直接喜欢目标专辑。
//
// 参数 ctx 用于取消读取，userID 限定用户数据，albumID 为待检查的专辑；返回值只表示
// 专辑喜欢状态，不会因其中某首歌曲被喜欢而变为 true。
func (s *Service) IsAlbumFavorite(ctx context.Context, userID, albumID string) (bool, error) {
	return s.repo.IsFavoriteAlbum(ctx, userID, albumID)
}

func validName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > 80 {
		return "", ErrInvalidName
	}
	return value, nil
}

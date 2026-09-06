package browse

import (
	"context"
	"database/sql"
	"errors"

	"rime/backend/internal/catalog"
)

var (
	ErrInvalidLimit   = errors.New("limit must be between 1 and 50")
	ErrInvalidCursor  = errors.New("invalid cursor")
	ErrAlbumNotFound  = errors.New("album not found")
	ErrArtistNotFound = errors.New("artist not found")
)

type AlbumPage struct {
	Items      []catalog.Album `json:"items"`
	NextCursor string          `json:"nextCursor,omitempty"`
}

// ArtistDetailPage 表示歌手资料和当前批次的专辑。
// Albums 仅包含当前请求范围内的专辑；NextCursor 非空时，调用方可继续取得后续专辑。
type ArtistDetailPage struct {
	catalog.ArtistDetail
	NextCursor string `json:"nextCursor,omitempty"`
}

type Repository interface {
	Albums(context.Context, int, string) (AlbumPage, error)
	RecentAlbums(context.Context, int, string) (AlbumPage, error)
	AlbumDetail(context.Context, string) (catalog.AlbumDetail, error)
	ArtistDetail(context.Context, string, int, string) (ArtistDetailPage, error)
}

type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

// Albums 返回全部可播放专辑的一个游标页。
//
// 参数 ctx 用于取消请求，limit 为单批最大项目数，未提供时默认 24；cursor 为上一批响应
// 中返回的透明游标，留空时从第一批开始。专辑按规范化标题稳定排序，以便用户在“全部专辑”
// 视图中按名称浏览；返回值同时包含后续加载所需的下一批游标。
func (s *Service) Albums(ctx context.Context, limit int, cursor string) (AlbumPage, error) {
	if limit == 0 {
		limit = 24
	}
	if limit < 1 || limit > 50 {
		return AlbumPage{}, ErrInvalidLimit
	}
	page, err := s.repo.Albums(ctx, limit, cursor)
	if err != nil {
		return AlbumPage{}, err
	}
	return page, nil
}

// RecentAlbums 返回最近入库专辑的一个游标页。
//
// 参数 ctx 用于取消请求，limit 为单批最大项目数，未提供时默认 12；cursor 为上一批响应
// 中返回的透明游标，留空时从第一批开始。返回值包含专辑和后续加载所需的下一批游标。
func (s *Service) RecentAlbums(ctx context.Context, limit int, cursor string) (AlbumPage, error) {
	if limit == 0 {
		limit = 12
	}
	if limit < 1 || limit > 50 {
		return AlbumPage{}, ErrInvalidLimit
	}
	page, err := s.repo.RecentAlbums(ctx, limit, cursor)
	if err != nil {
		return AlbumPage{}, err
	}
	return page, nil
}

// AlbumDetail 读取一个专辑及其中全部可播放曲目。
// 参数 ctx 用于传递请求取消信号，albumID 为音乐库中的专辑标识。
// 返回值在专辑不存在或没有可播放曲目时返回 ErrAlbumNotFound。
func (s *Service) AlbumDetail(ctx context.Context, albumID string) (catalog.AlbumDetail, error) {
	detail, err := s.repo.AlbumDetail(ctx, albumID)
	if errors.Is(err, sql.ErrNoRows) {
		return catalog.AlbumDetail{}, ErrAlbumNotFound
	}
	return detail, err
}

// ArtistDetail 读取歌手资料及其一批可播放专辑。
// 参数 ctx 用于传递请求取消信号，artistID 为歌手标识，limit 为单批数量，cursor 为上一
// 批响应返回的续页游标。返回值在歌手不存在或没有可播放曲目时返回 ErrArtistNotFound。
func (s *Service) ArtistDetail(ctx context.Context, artistID string, limit int, cursor string) (ArtistDetailPage, error) {
	if limit == 0 {
		limit = 30
	}
	if limit < 1 || limit > 50 {
		return ArtistDetailPage{}, ErrInvalidLimit
	}
	detail, err := s.repo.ArtistDetail(ctx, artistID, limit, cursor)
	if errors.Is(err, sql.ErrNoRows) {
		return ArtistDetailPage{}, ErrArtistNotFound
	}
	return detail, err
}

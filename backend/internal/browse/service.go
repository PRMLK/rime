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
	Items          []catalog.Album `json:"items"`
	NextCursor     string          `json:"nextCursor,omitempty"`
	PreviousCursor string          `json:"previousCursor,omitempty"`
}

type Repository interface {
	RecentAlbums(context.Context, int, string) (AlbumPage, error)
	AlbumDetail(context.Context, string) (catalog.AlbumDetail, error)
	ArtistDetail(context.Context, string) (catalog.ArtistDetail, error)
}

type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

// RecentAlbums 返回最近入库专辑的一个游标页。
//
// 参数 ctx 用于取消请求，limit 为单页最大项目数，未提供时默认 12；cursor 为上一页或
// 下一页响应中返回的透明游标，留空时从第一页开始。返回值包含专辑和相邻页游标。
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

// ArtistDetail 读取一个歌手及其包含可播放曲目的专辑。
// 参数 ctx 用于传递请求取消信号，artistID 为音乐库中的歌手标识。
// 返回值在歌手不存在或没有可播放曲目时返回 ErrArtistNotFound。
func (s *Service) ArtistDetail(ctx context.Context, artistID string) (catalog.ArtistDetail, error) {
	detail, err := s.repo.ArtistDetail(ctx, artistID)
	if errors.Is(err, sql.ErrNoRows) {
		return catalog.ArtistDetail{}, ErrArtistNotFound
	}
	return detail, err
}

package browse

import (
	"context"
	"errors"

	"rime/backend/internal/catalog"
)

var ErrInvalidLimit = errors.New("limit must be between 1 and 50")

type AlbumPage struct {
	Items []catalog.Album `json:"items"`
}

type Repository interface {
	RecentAlbums(context.Context, int) ([]catalog.Album, error)
}

type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) RecentAlbums(ctx context.Context, limit int) (AlbumPage, error) {
	if limit == 0 {
		limit = 12
	}
	if limit < 1 || limit > 50 {
		return AlbumPage{}, ErrInvalidLimit
	}
	items, err := s.repo.RecentAlbums(ctx, limit)
	if err != nil {
		return AlbumPage{}, err
	}
	return AlbumPage{Items: items}, nil
}

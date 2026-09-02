package search

import (
	"context"
	"fmt"
	"strings"

	"rime/backend/internal/catalog"
)

type Page struct {
	Items      []catalog.Track `json:"items"`
	NextCursor string          `json:"nextCursor,omitempty"`
}

type Repository interface {
	SearchTracks(context.Context, string, int, string) (Page, error)
}

type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Tracks(ctx context.Context, query string, limit int, cursor string) (Page, error) {
	query = strings.TrimSpace(query)
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 50 {
		return Page{}, fmt.Errorf("limit must be between 1 and 50")
	}
	return s.repo.SearchTracks(ctx, query, limit, cursor)
}

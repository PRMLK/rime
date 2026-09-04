package playlists

import (
	"context"
	"fmt"
	"strings"
	"time"

	"rime/backend/internal/id"
)

type Repository interface {
	ListPlaylists(context.Context, string) ([]Playlist, error)
	GetPlaylist(context.Context, string, string) (Detail, error)
	CreatePlaylist(context.Context, string, string, string, time.Time) (Playlist, error)
	RenamePlaylist(context.Context, string, string, string, time.Time) (Playlist, error)
	DeletePlaylist(context.Context, string, string) error
	AddPlaylistTrack(context.Context, string, string, string, time.Time) error
	RemovePlaylistTrack(context.Context, string, string, string, time.Time) error
	FavoritePlaylistID(context.Context, string) (string, error)
	IsFavorite(context.Context, string, string) (bool, error)
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func New(repo Repository) *Service { return &Service{repo: repo, now: time.Now} }

func (s *Service) List(ctx context.Context, userID string) ([]Playlist, error) {
	return s.repo.ListPlaylists(ctx, userID)
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

func validName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > 80 {
		return "", ErrInvalidName
	}
	return value, nil
}

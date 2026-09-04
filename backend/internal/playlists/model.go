package playlists

import (
	"errors"
	"time"

	"rime/backend/internal/catalog"
)

const (
	KindFavorites = "favorites"
	KindCustom    = "custom"
)

var (
	ErrNotFound    = errors.New("playlist not found")
	ErrProtected   = errors.New("favorites playlist cannot be changed")
	ErrDuplicate   = errors.New("track is already in playlist")
	ErrInvalidName = errors.New("playlist name must contain 1 to 80 characters")
)

type Playlist struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"`
	TrackCount int       `json:"trackCount"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Detail struct {
	Playlist
	Tracks []catalog.Track `json:"tracks"`
}

type CreateRequest struct {
	Name string `json:"name"`
}

type RenameRequest struct {
	Name string `json:"name"`
}

type AddTrackRequest struct {
	TrackID string `json:"trackId"`
}

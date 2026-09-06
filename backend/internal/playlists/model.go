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
	ErrNotFound      = errors.New("playlist not found")
	ErrProtected     = errors.New("favorites playlist cannot be changed")
	ErrDuplicate     = errors.New("track is already in playlist")
	ErrInvalidName   = errors.New("playlist name must contain 1 to 80 characters")
	ErrInvalidLimit  = errors.New("limit must be between 1 and 50")
	ErrInvalidCursor = errors.New("invalid cursor")
)

type Playlist struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"`
	TrackCount int       `json:"trackCount"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// Page 表示当前用户歌单列表的一批结果。
// NextCursor 非空时，调用方可携带该值继续读取下一批歌单。
type Page struct {
	Items      []Playlist `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
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

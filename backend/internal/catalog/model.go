package catalog

import "time"

type ArtistRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role,omitempty"`
}

type AlbumRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type Album struct {
	ID        string      `json:"id"`
	Title     string      `json:"title"`
	Artists   []ArtistRef `json:"artists"`
	ArtworkID *string     `json:"artworkId,omitempty"`
	AddedAt   time.Time   `json:"addedAt"`
}

type Track struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Album       AlbumRef    `json:"album"`
	Artists     []ArtistRef `json:"artists"`
	DurationMs  int64       `json:"durationMs"`
	DiscNumber  int         `json:"discNumber,omitempty"`
	TrackNumber int         `json:"trackNumber,omitempty"`
	ArtworkID   *string     `json:"artworkId,omitempty"`
}

type MediaFile struct {
	ID             string
	TrackID        string
	Path           string
	Container      string
	Codec          string
	ContentType    string
	BitrateKbps    int
	Size           int64
	ModifiedUnixMs int64
	ContentVersion string
}

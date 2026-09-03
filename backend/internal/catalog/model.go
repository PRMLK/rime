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

// AlbumDetail 表示可在专辑详情页展示的专辑资料。
// 嵌入 Album 以保持列表和详情共用同一套基础字段；Tracks 仅包含当前可播放的曲目。
type AlbumDetail struct {
	Album
	Tracks []Track `json:"tracks"`
}

// ArtistDetail 表示可在歌手详情页展示的歌手资料。
// Albums 按专辑名称排序，且只包含至少有一首可播放曲目的专辑。
type ArtistDetail struct {
	ArtistRef
	Albums []Album `json:"albums"`
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

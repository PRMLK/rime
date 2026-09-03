package metadata

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"go.senan.xyz/taglib"
	"golang.org/x/text/encoding/simplifiedchinese"
)

type Track struct {
	Title        string
	Album        string
	Artists      []string
	AlbumArtists []string
	DurationMs   int64
	DiscNumber   int
	TrackNumber  int
	Container    string
	Codec        string
	ContentType  string
	BitrateKbps  int
	HasArtwork   bool
}

type Reader struct{}

type Lyrics struct {
	Format  string
	Content string
}

func (Reader) Read(path string) (Track, error) {
	tags, err := taglib.ReadTags(path)
	if err != nil {
		return Track{}, fmt.Errorf("read tags: %w", err)
	}
	properties, err := taglib.ReadProperties(path)
	if err != nil {
		return Track{}, fmt.Errorf("read properties: %w", err)
	}

	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
	title := cleanTagValue(first(tags, "TITLE"))
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	artists := cleanTagValues(values(tags, "ARTIST"))
	if len(artists) == 0 {
		artists = []string{"Unknown Artist"}
	}
	albumArtists := cleanTagValues(values(tags, "ALBUMARTIST", "ALBUM ARTIST"))
	if len(albumArtists) == 0 {
		albumArtists = artists
	}
	album := cleanTagValue(first(tags, "ALBUM"))
	if album == "" {
		album = "Unknown Album"
	}

	return Track{
		Title:        title,
		Album:        album,
		Artists:      artists,
		AlbumArtists: albumArtists,
		DurationMs:   properties.Length.Milliseconds(),
		DiscNumber:   number(first(tags, "DISCNUMBER")),
		TrackNumber:  number(first(tags, "TRACKNUMBER")),
		Container:    extension,
		Codec:        codec(extension),
		ContentType:  contentType(extension),
		BitrateKbps:  int(properties.Bitrate),
		HasArtwork:   len(properties.Images) > 0,
	}, nil
}

func (Reader) ReadLyrics(path string) (Lyrics, bool, error) {
	tags, err := taglib.ReadTags(path)
	if err != nil {
		return Lyrics{}, false, fmt.Errorf("read tags: %w", err)
	}
	if content := first(tags, "SYNCEDLYRICS", "SYNCED LYRICS"); content != "" {
		return Lyrics{Format: "lrc", Content: content}, true, nil
	}
	if content := first(tags, "LYRICS"); content != "" {
		format := "plain"
		if strings.Contains(content, "[") && strings.Contains(content, ":") {
			format = "lrc"
		}
		return Lyrics{Format: format, Content: content}, true, nil
	}
	if content := first(tags, "UNSYNCEDLYRICS", "UNSYNCED LYRICS"); content != "" {
		return Lyrics{Format: "plain", Content: content}, true, nil
	}
	return Lyrics{}, false, nil
}

func codec(extension string) string {
	switch extension {
	case "mp3":
		return "mp3"
	case "m4a", "mp4", "aac":
		return "aac"
	case "ogg", "oga":
		return "vorbis"
	case "opus":
		return "opus"
	case "flac":
		return "flac"
	case "wav", "wave", "aiff", "aif":
		return "pcm"
	default:
		return ""
	}
}

func values(tags map[string][]string, keys ...string) []string {
	for key, entries := range tags {
		for _, candidate := range keys {
			if strings.EqualFold(strings.ReplaceAll(key, "_", " "), strings.ReplaceAll(candidate, "_", " ")) {
				result := make([]string, 0, len(entries))
				for _, entry := range entries {
					if value := strings.TrimSpace(entry); value != "" {
						result = append(result, value)
					}
				}
				return result
			}
		}
	}
	return nil
}

func first(tags map[string][]string, keys ...string) string {
	entries := values(tags, keys...)
	if len(entries) == 0 {
		return ""
	}
	return entries[0]
}

func cleanTagValues(entries []string) []string {
	result := make([]string, 0, len(entries))
	for _, entry := range entries {
		if value := cleanTagValue(entry); value != "" {
			result = append(result, value)
		}
	}
	return result
}

// cleanTagValue removes a duplicated GBK value that was misread as Latin-1
// when a tag also contains its correct Unicode form, such as "ÓµÓÐ;拥有".
func cleanTagValue(value string) string {
	parts := strings.Split(value, ";")
	if len(parts) < 2 {
		return value
	}

	clean := make([]string, 0, len(parts))
	removedMojibake := false
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if isGBKMojibake(part) {
			removedMojibake = true
			continue
		}
		clean = append(clean, part)
	}
	if removedMojibake && len(clean) > 0 {
		return strings.Join(clean, ";")
	}
	return value
}

func isGBKMojibake(value string) bool {
	bytes := make([]byte, 0, len(value))
	for _, character := range value {
		if character > 0xff {
			return false
		}
		bytes = append(bytes, byte(character))
	}

	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(bytes)
	if err != nil || string(decoded) == value {
		return false
	}
	for _, character := range string(decoded) {
		if character >= 0x4e00 && character <= 0x9fff {
			return true
		}
	}
	return false
}

func number(value string) int {
	value = strings.SplitN(value, "/", 2)[0]
	n, _ := strconv.Atoi(strings.TrimSpace(value))
	return n
}

func contentType(extension string) string {
	switch extension {
	case "mp3":
		return "audio/mpeg"
	case "m4a", "mp4", "aac":
		return "audio/mp4"
	case "ogg", "oga", "opus":
		return "audio/ogg"
	case "flac":
		return "audio/flac"
	case "wav", "wave":
		return "audio/wav"
	case "aiff", "aif":
		return "audio/aiff"
	default:
		return "application/octet-stream"
	}
}

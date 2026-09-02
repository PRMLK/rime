package lyrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

const defaultLRCLIBURL = "https://lrclib.net"

var versionSuffix = regexp.MustCompile(`(?i)\s*[-–—]\s*(guitar|piano)\s*$`)

type LRCLIBClient struct {
	baseURL   string
	http      *http.Client
	userAgent string
}

func NewLRCLIBClient(baseURL, userAgent string, httpClient *http.Client) *LRCLIBClient {
	if baseURL == "" {
		baseURL = defaultLRCLIBURL
	}
	if userAgent == "" {
		userAgent = "Rime/0.1"
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &LRCLIBClient{baseURL: strings.TrimRight(baseURL, "/"), http: httpClient, userAgent: userAgent}
}

func (c *LRCLIBClient) Find(ctx context.Context, track TrackCandidate) (Fetched, bool, error) {
	titles := []string{track.Title}
	if stripped := strings.TrimSpace(versionSuffix.ReplaceAllString(track.Title, "")); stripped != "" && stripped != track.Title {
		titles = append(titles, stripped)
	}
	for _, title := range titles {
		results, err := c.search(ctx, title, firstArtist(track.Artists))
		if err != nil {
			return Fetched{}, false, err
		}
		if result, ok := bestLRCLIBResult(track, results); ok {
			if strings.TrimSpace(result.SyncedLyrics) != "" {
				return Fetched{Ref: strconv.FormatInt(result.ID, 10), Format: "lrc", Content: result.SyncedLyrics}, true, nil
			}
			if strings.TrimSpace(result.PlainLyrics) != "" {
				return Fetched{Ref: strconv.FormatInt(result.ID, 10), Format: "plain", Content: result.PlainLyrics}, true, nil
			}
		}
	}
	return Fetched{}, false, nil
}

func (c *LRCLIBClient) search(ctx context.Context, title, artist string) ([]lrclibResult, error) {
	parameters := url.Values{}
	parameters.Set("track_name", title)
	parameters.Set("artist_name", artist)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/search?"+parameters.Encode(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", c.userAgent)
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("search LRCLIB: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search LRCLIB: unexpected status %s", response.Status)
	}
	var results []lrclibResult
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&results); err != nil {
		return nil, fmt.Errorf("decode LRCLIB response: %w", err)
	}
	return results, nil
}

type lrclibResult struct {
	ID           int64   `json:"id"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	AlbumName    string  `json:"albumName"`
	Duration     float64 `json:"duration"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

func bestLRCLIBResult(track TrackCandidate, results []lrclibResult) (lrclibResult, bool) {
	bestScore := -1
	best := lrclibResult{}
	for _, result := range results {
		if normalizeForMatch(result.TrackName) != normalizeForMatch(track.Title) {
			continue
		}
		if !artistMatches(result.ArtistName, track.Artists) {
			continue
		}
		durationDifference := math.Abs(result.Duration*1000 - float64(track.DurationMs))
		if durationDifference > 3_000 {
			continue
		}
		score := 100 - int(durationDifference/100)
		if normalizeForMatch(result.AlbumName) == normalizeForMatch(track.Album) {
			score += 20
		}
		if result.SyncedLyrics != "" {
			score += 5
		}
		if score > bestScore {
			bestScore = score
			best = result
		}
	}
	return best, bestScore >= 0
}

func artistMatches(candidate string, artists []string) bool {
	candidate = normalizeForMatch(candidate)
	for _, artist := range artists {
		normalizedArtist := normalizeForMatch(artist)
		if candidate == normalizedArtist || (len([]rune(normalizedArtist)) >= 2 && strings.Contains(candidate, normalizedArtist)) {
			return true
		}
	}
	return false
}

func normalizeForMatch(value string) string {
	var result strings.Builder
	lastSpace := true
	for _, character := range strings.ToLower(norm.NFKC.String(value)) {
		if unicode.IsLetter(character) || unicode.IsNumber(character) {
			result.WriteRune(character)
			lastSpace = false
		} else if !lastSpace {
			result.WriteByte(' ')
			lastSpace = true
		}
	}
	return strings.TrimSpace(result.String())
}

func firstArtist(artists []string) string {
	if len(artists) == 0 {
		return ""
	}
	return artists[0]
}

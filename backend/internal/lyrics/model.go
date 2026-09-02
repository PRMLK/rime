package lyrics

import (
	"context"
	"errors"
	"time"
)

const (
	SourceManual   = "manual"
	SourceSidecar  = "sidecar"
	SourceEmbedded = "embedded"
	SourceLRCLIB   = "lrclib"
)

var ErrNotFound = errors.New("lyrics not found")

type Line struct {
	StartMs *int64 `json:"startMs,omitempty"`
	EndMs   *int64 `json:"endMs,omitempty"`
	Text    string `json:"text"`
}

type Document struct {
	TrackID string `json:"trackId"`
	Source  string `json:"source"`
	Synced  bool   `json:"synced"`
	Lines   []Line `json:"lines"`
}

type Source struct {
	TrackID     string
	Kind        string
	Ref         string
	Format      string
	Content     string
	ContentHash string
	UpdatedAt   time.Time
}

type TrackCandidate struct {
	ID         string
	Title      string
	Album      string
	Artists    []string
	DurationMs int64
	MediaPath  string
}

type Repository interface {
	ListLyricsTracks(context.Context) ([]TrackCandidate, error)
	UpsertLyricsSource(context.Context, Source) error
	DeleteLyricsSource(context.Context, string, string) error
	GetLyricsSource(context.Context, string) (Source, error)
}

type Fetched struct {
	Ref     string
	Format  string
	Content string
}

type Provider interface {
	Find(context.Context, TrackCandidate) (Fetched, bool, error)
}

type Report struct {
	Discovered int
	Updated    int
	Missing    int
	Failed     int
	Duration   time.Duration
}

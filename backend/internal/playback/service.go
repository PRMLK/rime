package playback

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"rime/backend/internal/catalog"
	"rime/backend/internal/id"
)

var (
	ErrTrackNotFound     = errors.New("track not found")
	ErrSessionNotFound   = errors.New("playback session not found")
	ErrUnsupportedFormat = errors.New("no supported playback format")
)

type Format struct {
	Container string `json:"container"`
	Codec     string `json:"codec,omitempty"`
}

type Capabilities struct {
	Formats           []Format `json:"formats"`
	SupportsByteRange bool     `json:"supportsByteRange"`
}

type CreateRequest struct {
	TrackID       string       `json:"trackId"`
	StartPosition int64        `json:"startPositionMs,omitempty"`
	PlayerID      string       `json:"playerId"`
	Capabilities  Capabilities `json:"capabilities"`
}

type Source struct {
	Kind        string `json:"kind"`
	Href        string `json:"href"`
	ContentType string `json:"contentType"`
	Container   string `json:"container"`
	Codec       string `json:"codec,omitempty"`
	BitrateKbps int    `json:"bitrateKbps,omitempty"`
	SeekMethod  string `json:"seekMethod"`
}

type Session struct {
	SessionID string        `json:"sessionId"`
	Track     catalog.Track `json:"track"`
	Source    Source        `json:"source"`
	ExpiresAt time.Time     `json:"expiresAt"`
}

type Event struct {
	EventID    string    `json:"eventId"`
	Type       string    `json:"type"`
	PositionMs int64     `json:"positionMs"`
	OccurredAt time.Time `json:"occurredAt"`
}

type Repository interface {
	GetTrack(context.Context, string) (catalog.Track, error)
	AvailableMedia(context.Context, string) ([]catalog.MediaFile, error)
	CreatePlaybackSession(context.Context, string, string, string, string, time.Time, time.Time) error
	PlaybackSessionMedia(context.Context, string, time.Time) (catalog.Track, catalog.MediaFile, error)
	RecordPlaybackEvent(context.Context, string, Event) error
	DeletePlaybackSession(context.Context, string) error
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func New(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

func (s *Service) Create(ctx context.Context, request CreateRequest) (Session, error) {
	if request.TrackID == "" {
		return Session{}, fmt.Errorf("trackId is required")
	}
	if request.PlayerID == "" {
		request.PlayerID = "unknown"
	}
	track, err := s.repo.GetTrack(ctx, request.TrackID)
	if err != nil {
		return Session{}, err
	}
	media, err := s.repo.AvailableMedia(ctx, request.TrackID)
	if err != nil {
		return Session{}, err
	}
	selected, ok := chooseMedia(media, request.Capabilities.Formats)
	if !ok {
		return Session{}, ErrUnsupportedFormat
	}
	sessionID, err := id.New("pbs")
	if err != nil {
		return Session{}, err
	}
	createdAt := s.now().UTC()
	expiresAt := createdAt.Add(6 * time.Hour)
	if err := s.repo.CreatePlaybackSession(ctx, sessionID, track.ID, selected.ID, request.PlayerID, createdAt, expiresAt); err != nil {
		return Session{}, err
	}

	return Session{
		SessionID: sessionID,
		Track:     track,
		Source: Source{
			Kind:        "direct",
			Href:        "/api/v1/playback/sessions/" + sessionID + "/stream",
			ContentType: selected.ContentType,
			Container:   selected.Container,
			Codec:       selected.Codec,
			BitrateKbps: selected.BitrateKbps,
			SeekMethod:  "byteRange",
		},
		ExpiresAt: expiresAt,
	}, nil
}

func (s *Service) Stream(ctx context.Context, sessionID string) (catalog.Track, catalog.MediaFile, error) {
	return s.repo.PlaybackSessionMedia(ctx, sessionID, s.now().UTC())
}

func (s *Service) Record(ctx context.Context, sessionID string, event Event) error {
	switch event.Type {
	case "started", "progress", "paused", "ended":
	default:
		return fmt.Errorf("unsupported playback event type")
	}
	if event.EventID == "" {
		return fmt.Errorf("eventId is required")
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = s.now().UTC()
	}
	return s.repo.RecordPlaybackEvent(ctx, sessionID, event)
}

func (s *Service) Delete(ctx context.Context, sessionID string) error {
	return s.repo.DeletePlaybackSession(ctx, sessionID)
}

func chooseMedia(media []catalog.MediaFile, formats []Format) (catalog.MediaFile, bool) {
	if len(formats) == 0 {
		if len(media) == 0 {
			return catalog.MediaFile{}, false
		}
		return media[0], true
	}
	for _, format := range formats {
		for _, candidate := range media {
			containerMatch := strings.EqualFold(format.Container, candidate.Container)
			codecMatch := format.Codec == "" || candidate.Codec == "" || strings.EqualFold(format.Codec, candidate.Codec)
			if containerMatch && codecMatch {
				return candidate, true
			}
		}
	}
	return catalog.MediaFile{}, false
}

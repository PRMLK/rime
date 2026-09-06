package playback

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"rime/backend/internal/catalog"
	"rime/backend/internal/id"
)

var (
	ErrTrackNotFound       = errors.New("track not found")
	ErrSessionNotFound     = errors.New("playback session not found")
	ErrUnsupportedFormat   = errors.New("no supported playback format")
	ErrInvalidCapabilities = errors.New("invalid playback capabilities")
)

type Format struct {
	Container string `json:"container"`
	Codec     string `json:"codec,omitempty"`
}

type Capabilities struct {
	Formats           []Format `json:"formats"`
	SupportsByteRange bool     `json:"supportsByteRange"`
	Quality           string   `json:"quality,omitempty"`
	MaxBitrateKbps    int      `json:"maxBitrateKbps,omitempty"`
}

type CreateRequest struct {
	TrackID       string       `json:"trackId"`
	StartPosition int64        `json:"startPositionMs,omitempty"`
	PlayerID      string       `json:"playerId"`
	Capabilities  Capabilities `json:"capabilities"`
}

type Source struct {
	Kind          string `json:"kind"`
	Href          string `json:"href"`
	ContentType   string `json:"contentType"`
	Container     string `json:"container"`
	Codec         string `json:"codec,omitempty"`
	BitrateKbps   int    `json:"bitrateKbps,omitempty"`
	SeekMethod    string `json:"seekMethod"`
	ContentKey    string `json:"contentKey"`
	ContentLength int64  `json:"contentLength"`
	ETag          string `json:"etag"`
	ProfileID     string `json:"profileId,omitempty"`
	Cacheable     bool   `json:"cacheable"`
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

type ResolvedMedia struct {
	Kind       string
	Media      catalog.MediaFile
	ContentKey string
	ProfileID  string
}

type SessionRecord struct {
	ID        string
	UserID    string
	TrackID   string
	MediaID   string
	PlayerID  string
	Source    ResolvedMedia
	CreatedAt time.Time
	ExpiresAt time.Time
}

type Repository interface {
	GetTrack(context.Context, string) (catalog.Track, error)
	AvailableMedia(context.Context, string) ([]catalog.MediaFile, error)
	CreatePlaybackSession(context.Context, SessionRecord) error
	PlaybackSessionMedia(context.Context, string, time.Time) (catalog.Track, ResolvedMedia, error)
	RecordPlaybackEvent(context.Context, string, string, Event) error
	DeletePlaybackSession(context.Context, string, string) error
}

type Transcoder interface {
	Available() bool
	Resolve(context.Context, catalog.MediaFile, Format, int) (ResolvedMedia, error)
}

type Service struct {
	repo       Repository
	transcoder Transcoder
	now        func() time.Time
}

func New(repo Repository, transcoders ...Transcoder) *Service {
	service := &Service{repo: repo, now: time.Now}
	if len(transcoders) > 0 {
		service.transcoder = transcoders[0]
	}
	return service
}

func (s *Service) SupportsTranscoding() bool {
	return s.transcoder != nil && s.transcoder.Available()
}

func (s *Service) Create(ctx context.Context, userID string, request CreateRequest) (Session, error) {
	if request.TrackID == "" {
		return Session{}, fmt.Errorf("trackId is required")
	}
	if request.PlayerID == "" {
		request.PlayerID = "unknown"
	}
	if err := validateCapabilities(request.Capabilities); err != nil {
		return Session{}, err
	}
	track, err := s.repo.GetTrack(ctx, request.TrackID)
	if err != nil {
		return Session{}, err
	}
	media, err := s.repo.AvailableMedia(ctx, request.TrackID)
	if err != nil {
		return Session{}, err
	}
	selected, ok := chooseMedia(media, request.Capabilities.Formats, request.Capabilities.Quality, request.Capabilities.MaxBitrateKbps)
	resolved := ResolvedMedia{}
	if ok {
		resolved = directSource(selected)
	} else {
		resolved, err = s.resolveTranscode(ctx, media, request.Capabilities)
		if err != nil {
			return Session{}, err
		}
	}

	sessionID, err := id.New("pbs")
	if err != nil {
		return Session{}, err
	}
	createdAt := s.now().UTC()
	expiresAt := createdAt.Add(6 * time.Hour)
	record := SessionRecord{
		ID: sessionID, UserID: userID, TrackID: track.ID, MediaID: resolved.Media.ID,
		PlayerID: request.PlayerID, Source: resolved, CreatedAt: createdAt, ExpiresAt: expiresAt,
	}
	if err := s.repo.CreatePlaybackSession(ctx, record); err != nil {
		return Session{}, err
	}

	return Session{SessionID: sessionID, Track: track, Source: responseSource(sessionID, resolved), ExpiresAt: expiresAt}, nil
}

func (s *Service) resolveTranscode(ctx context.Context, media []catalog.MediaFile, capabilities Capabilities) (ResolvedMedia, error) {
	if len(media) == 0 || !s.SupportsTranscoding() {
		return ResolvedMedia{}, ErrUnsupportedFormat
	}
	target, ok := chooseTranscodeFormat(capabilities.Formats)
	if !ok {
		return ResolvedMedia{}, ErrUnsupportedFormat
	}
	bitrate := capabilities.MaxBitrateKbps
	if bitrate == 0 {
		if capabilities.Quality == "original" {
			bitrate = 256
		} else {
			bitrate = 192
		}
	}
	if sourceBitrate := media[0].BitrateKbps; sourceBitrate > 0 && sourceBitrate < bitrate {
		bitrate = sourceBitrate
		if bitrate < 32 {
			bitrate = 32
		}
	}
	resolved, err := s.transcoder.Resolve(ctx, media[0], target, bitrate)
	if err != nil {
		return ResolvedMedia{}, fmt.Errorf("transcode playback source: %w", err)
	}
	return resolved, nil
}

func (s *Service) Stream(ctx context.Context, sessionID string) (catalog.Track, ResolvedMedia, error) {
	return s.repo.PlaybackSessionMedia(ctx, sessionID, s.now().UTC())
}

func (s *Service) Record(ctx context.Context, userID, sessionID string, event Event) error {
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
	return s.repo.RecordPlaybackEvent(ctx, userID, sessionID, event)
}

func (s *Service) Delete(ctx context.Context, userID, sessionID string) error {
	return s.repo.DeletePlaybackSession(ctx, userID, sessionID)
}

func validateCapabilities(capabilities Capabilities) error {
	if capabilities.Quality != "" && capabilities.Quality != "auto" && capabilities.Quality != "original" && capabilities.Quality != "limited" {
		return fmt.Errorf("%w: unsupported quality", ErrInvalidCapabilities)
	}
	if capabilities.MaxBitrateKbps != 0 && (capabilities.MaxBitrateKbps < 32 || capabilities.MaxBitrateKbps > 320) {
		return fmt.Errorf("%w: maxBitrateKbps must be between 32 and 320", ErrInvalidCapabilities)
	}
	return nil
}

func chooseMedia(media []catalog.MediaFile, formats []Format, quality string, maxBitrateKbps int) (catalog.MediaFile, bool) {
	if len(formats) == 0 {
		if len(media) == 0 {
			return catalog.MediaFile{}, false
		}
		return media[0], directAllowed(media[0], quality, maxBitrateKbps)
	}
	for _, format := range formats {
		for _, candidate := range media {
			containerMatch := strings.EqualFold(format.Container, candidate.Container)
			codecMatch := format.Codec == "" || candidate.Codec == "" || strings.EqualFold(format.Codec, candidate.Codec)
			if containerMatch && codecMatch && directAllowed(candidate, quality, maxBitrateKbps) {
				return candidate, true
			}
		}
	}
	return catalog.MediaFile{}, false
}

func directAllowed(media catalog.MediaFile, quality string, maxBitrateKbps int) bool {
	return quality == "original" || maxBitrateKbps == 0 || (media.BitrateKbps > 0 && media.BitrateKbps <= maxBitrateKbps)
}

func chooseTranscodeFormat(formats []Format) (Format, bool) {
	for _, format := range formats {
		container := strings.ToLower(format.Container)
		codec := strings.ToLower(format.Codec)
		if (container == "m4a" || container == "mp4") && (codec == "" || codec == "aac") {
			return Format{Container: "m4a", Codec: "aac"}, true
		}
		if container == "mp3" && (codec == "" || codec == "mp3") {
			return Format{Container: "mp3", Codec: "mp3"}, true
		}
	}
	return Format{}, false
}

func directSource(media catalog.MediaFile) ResolvedMedia {
	digest := sha256.Sum256([]byte(media.ID + "\x00" + media.ContentVersion))
	return ResolvedMedia{Kind: "direct", Media: media, ContentKey: fmt.Sprintf("%x", digest)}
}

func responseSource(sessionID string, resolved ResolvedMedia) Source {
	return Source{
		Kind: resolved.Kind, Href: "/api/v1/playback/sessions/" + sessionID + "/stream",
		ContentType: resolved.Media.ContentType, Container: resolved.Media.Container, Codec: resolved.Media.Codec,
		BitrateKbps: resolved.Media.BitrateKbps, SeekMethod: "byteRange", ContentKey: resolved.ContentKey,
		ContentLength: resolved.Media.Size, ETag: fmt.Sprintf("\"%s\"", resolved.Media.ContentVersion),
		ProfileID: resolved.ProfileID, Cacheable: true,
	}
}

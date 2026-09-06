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

// HistoryPage 表示当前用户近期播放过的歌曲。
// Items 中同一首歌曲至多出现一次，并按该歌曲最近一次开始播放的时间倒序排列。
type HistoryPage struct {
	Items []catalog.Track `json:"items"`
}

type Repository interface {
	GetTrack(context.Context, string) (catalog.Track, error)
	AvailableMedia(context.Context, string) ([]catalog.MediaFile, error)
	CreatePlaybackSession(context.Context, string, string, string, string, string, time.Time, time.Time) error
	PlaybackSessionMedia(context.Context, string, time.Time) (catalog.Track, catalog.MediaFile, error)
	RecordPlaybackEvent(context.Context, string, string, Event, time.Time) error
	RecentPlaybackTracks(context.Context, string, int) ([]catalog.Track, error)
	DeletePlaybackSession(context.Context, string, string) error
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func New(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

func (s *Service) Create(ctx context.Context, userID string, request CreateRequest) (Session, error) {
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
	if err := s.repo.CreatePlaybackSession(ctx, sessionID, userID, track.ID, selected.ID, request.PlayerID, createdAt, expiresAt); err != nil {
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

func (s *Service) Record(ctx context.Context, userID, sessionID string, event Event) error {
	switch event.Type {
	case "started", "progress", "paused", "ended":
	default:
		return fmt.Errorf("unsupported playback event type")
	}
	if event.EventID == "" {
		return fmt.Errorf("eventId is required")
	}
	now := s.now().UTC()
	if event.OccurredAt.IsZero() {
		event.OccurredAt = now
	}
	// 会话是否仍有效必须由服务端时间判断，不能信任客户端上报的 occurredAt（发生时间）。
	// 这样延迟重试的事件也无法让已过期、且已不能串流的会话写入继续聆听历史。
	return s.repo.RecordPlaybackEvent(ctx, userID, sessionID, event, now)
}

// RecentTracks 返回当前用户近期实际开始播放过的歌曲。
//
// 参数 ctx 用于取消请求，userID 标识历史归属用户，limit 为首页需要展示的条数；留空时
// 默认返回 12 条，范围限制在 1 到 50。底层已将每位用户的历史永久裁剪至最近 300 条，
// 因此读取接口不需要暴露播放进度或分页游标。
func (s *Service) RecentTracks(ctx context.Context, userID string, limit int) (HistoryPage, error) {
	if limit == 0 {
		limit = 12
	}
	if limit < 1 || limit > 50 {
		return HistoryPage{}, fmt.Errorf("limit must be between 1 and 50")
	}
	items, err := s.repo.RecentPlaybackTracks(ctx, userID, limit)
	if err != nil {
		return HistoryPage{}, err
	}
	return HistoryPage{Items: items}, nil
}

func (s *Service) Delete(ctx context.Context, userID, sessionID string) error {
	return s.repo.DeletePlaybackSession(ctx, userID, sessionID)
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

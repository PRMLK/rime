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
	Tags              []string `json:"tags,omitempty"`
}

const androidClientTag = "android"

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

// HistoryPage 表示当前用户近期播放过的歌曲。
// Items 中同一首歌曲至多出现一次，并按该歌曲最近一次开始播放的时间倒序排列。
type HistoryPage struct {
	Items []catalog.Track `json:"items"`
}

// ResolvedMedia 表示已经确定的播放媒体来源。
// Media 保存原始或转码后的文件信息，Kind、ContentKey 和 ProfileID（配置标识）
// 用于让会话在创建后仍能稳定地串流并提供客户端缓存元数据。
type ResolvedMedia struct {
	Kind       string
	Media      catalog.MediaFile
	ContentKey string
	ProfileID  string
}

// SessionRecord 表示需要持久化的播放会话。
// 将会话与已解析媒体一并写入，避免用户后续修改播放偏好或媒体扫描结果时改变既有会话的来源。
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
	RecordPlaybackEvent(context.Context, string, string, Event, time.Time) error
	RecentPlaybackTracks(context.Context, string, int) ([]catalog.Track, error)
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
	resolved := ResolvedMedia{}
	if hasClientTag(request.Capabilities.Tags, androidClientTag) {
		// Android 原生播放器不使用 WebView 的实际解码结果选源。固定为 M4A/AAC
		// 能避免 WebView 宣称支持、但 Media3 在后台或熄屏时不稳定的容器进入服务。
		resolved, err = s.resolveAndroidSource(ctx, media, request.Capabilities)
	} else {
		resolved, err = s.resolveDefaultSource(ctx, media, request.Capabilities)
	}
	if err != nil {
		return Session{}, err
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

/**
 * resolveDefaultSource 保持未标记客户端既有的格式协商和直连回退策略。
 *
 * @param ctx 用于取消正在执行的转码。
 * @param media 曲目当前可用的原始媒体文件，按大小降序排列。
 * @param capabilities 客户端声明的格式、码率与音质偏好。
 * @returns 可供该客户端播放的直连或转码来源。
 */
func (s *Service) resolveDefaultSource(ctx context.Context, media []catalog.MediaFile, capabilities Capabilities) (ResolvedMedia, error) {
	selected, ok := chooseMedia(media, capabilities.Formats, capabilities.Quality, capabilities.MaxBitrateKbps)
	if ok {
		return directSource(selected), nil
	}
	resolved, err := s.resolveTranscode(ctx, media, capabilities)
	if err == nil {
		return resolved, nil
	}
	// 请求已取消时不能创建新的会话。除此之外，转码器缺失、编码器不可用、
	// 缓存目录不可写等失败都可以尝试同一份安全直连回退。
	if ctx.Err() != nil {
		return ResolvedMedia{}, err
	}

	// 自动/限码率模式优先请求较低码率媒体，但该偏好不能让播放器已明确
	// 支持的原始文件变为不可播放。转码无法完成时忽略码率限制重新匹配；
	// 容器和编解码器仍须完全匹配，不能把未知格式交给客户端冒险解码。
	fallback, fallbackOK := chooseMedia(media, capabilities.Formats, "original", 0)
	if !fallbackOK {
		return ResolvedMedia{}, err
	}
	return directSource(fallback), nil
}

/**
 * resolveAndroidSource 为携带 android 标签的客户端固定解析 M4A/AAC 播放源。
 *
 * 优先复用符合用户码率偏好的已有 AAC 文件，避免无谓转码；没有合适文件时，必须由
 * FFmpeg 转码为 AAC。这里故意不回退到 FLAC、OPUS 等原文件，确保 Android 标签确实
 * 对应稳定且可预测的媒体容器，而不是只作为统计字段。
 *
 * @param ctx 用于取消正在执行的转码。
 * @param media 曲目当前可用的原始媒体文件，按大小降序排列。
 * @param capabilities Android 客户端请求的音质与最大码率。
 * @returns M4A/AAC 直连文件或转码缓存文件；无法产生 AAC 时返回播放格式错误。
 */
func (s *Service) resolveAndroidSource(ctx context.Context, media []catalog.MediaFile, capabilities Capabilities) (ResolvedMedia, error) {
	androidFormat := Format{Container: "m4a", Codec: "aac"}
	if selected, ok := chooseMedia(media, []Format{androidFormat}, capabilities.Quality, capabilities.MaxBitrateKbps); ok {
		return directSource(selected), nil
	}
	return s.resolveTranscodeFormat(ctx, media, androidFormat, capabilities)
}

func (s *Service) resolveTranscode(ctx context.Context, media []catalog.MediaFile, capabilities Capabilities) (ResolvedMedia, error) {
	if len(media) == 0 || !s.SupportsTranscoding() {
		return ResolvedMedia{}, ErrUnsupportedFormat
	}
	target, ok := chooseTranscodeFormat(capabilities.Formats)
	if !ok {
		return ResolvedMedia{}, ErrUnsupportedFormat
	}
	return s.resolveTranscodeFormat(ctx, media, target, capabilities)
}

/**
 * resolveTranscodeFormat 将首选原始文件转为指定的、已由策略选定的输出格式。
 *
 * @param ctx 用于取消 FFmpeg（多媒体转码器）进程。
 * @param media 曲目当前可用的原始媒体文件，首项是服务端优先使用的高质量来源。
 * @param target 目标容器和编解码器，调用方必须已完成兼容性或平台策略判断。
 * @param capabilities 用户请求的音质与最大码率。
 * @returns 已缓存或新生成的转码来源。
 */
func (s *Service) resolveTranscodeFormat(ctx context.Context, media []catalog.MediaFile, target Format, capabilities Capabilities) (ResolvedMedia, error) {
	if len(media) == 0 || !s.SupportsTranscoding() {
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

func validateCapabilities(capabilities Capabilities) error {
	if capabilities.Quality != "" && capabilities.Quality != "auto" && capabilities.Quality != "original" && capabilities.Quality != "limited" {
		return fmt.Errorf("%w: unsupported quality", ErrInvalidCapabilities)
	}
	if capabilities.MaxBitrateKbps != 0 && (capabilities.MaxBitrateKbps < 32 || capabilities.MaxBitrateKbps > 320) {
		return fmt.Errorf("%w: maxBitrateKbps must be between 32 and 320", ErrInvalidCapabilities)
	}
	return nil
}

/**
 * hasClientTag 判断客户端是否声明了某个不区分大小写的能力标签。
 *
 * 标签来自客户端请求，不能承担身份或权限判断；仅用于决定返回哪种兼容播放源。
 *
 * @param tags 客户端提交的标签集合。
 * @param expected 需要匹配的规范化标签，例如 android。
 * @returns 存在匹配标签时返回 true。
 */
func hasClientTag(tags []string, expected string) bool {
	for _, tag := range tags {
		if strings.EqualFold(strings.TrimSpace(tag), expected) {
			return true
		}
	}
	return false
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

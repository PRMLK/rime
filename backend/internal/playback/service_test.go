package playback

import (
	"context"
	"errors"
	"testing"
	"time"

	"rime/backend/internal/catalog"
)

type playbackRepositoryStub struct {
	track  catalog.Track
	media  []catalog.MediaFile
	record SessionRecord
}

func (r *playbackRepositoryStub) GetTrack(context.Context, string) (catalog.Track, error) {
	return r.track, nil
}

func (r *playbackRepositoryStub) AvailableMedia(context.Context, string) ([]catalog.MediaFile, error) {
	return r.media, nil
}

func (r *playbackRepositoryStub) CreatePlaybackSession(_ context.Context, record SessionRecord) error {
	r.record = record
	return nil
}

func (r *playbackRepositoryStub) PlaybackSessionMedia(context.Context, string, time.Time) (catalog.Track, ResolvedMedia, error) {
	return r.track, r.record.Source, nil
}

func (*playbackRepositoryStub) RecordPlaybackEvent(context.Context, string, string, Event, time.Time) error {
	return nil
}

// RecentPlaybackTracks 为播放服务测试提供空的历史读取结果。
// 该测试桩仅覆盖转码和直连来源选择，不需要构造持久化历史；因此返回空列表且不返回错误。
// 参数依次为请求上下文、用户 ID 和读取条数，返回值与 Repository（仓储）接口保持一致。
func (*playbackRepositoryStub) RecentPlaybackTracks(context.Context, string, int) ([]catalog.Track, error) {
	return nil, nil
}

func (*playbackRepositoryStub) DeletePlaybackSession(context.Context, string, string) error {
	return nil
}

type transcoderStub struct {
	called  bool
	target  Format
	bitrate int
	source  ResolvedMedia
	err     error
}

func (*transcoderStub) Available() bool { return true }

func (t *transcoderStub) Resolve(_ context.Context, _ catalog.MediaFile, target Format, bitrate int) (ResolvedMedia, error) {
	t.called = true
	t.target = target
	t.bitrate = bitrate
	return t.source, t.err
}

func TestCreateTranscodesPlayableSourceAboveBitrateLimit(t *testing.T) {
	repository := &playbackRepositoryStub{
		track: catalog.Track{ID: "trk_1", Title: "Test"},
		media: []catalog.MediaFile{{ID: "med_1", TrackID: "trk_1", Container: "flac", Codec: "flac", BitrateKbps: 900, ContentVersion: "source-v1"}},
	}
	transcoder := &transcoderStub{source: ResolvedMedia{
		Kind: "transcode", ContentKey: "cached-aac", ProfileID: "aac-m4a-192-v1",
		Media: catalog.MediaFile{ID: "med_1", TrackID: "trk_1", Container: "m4a", Codec: "aac", ContentType: "audio/mp4", BitrateKbps: 192, Size: 1234, ContentVersion: "cached-aac"},
	}}
	service := New(repository, transcoder)

	session, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID: "trk_1", PlayerID: "player_1",
		Capabilities: Capabilities{
			Formats: []Format{{Container: "flac", Codec: "flac"}, {Container: "m4a", Codec: "aac"}},
			Quality: "limited", MaxBitrateKbps: 192, SupportsByteRange: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !transcoder.called || transcoder.target.Container != "m4a" || transcoder.bitrate != 192 {
		t.Fatalf("unexpected transcode selection: called=%v target=%+v bitrate=%d", transcoder.called, transcoder.target, transcoder.bitrate)
	}
	if session.Source.Kind != "transcode" || session.Source.ContentKey != "cached-aac" || session.Source.ContentLength != 1234 {
		t.Fatalf("unexpected source: %+v", session.Source)
	}
	if repository.record.Source.ProfileID != "aac-m4a-192-v1" {
		t.Fatalf("session record lost transcode profile: %+v", repository.record)
	}
}

func TestCreateUsesDirectSourceWithinBitrateLimit(t *testing.T) {
	repository := &playbackRepositoryStub{
		track: catalog.Track{ID: "trk_1", Title: "Test"},
		media: []catalog.MediaFile{{ID: "med_1", TrackID: "trk_1", Container: "mp3", Codec: "mp3", ContentType: "audio/mpeg", BitrateKbps: 128, Size: 400, ContentVersion: "400-1"}},
	}
	transcoder := &transcoderStub{}
	service := New(repository, transcoder)

	session, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID:      "trk_1",
		Capabilities: Capabilities{Formats: []Format{{Container: "mp3", Codec: "mp3"}}, Quality: "limited", MaxBitrateKbps: 192},
	})
	if err != nil {
		t.Fatal(err)
	}
	if transcoder.called || session.Source.Kind != "direct" || session.Source.ContentKey == "" {
		t.Fatalf("unexpected direct selection: called=%v source=%+v", transcoder.called, session.Source)
	}
}

// TestCreateForcesAACSourceForAndroidClient 验证 Android 标签会覆盖客户端格式列表，
// 固定请求 M4A/AAC 转码。这样即使 WebView 上报 FLAC，后台 Media3（Android 媒体框架）
// 也只会接收到稳定的 AAC 媒体流。
func TestCreateForcesAACSourceForAndroidClient(t *testing.T) {
	repository := &playbackRepositoryStub{
		track: catalog.Track{ID: "trk_1", Title: "Test"},
		media: []catalog.MediaFile{{
			ID: "med_1", TrackID: "trk_1", Container: "flac", Codec: "flac",
			ContentType: "audio/flac", BitrateKbps: 900, ContentVersion: "source-v1",
		}},
	}
	transcoder := &transcoderStub{source: ResolvedMedia{
		Kind: "transcode", ContentKey: "cached-aac", ProfileID: "aac-m4a-192-v1",
		Media: catalog.MediaFile{
			ID: "med_1", TrackID: "trk_1", Container: "m4a", Codec: "aac",
			ContentType: "audio/mp4", BitrateKbps: 192, Size: 1234, ContentVersion: "cached-aac",
		},
	}}
	service := New(repository, transcoder)

	session, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID: "trk_1", PlayerID: "player_1",
		Capabilities: Capabilities{
			Tags: []string{"android"},
			// 故意只声明 FLAC，证明 android 标签不依赖 WebView 的格式清单。
			Formats: []Format{{Container: "flac", Codec: "flac"}},
			Quality: "limited", MaxBitrateKbps: 192, SupportsByteRange: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !transcoder.called || transcoder.target != (Format{Container: "m4a", Codec: "aac"}) || transcoder.bitrate != 192 {
		t.Fatalf("unexpected Android source selection: called=%v target=%+v bitrate=%d", transcoder.called, transcoder.target, transcoder.bitrate)
	}
	if session.Source.Kind != "transcode" || session.Source.Container != "m4a" || session.Source.Codec != "aac" {
		t.Fatalf("unexpected Android source: %+v", session.Source)
	}
}

// TestCreateFallsBackToDirectSourceWhenTranscodingIsUnavailable 验证自动音质的码率
// 限制只是一项偏好。当原文件的格式已获播放器支持、却无法生成更低码率版本时，服务
// 必须退回原始文件，不能让可正常播放的歌曲变成不可用。
func TestCreateFallsBackToDirectSourceWhenTranscodingIsUnavailable(t *testing.T) {
	repository := &playbackRepositoryStub{
		track: catalog.Track{ID: "trk_1", Title: "Test"},
		media: []catalog.MediaFile{{
			ID: "med_1", TrackID: "trk_1", Container: "flac", Codec: "flac",
			ContentType: "audio/flac", BitrateKbps: 900, Size: 400, ContentVersion: "400-1",
		}},
	}
	// 不传入转码器，模拟裸机部署遗漏 FFmpeg（多媒体转码器）的场景。
	service := New(repository)

	session, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID: "trk_1", PlayerID: "player_1",
		Capabilities: Capabilities{
			Formats: []Format{{Container: "flac", Codec: "flac"}},
			Quality: "auto", MaxBitrateKbps: 256, SupportsByteRange: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.Source.Kind != "direct" || session.Source.BitrateKbps != 900 {
		t.Fatalf("unexpected fallback source: %+v", session.Source)
	}
}

// TestCreateFallsBackToDirectSourceWhenTranscodingFails 验证 FFmpeg（多媒体转码器）
// 虽然已安装但执行失败时，服务仍会优先让声明支持 FLAC 的播放器直连原文件。这样缓存
// 目录权限、损坏编码器或单次转码失败不会使本可播放的歌曲完全不可用。
func TestCreateFallsBackToDirectSourceWhenTranscodingFails(t *testing.T) {
	repository := &playbackRepositoryStub{
		track: catalog.Track{ID: "trk_1", Title: "Test"},
		media: []catalog.MediaFile{{
			ID: "med_1", TrackID: "trk_1", Container: "flac", Codec: "flac",
			ContentType: "audio/flac", BitrateKbps: 900, Size: 400, ContentVersion: "400-1",
		}},
	}
	transcoder := &transcoderStub{err: errors.New("ffmpeg exited with status 1")}
	service := New(repository, transcoder)

	session, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID: "trk_1", PlayerID: "player_1",
		Capabilities: Capabilities{
			// M4A 让服务实际尝试 FFmpeg；FLAC 保留为转码失败时可安全直连的原文件。
			Formats: []Format{{Container: "flac", Codec: "flac"}, {Container: "m4a", Codec: "aac"}},
			Quality: "auto", MaxBitrateKbps: 256, SupportsByteRange: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !transcoder.called || transcoder.target.Container != "m4a" || session.Source.Kind != "direct" || session.Source.BitrateKbps != 900 {
		t.Fatalf("unexpected fallback result: transcoder_called=%v target=%+v source=%+v", transcoder.called, transcoder.target, session.Source)
	}
}

// TestCreateRejectsUnsupportedFormatWithoutDirectOrTranscoding 确保降级仅适用于
// 客户端明确声明可播放的格式。没有匹配的直连格式时，不能把未知音源交给播放器。
func TestCreateRejectsUnsupportedFormatWithoutDirectOrTranscoding(t *testing.T) {
	repository := &playbackRepositoryStub{
		track: catalog.Track{ID: "trk_1", Title: "Test"},
		media: []catalog.MediaFile{{
			ID: "med_1", TrackID: "trk_1", Container: "wma", BitrateKbps: 192, ContentVersion: "source-v1",
		}},
	}
	service := New(repository)

	_, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID: "trk_1", PlayerID: "player_1",
		Capabilities: Capabilities{
			Formats: []Format{{Container: "mp3", Codec: "mp3"}},
			Quality: "auto", MaxBitrateKbps: 256, SupportsByteRange: true,
		},
	})
	if !errors.Is(err, ErrUnsupportedFormat) {
		t.Fatalf("error = %v, want ErrUnsupportedFormat", err)
	}
}

func TestCreateRejectsInvalidBitrateLimit(t *testing.T) {
	service := New(&playbackRepositoryStub{})
	_, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID: "trk_1", Capabilities: Capabilities{MaxBitrateKbps: 512},
	})
	if err == nil || !errors.Is(err, ErrInvalidCapabilities) {
		t.Fatalf("error = %v, want ErrInvalidCapabilities", err)
	}
}

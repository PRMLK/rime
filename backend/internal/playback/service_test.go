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

func (*playbackRepositoryStub) RecordPlaybackEvent(context.Context, string, string, Event) error {
	return nil
}
func (*playbackRepositoryStub) DeletePlaybackSession(context.Context, string, string) error {
	return nil
}

type transcoderStub struct {
	called  bool
	target  Format
	bitrate int
	source  ResolvedMedia
}

func (*transcoderStub) Available() bool { return true }

func (t *transcoderStub) Resolve(_ context.Context, _ catalog.MediaFile, target Format, bitrate int) (ResolvedMedia, error) {
	t.called = true
	t.target = target
	t.bitrate = bitrate
	return t.source, nil
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

func TestCreateRejectsInvalidBitrateLimit(t *testing.T) {
	service := New(&playbackRepositoryStub{})
	_, err := service.Create(context.Background(), "usr_1", CreateRequest{
		TrackID: "trk_1", Capabilities: Capabilities{MaxBitrateKbps: 512},
	})
	if err == nil || !errors.Is(err, ErrInvalidCapabilities) {
		t.Fatalf("error = %v, want ErrInvalidCapabilities", err)
	}
}

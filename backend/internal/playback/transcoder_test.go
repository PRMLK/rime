package playback

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rime/backend/internal/catalog"
)

func TestFileTranscoderReusesContentAddressedArtifact(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("test helper uses a POSIX shell")
	}
	root := t.TempDir()
	sourcePath := filepath.Join(root, "source.flac")
	if err := os.WriteFile(sourcePath, []byte("audio fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	counterPath := filepath.Join(root, "calls")
	ffmpegPath := filepath.Join(root, "ffmpeg")
	script := "#!/bin/sh\ninput=''\nprevious=''\nfor argument in \"$@\"; do\n  if [ \"$previous\" = '-i' ]; then input=\"$argument\"; fi\n  previous=\"$argument\"\n  output=\"$argument\"\ndone\nprintf 'call\\n' >> '" + counterPath + "'\ncp \"$input\" \"$output\"\n"
	if err := os.WriteFile(ffmpegPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	transcoder, err := NewFileTranscoder(filepath.Join(root, "cache"), ffmpegPath, 1024*1024, 1)
	if err != nil {
		t.Fatal(err)
	}
	source := catalog.MediaFile{ID: "med_1", TrackID: "trk_1", Path: sourcePath, ContentVersion: "v1"}

	first, err := transcoder.Resolve(context.Background(), source, Format{Container: "m4a", Codec: "aac"}, 192)
	if err != nil {
		t.Fatal(err)
	}
	second, err := transcoder.Resolve(context.Background(), source, Format{Container: "m4a", Codec: "aac"}, 192)
	if err != nil {
		t.Fatal(err)
	}
	if first.ContentKey != second.ContentKey || first.Media.Path != second.Media.Path || first.Media.Size == 0 {
		t.Fatalf("cache results differ: first=%+v second=%+v", first, second)
	}
	calls, err := os.ReadFile(counterPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(calls), "call") != 1 {
		t.Fatalf("ffmpeg calls = %q, want one", calls)
	}
}

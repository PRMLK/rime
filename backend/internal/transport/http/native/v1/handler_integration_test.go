package v1_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"rime/backend/internal/artwork"
	"rime/backend/internal/catalog"
	"rime/backend/internal/library/scanner"
	"rime/backend/internal/playback"
	"rime/backend/internal/search"
	"rime/backend/internal/store/sqlite"
	"rime/backend/internal/tasks"
	v1 "rime/backend/internal/transport/http/native/v1"
)

func TestSearchCreateSessionAndRangeStream(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	musicDir := filepath.Join(root, "music")
	if err := os.Mkdir(musicDir, 0o750); err != nil {
		t.Fatal(err)
	}
	audio := makeWAV(8000, 1)
	audioPath := filepath.Join(musicDir, "Morning Bell.wav")
	if err := os.WriteFile(audioPath, audio, 0o600); err != nil {
		t.Fatal(err)
	}
	writeCover(t, filepath.Join(musicDir, "cover.jpg"), 640, 360)
	artworkCacheRoot := filepath.Join(root, "cache", "artwork")
	artworkCache, err := artwork.NewCache(artworkCacheRoot, musicDir)
	if err != nil {
		t.Fatal(err)
	}

	store, err := sqlite.Open(filepath.Join(root, "rime.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	report, err := scanner.New(musicDir, artworkCache, store, logger).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report.Indexed != 1 || report.Failed != 0 {
		t.Fatalf("unexpected scan report: %+v", report)
	}
	if err := os.RemoveAll(artworkCacheRoot); err != nil {
		t.Fatal(err)
	}
	artworkCache, err = artwork.NewCache(artworkCacheRoot, musicDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scanner.New(musicDir, artworkCache, store, logger).Scan(context.Background()); err != nil {
		t.Fatalf("rebuild deleted artwork cache: %v", err)
	}

	taskService, err := tasks.New(context.Background(), store, tasks.Definition{
		ID:   "library.scan",
		Name: "扫描音乐库",
		Run: func(ctx context.Context) error {
			_, err := scanner.New(musicDir, artworkCache, store, logger).Scan(ctx)
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(taskService.Close)
	server := httptest.NewServer(v1.New(search.New(store), playback.New(store), artwork.NewService(store, artworkCache), taskService, logger))
	t.Cleanup(server.Close)

	assertScheduledTaskRun(t, server.URL)

	response, err := http.Get(server.URL + "/api/v1/search?query=Morning")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("search status: %s", response.Status)
	}
	var page struct {
		Items []catalog.Track `json:"items"`
	}
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Title != "Morning Bell" {
		t.Fatalf("unexpected search page: %+v", page)
	}
	if page.Items[0].ArtworkID == nil {
		t.Fatal("search result has no artwork ID")
	}

	response, err = http.Get(server.URL + "/api/v1/artworks/" + *page.Items[0].ArtworkID + "?size=128")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		t.Fatalf("artwork status: %s: %s", response.Status, body)
	}
	configuration, _, err := image.DecodeConfig(response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if configuration.Width != 128 || configuration.Height != 72 {
		t.Fatalf("thumbnail dimensions = %dx%d, want 128x72", configuration.Width, configuration.Height)
	}
	if response.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("unexpected artwork cache control: %q", response.Header.Get("Cache-Control"))
	}

	requestBody := []byte(`{"trackId":"` + page.Items[0].ID + `","playerId":"integration-test","capabilities":{"supportsByteRange":true,"formats":[{"container":"wav","codec":"pcm"}]}}`)
	response, err = http.Post(server.URL+"/api/v1/playback/sessions", "application/json", bytes.NewReader(requestBody))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("create session status: %s: %s", response.Status, body)
	}
	var session playback.Session
	if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	if session.Source.Container != "wav" || session.Source.BitrateKbps != 128 {
		t.Fatalf("unexpected playback source: %+v", session.Source)
	}

	request, err := http.NewRequest(http.MethodGet, server.URL+session.Source.Href, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Range", "bytes=8-15")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	got, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusPartialContent {
		t.Fatalf("range status: %s", response.Status)
	}
	if !bytes.Equal(got, audio[8:16]) {
		t.Fatalf("range body = %v, want %v", got, audio[8:16])
	}
}

func assertScheduledTaskRun(t *testing.T, serverURL string) {
	t.Helper()
	response, err := http.Post(serverURL+"/api/v1/system/tasks/library.scan/runs", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("run scheduled task status: %s", response.Status)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		response, err = http.Get(serverURL + "/api/v1/system/tasks")
		if err != nil {
			t.Fatal(err)
		}
		var page struct {
			Items []tasks.Task `json:"items"`
		}
		if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
			response.Body.Close()
			t.Fatal(err)
		}
		response.Body.Close()
		if len(page.Items) != 1 {
			t.Fatalf("scheduled tasks = %+v", page.Items)
		}
		if page.Items[0].Status == "idle" && page.Items[0].LastRunAt != nil {
			if page.Items[0].LastDurationMs == nil || page.Items[0].LastSucceeded == nil || !*page.Items[0].LastSucceeded {
				t.Fatalf("scheduled task result = %+v", page.Items[0])
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("scheduled task did not complete")
}

func writeCover(t *testing.T, path string, width, height int) {
	t.Helper()
	cover := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			cover.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 120, A: 255})
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, cover, &jpeg.Options{Quality: 90}); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func makeWAV(sampleRate, durationSeconds int) []byte {
	dataSize := sampleRate * durationSeconds * 2
	result := make([]byte, 44+dataSize)
	copy(result[0:4], "RIFF")
	binary.LittleEndian.PutUint32(result[4:8], uint32(36+dataSize))
	copy(result[8:12], "WAVE")
	copy(result[12:16], "fmt ")
	binary.LittleEndian.PutUint32(result[16:20], 16)
	binary.LittleEndian.PutUint16(result[20:22], 1)
	binary.LittleEndian.PutUint16(result[22:24], 1)
	binary.LittleEndian.PutUint32(result[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(result[28:32], uint32(sampleRate*2))
	binary.LittleEndian.PutUint16(result[32:34], 2)
	binary.LittleEndian.PutUint16(result[34:36], 16)
	copy(result[36:40], "data")
	binary.LittleEndian.PutUint32(result[40:44], uint32(dataSize))
	return result
}

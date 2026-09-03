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
	"rime/backend/internal/browse"
	"rime/backend/internal/catalog"
	"rime/backend/internal/library/scanner"
	"rime/backend/internal/lyrics"
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
	if err := os.WriteFile(filepath.Join(musicDir, "Morning Bell.lrc"), []byte("[00:00.00]Morning light\n[00:00.50]Ring the bell\n"), 0o600); err != nil {
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

	lyricsDir := filepath.Join(root, "data", "library", "lyrics")
	lyricsScanner := lyrics.NewScanner(lyricsDir, store, nil, logger)
	taskService, err := tasks.New(context.Background(), store,
		tasks.Definition{
			ID:   "library.scan",
			Name: "扫描音乐库",
			Run: func(ctx context.Context) error {
				_, err := scanner.New(musicDir, artworkCache, store, logger).Scan(ctx)
				return err
			},
		},
		tasks.Definition{
			ID:   "lyrics.scan",
			Name: "扫描歌词",
			Run: func(ctx context.Context) error {
				_, err := lyricsScanner.Scan(ctx)
				return err
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(taskService.Close)
	server := httptest.NewServer(v1.New(search.New(store), browse.New(store), lyrics.NewService(store), playback.New(store), artwork.NewService(store, artworkCache), taskService, logger))
	t.Cleanup(server.Close)

	assertRecentAlbums(t, server.URL)
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
	assertAlbumAndArtistDetails(t, server.URL, page.Items[0])
	if page.Items[0].ArtworkID == nil {
		t.Fatal("search result has no artwork ID")
	}
	assertLyrics(t, server.URL, page.Items[0].ID, lyrics.SourceSidecar)
	manualDir := filepath.Join(lyricsDir, page.Items[0].ID)
	if err := os.MkdirAll(manualDir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(manualDir, "manual.lrc"), []byte("[00:00.00]Manual line\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertScheduledTaskRunByID(t, server.URL, "lyrics.scan")
	assertLyrics(t, server.URL, page.Items[0].ID, lyrics.SourceManual)

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

// assertAlbumAndArtistDetails 验证专辑与歌手详情接口返回的关联资料。
// 参数 t 提供测试断言上下文，serverURL 是测试服务地址，track 提供已知有效的关联 ID。
// 函数不返回值；任一响应结构或内容不符合预期时立即终止测试。
func assertAlbumAndArtistDetails(t *testing.T, serverURL string, track catalog.Track) {
	t.Helper()

	response, err := http.Get(serverURL + "/api/v1/albums/" + track.Album.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("album detail status: %s", response.Status)
	}
	var albumDetail catalog.AlbumDetail
	if err := json.NewDecoder(response.Body).Decode(&albumDetail); err != nil {
		t.Fatal(err)
	}
	if albumDetail.ID != track.Album.ID || len(albumDetail.Tracks) != 1 || albumDetail.Tracks[0].ID != track.ID {
		t.Fatalf("unexpected album detail: %+v", albumDetail)
	}
	if len(albumDetail.Artists) != 1 {
		t.Fatalf("album detail has unexpected artists: %+v", albumDetail.Artists)
	}

	response, err = http.Get(serverURL + "/api/v1/artists/" + albumDetail.Artists[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("artist detail status: %s", response.Status)
	}
	var artistDetail catalog.ArtistDetail
	if err := json.NewDecoder(response.Body).Decode(&artistDetail); err != nil {
		t.Fatal(err)
	}
	if artistDetail.ID != albumDetail.Artists[0].ID || len(artistDetail.Albums) != 1 || artistDetail.Albums[0].ID != track.Album.ID {
		t.Fatalf("unexpected artist detail: %+v", artistDetail)
	}
	if artistDetail.Albums[0].AddedAt.IsZero() {
		t.Fatal("artist album detail has no addedAt")
	}
}

func assertRecentAlbums(t *testing.T, serverURL string) {
	t.Helper()
	response, err := http.Get(serverURL + "/api/v1/albums/recent?limit=10")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("recent albums status: %s", response.Status)
	}
	var page browse.AlbumPage
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Title != "Unknown Album" || page.Items[0].AddedAt.IsZero() {
		t.Fatalf("unexpected recent albums: %+v", page.Items)
	}
	if len(page.Items[0].Artists) != 1 || page.Items[0].Artists[0].Name != "Unknown Artist" {
		t.Fatalf("unexpected recent album artists: %+v", page.Items[0].Artists)
	}
}

func assertScheduledTaskRun(t *testing.T, serverURL string) {
	t.Helper()
	for _, taskID := range []string{"library.scan", "lyrics.scan"} {
		assertScheduledTaskRunByID(t, serverURL, taskID)
	}
}

func assertScheduledTaskRunByID(t *testing.T, serverURL, taskID string) {
	t.Helper()
	response, err := http.Post(serverURL+"/api/v1/system/tasks/"+taskID+"/runs", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("run scheduled task %s status: %s", taskID, response.Status)
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
		if len(page.Items) != 2 {
			t.Fatalf("scheduled tasks = %+v", page.Items)
		}
		for _, task := range page.Items {
			if task.ID == taskID && task.Status == "idle" && task.LastRunAt != nil {
				if task.LastDurationMs == nil || task.LastSucceeded == nil || !*task.LastSucceeded {
					t.Fatalf("scheduled task result = %+v", task)
				}
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("scheduled task %s did not complete", taskID)
}

func assertLyrics(t *testing.T, serverURL, trackID, expectedSource string) {
	t.Helper()
	response, err := http.Get(serverURL + "/api/v1/tracks/" + trackID + "/lyrics")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("lyrics status: %s: %s", response.Status, body)
	}
	var document lyrics.Document
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		t.Fatal(err)
	}
	if document.Source != expectedSource || !document.Synced || len(document.Lines) == 0 {
		t.Fatalf("unexpected lyrics: %+v", document)
	}
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

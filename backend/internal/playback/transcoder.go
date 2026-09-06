package playback

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"rime/backend/internal/catalog"
)

type transcodeJob struct {
	done   chan struct{}
	result ResolvedMedia
	err    error
}

type FileTranscoder struct {
	cacheDir  string
	ffmpeg    string
	maxBytes  int64
	semaphore chan struct{}
	mu        sync.Mutex
	jobs      map[string]*transcodeJob
}

const activeArtifactWindow = 6 * time.Hour

func NewFileTranscoder(cacheDir, ffmpegPath string, maxBytes int64, concurrency int) (*FileTranscoder, error) {
	if err := os.MkdirAll(cacheDir, 0o750); err != nil {
		return nil, fmt.Errorf("create transcode cache: %w", err)
	}
	resolvedFFmpeg, _ := exec.LookPath(ffmpegPath)
	if concurrency < 1 {
		concurrency = 1
	}
	transcoder := &FileTranscoder{
		cacheDir: cacheDir, ffmpeg: resolvedFFmpeg, maxBytes: maxBytes,
		semaphore: make(chan struct{}, concurrency), jobs: make(map[string]*transcodeJob),
	}
	transcoder.removePartialFiles()
	return transcoder, nil
}

func (t *FileTranscoder) Available() bool {
	return t != nil && t.ffmpeg != ""
}

func (t *FileTranscoder) Resolve(ctx context.Context, source catalog.MediaFile, target Format, bitrateKbps int) (ResolvedMedia, error) {
	if !t.Available() {
		return ResolvedMedia{}, ErrUnsupportedFormat
	}
	profile, extension, contentType, codec, err := transcodeProfile(target, bitrateKbps)
	if err != nil {
		return ResolvedMedia{}, err
	}
	digest := sha256.Sum256([]byte(source.ID + "\x00" + source.ContentVersion + "\x00" + profile))
	key := fmt.Sprintf("%x", digest)
	path := filepath.Join(t.cacheDir, key+extension)
	if result, ok := t.cached(source, target.Container, codec, contentType, profile, key, path); ok {
		return result, nil
	}

	t.mu.Lock()
	if existing := t.jobs[key]; existing != nil {
		t.mu.Unlock()
		select {
		case <-ctx.Done():
			return ResolvedMedia{}, ctx.Err()
		case <-existing.done:
			return existing.result, existing.err
		}
	}
	job := &transcodeJob{done: make(chan struct{})}
	t.jobs[key] = job
	t.mu.Unlock()

	job.result, job.err = t.generate(ctx, source, target.Container, codec, contentType, profile, key, path, extension, bitrateKbps)
	t.mu.Lock()
	delete(t.jobs, key)
	close(job.done)
	t.mu.Unlock()
	return job.result, job.err
}

func (t *FileTranscoder) generate(ctx context.Context, source catalog.MediaFile, container, codec, contentType, profile, key, path, extension string, bitrateKbps int) (ResolvedMedia, error) {
	select {
	case t.semaphore <- struct{}{}:
		defer func() { <-t.semaphore }()
	case <-ctx.Done():
		return ResolvedMedia{}, ctx.Err()
	}

	temporary, err := os.CreateTemp(t.cacheDir, key+".part-*"+extension)
	if err != nil {
		return ResolvedMedia{}, err
	}
	temporaryPath := temporary.Name()
	if err := temporary.Close(); err != nil {
		return ResolvedMedia{}, err
	}
	defer os.Remove(temporaryPath)

	args := []string{"-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", source.Path, "-map", "0:a:0", "-vn"}
	if codec == "aac" {
		args = append(args, "-c:a", "aac", "-b:a", fmt.Sprintf("%dk", bitrateKbps), "-movflags", "+faststart")
	} else {
		args = append(args, "-c:a", "libmp3lame", "-b:a", fmt.Sprintf("%dk", bitrateKbps))
	}
	args = append(args, temporaryPath)
	command := exec.CommandContext(ctx, t.ffmpeg, args...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if len(message) > 500 {
			message = message[len(message)-500:]
		}
		return ResolvedMedia{}, fmt.Errorf("ffmpeg: %w: %s", err, message)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return ResolvedMedia{}, err
	}
	result, ok := t.cached(source, container, codec, contentType, profile, key, path)
	if !ok {
		return ResolvedMedia{}, fmt.Errorf("transcoded file is empty")
	}
	t.prune(path)
	return result, nil
}

func (t *FileTranscoder) cached(source catalog.MediaFile, container, codec, contentType, profile, key, path string) (ResolvedMedia, bool) {
	info, err := os.Stat(path)
	if err != nil || info.Size() == 0 {
		return ResolvedMedia{}, false
	}
	now := time.Now()
	_ = os.Chtimes(path, now, now)
	return ResolvedMedia{
		Kind: "transcode", ContentKey: key, ProfileID: profile,
		Media: catalog.MediaFile{
			ID: source.ID, TrackID: source.TrackID, Path: path, Container: container, Codec: codec,
			ContentType: contentType, BitrateKbps: profileBitrate(profile), Size: info.Size(),
			ModifiedUnixMs: info.ModTime().UnixMilli(), ContentVersion: key,
		},
	}, true
}

func transcodeProfile(target Format, bitrateKbps int) (profile, extension, contentType, codec string, err error) {
	if bitrateKbps < 32 || bitrateKbps > 320 {
		return "", "", "", "", fmt.Errorf("unsupported transcode bitrate %d", bitrateKbps)
	}
	switch strings.ToLower(target.Container) {
	case "m4a", "mp4":
		return fmt.Sprintf("aac-m4a-%d-v1", bitrateKbps), ".m4a", "audio/mp4", "aac", nil
	case "mp3":
		return fmt.Sprintf("mp3-%d-v1", bitrateKbps), ".mp3", "audio/mpeg", "mp3", nil
	default:
		return "", "", "", "", ErrUnsupportedFormat
	}
}

func profileBitrate(profile string) int {
	var bitrate int
	if _, err := fmt.Sscanf(profile, "aac-m4a-%d-v1", &bitrate); err == nil {
		return bitrate
	}
	_, _ = fmt.Sscanf(profile, "mp3-%d-v1", &bitrate)
	return bitrate
}

func (t *FileTranscoder) removePartialFiles() {
	entries, _ := os.ReadDir(t.cacheDir)
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".part-") {
			_ = os.Remove(filepath.Join(t.cacheDir, entry.Name()))
		}
	}
}

func (t *FileTranscoder) prune(excluded string) {
	if t.maxBytes <= 0 {
		return
	}
	type cacheEntry struct {
		path     string
		size     int64
		modified time.Time
	}
	var files []cacheEntry
	var total int64
	entries, _ := os.ReadDir(t.cacheDir)
	for _, entry := range entries {
		path := filepath.Join(t.cacheDir, entry.Name())
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || strings.Contains(entry.Name(), ".part-") {
			continue
		}
		files = append(files, cacheEntry{path: path, size: info.Size(), modified: info.ModTime()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.Before(files[j].modified) })
	for _, file := range files {
		if total <= t.maxBytes {
			break
		}
		if file.path == excluded {
			continue
		}
		if time.Since(file.modified) < activeArtifactWindow {
			continue
		}
		if os.Remove(file.path) == nil {
			total -= file.size
		}
	}
}

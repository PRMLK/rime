package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Address              string
	MusicDir             string
	DataDir              string
	CacheDir             string
	LyricsDir            string
	LRCLIBURL            string
	DatabasePath         string
	ScanOnStartup        bool
	FFmpegPath           string
	TranscodeCacheBytes  int64
	TranscodeConcurrency int
}

func Load() (Config, error) {
	musicDir, err := absolutePath(env("RIME_MUSIC_DIR", "./music"))
	if err != nil {
		return Config{}, fmt.Errorf("resolve music directory: %w", err)
	}
	dataDir, err := absolutePath(env("RIME_DATA_DIR", "./data"))
	if err != nil {
		return Config{}, fmt.Errorf("resolve data directory: %w", err)
	}
	scanOnStartup, err := strconv.ParseBool(env("RIME_SCAN_ON_STARTUP", "true"))
	if err != nil {
		return Config{}, fmt.Errorf("parse RIME_SCAN_ON_STARTUP: %w", err)
	}

	return Config{
		Address:              env("RIME_ADDRESS", "127.0.0.1:8080"),
		MusicDir:             musicDir,
		DataDir:              dataDir,
		CacheDir:             filepath.Join(dataDir, "cache"),
		LyricsDir:            filepath.Join(dataDir, "library", "lyrics"),
		LRCLIBURL:            env("RIME_LRCLIB_URL", "https://lrclib.net"),
		DatabasePath:         filepath.Join(dataDir, "rime.db"),
		ScanOnStartup:        scanOnStartup,
		FFmpegPath:           env("RIME_FFMPEG_PATH", "ffmpeg"),
		TranscodeCacheBytes:  envInt64("RIME_TRANSCODE_CACHE_MAX_BYTES", 10*1024*1024*1024),
		TranscodeConcurrency: envInt("RIME_TRANSCODE_CONCURRENCY", 1),
	}, nil
}

func envInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(env(key, strconv.FormatInt(fallback, 10)), 10, 64)
	if err != nil || value < 0 {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(env(key, strconv.Itoa(fallback)))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func absolutePath(path string) (string, error) {
	return filepath.Abs(filepath.Clean(path))
}

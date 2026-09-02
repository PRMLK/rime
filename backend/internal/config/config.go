package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Address       string
	MusicDir      string
	DataDir       string
	CacheDir      string
	LyricsDir     string
	DatabasePath  string
	ScanOnStartup bool
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
		Address:       env("RIME_ADDRESS", "127.0.0.1:8080"),
		MusicDir:      musicDir,
		DataDir:       dataDir,
		CacheDir:      filepath.Join(dataDir, "cache"),
		LyricsDir:     filepath.Join(dataDir, "library", "lyrics"),
		DatabasePath:  filepath.Join(dataDir, "rime.db"),
		ScanOnStartup: scanOnStartup,
	}, nil
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

package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"rime/backend/internal/artwork"
	"rime/backend/internal/config"
	"rime/backend/internal/library/scanner"
	"rime/backend/internal/playback"
	"rime/backend/internal/search"
	"rime/backend/internal/store/sqlite"
	v1 "rime/backend/internal/transport/http/native/v1"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.MusicDir, 0o750); err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.LyricsDir, 0o750); err != nil {
		return err
	}
	artworkCache, err := artwork.NewCache(filepath.Join(cfg.CacheDir, "artwork"), cfg.MusicDir)
	if err != nil {
		return err
	}
	store, err := sqlite.Open(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer store.Close()

	if cfg.ScanOnStartup {
		report, err := scanner.New(cfg.MusicDir, artworkCache, store, logger).Scan(context.Background())
		if err != nil {
			return err
		}
		logger.Info("music scan complete", "discovered", report.Discovered, "indexed", report.Indexed, "failed", report.Failed, "duration", report.Duration)
	}

	handler := v1.New(search.New(store), playback.New(store), artwork.NewService(store, artworkCache), logger)
	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	logger.Info("rime server listening", "address", cfg.Address, "music_dir", cfg.MusicDir)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

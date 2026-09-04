package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"rime/backend/internal/artwork"
	"rime/backend/internal/browse"
	"rime/backend/internal/config"
	"rime/backend/internal/library/scanner"
	"rime/backend/internal/lyrics"
	"rime/backend/internal/playback"
	"rime/backend/internal/search"
	"rime/backend/internal/store/sqlite"
	"rime/backend/internal/tasks"
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
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := prepareArtworkFocus(ctx, store, artworkCache, logger); err != nil {
		return err
	}
	libraryScanner := scanner.New(cfg.MusicDir, artworkCache, store, logger)
	lyricsScanner := lyrics.NewScanner(
		cfg.LyricsDir,
		store,
		lyrics.NewLRCLIBClient(cfg.LRCLIBURL, "Rime/0.1 (+https://github.com/PRMLK/rime)", nil),
		logger,
	)

	if cfg.ScanOnStartup {
		report, err := libraryScanner.Scan(ctx)
		if err != nil {
			return err
		}
		logger.Info("music scan complete", "discovered", report.Discovered, "indexed", report.Indexed, "failed", report.Failed, "duration", report.Duration)
	}
	taskService, err := tasks.New(ctx, store,
		tasks.Definition{
			ID:   "library.scan",
			Name: "扫描音乐库",
			Run: func(ctx context.Context) error {
				report, err := libraryScanner.Scan(ctx)
				if err == nil {
					logger.Info("scheduled music scan complete", "discovered", report.Discovered, "indexed", report.Indexed, "failed", report.Failed, "duration", report.Duration)
				}
				return err
			},
		},
		tasks.Definition{
			ID:   "lyrics.scan",
			Name: "扫描歌词",
			Run: func(ctx context.Context) error {
				report, err := lyricsScanner.Scan(ctx)
				logger.Info("scheduled lyrics scan complete", "discovered", report.Discovered, "updated", report.Updated, "missing", report.Missing, "failed", report.Failed, "duration", report.Duration)
				return err
			},
		},
	)
	if err != nil {
		return err
	}
	defer taskService.Close()

	handler := v1.New(search.New(store), browse.New(store), lyrics.NewService(store), playback.New(store), artwork.NewService(store, artworkCache), taskService, logger)
	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

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

type artworkFocusStore interface {
	ArtworkFocusAssets(context.Context) ([]artwork.Asset, error)
	UpdateArtworkFocus(context.Context, string, artwork.Focus) error
}

type artworkFocusCache interface {
	PrimeFocus(string, artwork.Focus)
	AnalyzeStoredFocus(artwork.Asset) (artwork.Focus, error)
}

func prepareArtworkFocus(ctx context.Context, store artworkFocusStore, cache artworkFocusCache, logger *slog.Logger) error {
	assets, err := store.ArtworkFocusAssets(ctx)
	if err != nil {
		return fmt.Errorf("list artwork focus state: %w", err)
	}

	missing := 0
	updated := 0
	failed := 0
	for _, asset := range assets {
		if asset.FocusVersion >= artwork.FocusAlgorithmVersion {
			cache.PrimeFocus(asset.ContentHash, artwork.Focus{X: asset.FocusX, Y: asset.FocusY})
			continue
		}
		missing++
		focus, err := cache.AnalyzeStoredFocus(asset)
		if err != nil {
			failed++
			logger.Warn("recalculate artwork focus", "artwork_id", asset.ID, "error", err)
			continue
		}
		if err := store.UpdateArtworkFocus(ctx, asset.ID, focus); err != nil {
			return fmt.Errorf("persist artwork focus %s: %w", asset.ID, err)
		}
		updated++
	}
	if missing > 0 {
		logger.Info("artwork focus backfill complete", "missing", missing, "updated", updated, "failed", failed)
	}
	return nil
}

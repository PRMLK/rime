package scanner

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"rime/backend/internal/artwork"
	"rime/backend/internal/id"
	"rime/backend/internal/library/metadata"
)

type File struct {
	Path           string
	Size           int64
	ModifiedUnixMs int64
	Metadata       metadata.Track
	Artwork        *artwork.Asset
}

type discoveredFile struct {
	File
	albumKey string
}

type Repository interface {
	UpsertScannedFile(context.Context, string, File) error
	CompleteScan(context.Context, string) error
}

type Report struct {
	Discovered int
	Indexed    int
	Failed     int
	Duration   time.Duration
}

type Scanner struct {
	root   string
	art    *artwork.Cache
	reader metadata.Reader
	repo   Repository
	logger *slog.Logger
}

func New(root string, artworkCache *artwork.Cache, repo Repository, logger *slog.Logger) *Scanner {
	return &Scanner{root: root, art: artworkCache, repo: repo, reader: metadata.Reader{}, logger: logger}
}

func (s *Scanner) Scan(ctx context.Context) (Report, error) {
	started := time.Now()
	scanID, err := id.New("scan")
	if err != nil {
		return Report{}, err
	}
	report := Report{}
	files := make([]discoveredFile, 0)
	err = filepath.WalkDir(s.root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() || !supported(path) {
			return nil
		}

		report.Discovered++
		info, err := entry.Info()
		if err != nil {
			report.Failed++
			s.logger.Warn("read music file info", "path", path, "error", err)
			return nil
		}
		track, err := s.reader.Read(path)
		if err != nil {
			report.Failed++
			s.logger.Warn("read music metadata", "path", path, "error", err)
			return nil
		}
		files = append(files, discoveredFile{File: File{
			Path:           path,
			Size:           info.Size(),
			ModifiedUnixMs: info.ModTime().UnixMilli(),
			Metadata:       track,
		}, albumKey: albumIdentity(track)})
		return nil
	})
	if err != nil {
		return report, err
	}

	artworkByAlbum := make(map[string]*artwork.Asset)
	for _, discovered := range files {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		trackArtwork, resolved := artworkByAlbum[discovered.albumKey]
		if !resolved && s.art != nil {
			var resolveErr error
			trackArtwork, resolveErr = s.art.Resolve(discovered.Path, discovered.Metadata.HasArtwork)
			if resolveErr != nil {
				s.logger.Warn("cache album artwork", "path", discovered.Path, "error", resolveErr)
			}
			if trackArtwork != nil {
				artworkByAlbum[discovered.albumKey] = trackArtwork
			}
		}
		discovered.Artwork = trackArtwork
		if err := s.repo.UpsertScannedFile(ctx, scanID, discovered.File); err != nil {
			return report, fmt.Errorf("index %s: %w", discovered.Path, err)
		}
		report.Indexed++
	}
	if err := s.repo.CompleteScan(ctx, scanID); err != nil {
		return report, fmt.Errorf("complete scan: %w", err)
	}
	report.Duration = time.Since(started)
	return report, nil
}

func albumIdentity(track metadata.Track) string {
	return strings.ToLower(strings.TrimSpace(strings.Join(track.AlbumArtists, "\x1f") + "\x1e" + track.Album))
}

func supported(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp3", ".flac", ".m4a", ".mp4", ".aac", ".ogg", ".oga", ".opus", ".wav", ".wave", ".aif", ".aiff", ".ape", ".wv", ".wma":
		return true
	default:
		return false
	}
}

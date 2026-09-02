package lyrics

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"rime/backend/internal/library/metadata"
)

const maxLyricsFileSize = 2 << 20

type Scanner struct {
	root     string
	repo     Repository
	provider Provider
	reader   metadata.Reader
	logger   *slog.Logger
}

func NewScanner(root string, repo Repository, provider Provider, logger *slog.Logger) *Scanner {
	return &Scanner{root: root, repo: repo, provider: provider, reader: metadata.Reader{}, logger: logger}
}

func (s *Scanner) Scan(ctx context.Context) (Report, error) {
	started := time.Now()
	tracks, err := s.repo.ListLyricsTracks(ctx)
	if err != nil {
		return Report{}, err
	}
	report := Report{Discovered: len(tracks)}
	for _, track := range tracks {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		updated, missing, scanErr := s.scanTrack(ctx, track)
		if scanErr != nil {
			report.Failed++
			if s.logger != nil {
				s.logger.Warn("scan track lyrics", "track_id", track.ID, "title", track.Title, "error", scanErr)
			}
			continue
		}
		if updated {
			report.Updated++
		}
		if missing {
			report.Missing++
		}
	}
	report.Duration = time.Since(started)
	if report.Failed > 0 {
		return report, fmt.Errorf("%d lyric tracks failed", report.Failed)
	}
	return report, nil
}

func (s *Scanner) scanTrack(ctx context.Context, track TrackCandidate) (bool, bool, error) {
	manualPath, manualFormat, manualFound, err := findLyricsFile(filepath.Join(s.root, track.ID), "manual")
	if err != nil {
		return false, false, err
	}
	manualOK, err := s.refreshFileSource(ctx, track.ID, SourceManual, manualPath, manualFormat, manualFound)
	if err != nil {
		return false, false, err
	}

	mediaStem := strings.TrimSuffix(filepath.Base(track.MediaPath), filepath.Ext(track.MediaPath))
	sidecarPath, sidecarFormat, sidecarFound, err := findLyricsFile(filepath.Dir(track.MediaPath), mediaStem)
	if err != nil {
		return false, false, err
	}
	sidecarOK, err := s.refreshFileSource(ctx, track.ID, SourceSidecar, sidecarPath, sidecarFormat, sidecarFound)
	if err != nil {
		return false, false, err
	}

	embeddedOK := false
	embedded, embeddedFound, err := s.reader.ReadLyrics(track.MediaPath)
	if err != nil {
		if deleteErr := s.repo.DeleteLyricsSource(ctx, track.ID, SourceEmbedded); deleteErr != nil {
			return false, false, deleteErr
		}
		return false, false, err
	}
	if embeddedFound {
		source, sourceErr := newSource(track.ID, SourceEmbedded, track.MediaPath, embedded.Format, embedded.Content)
		if sourceErr != nil {
			if deleteErr := s.repo.DeleteLyricsSource(ctx, track.ID, SourceEmbedded); deleteErr != nil {
				return false, false, deleteErr
			}
			return false, false, sourceErr
		}
		if err := s.repo.UpsertLyricsSource(ctx, source); err != nil {
			return false, false, err
		}
		embeddedOK = true
	} else if err := s.repo.DeleteLyricsSource(ctx, track.ID, SourceEmbedded); err != nil {
		return false, false, err
	}

	if manualOK || sidecarOK || embeddedOK {
		return true, false, nil
	}

	providerPath, providerFormat, providerFound, err := findLyricsFile(filepath.Join(s.root, track.ID), SourceLRCLIB)
	if err != nil {
		return false, false, err
	}
	providerOK, err := s.refreshFileSource(ctx, track.ID, SourceLRCLIB, providerPath, providerFormat, providerFound)
	if err != nil {
		return false, false, err
	}
	if providerOK {
		return true, false, nil
	}
	if s.provider == nil {
		return false, true, nil
	}

	fetched, found, err := s.provider.Find(ctx, track)
	if err != nil {
		return false, false, err
	}
	if !found {
		return false, true, nil
	}
	source, err := newSource(track.ID, SourceLRCLIB, fetched.Ref, fetched.Format, fetched.Content)
	if err != nil {
		return false, false, err
	}
	if err := writeProviderLyrics(s.root, track.ID, fetched.Format, fetched.Content); err != nil {
		return false, false, err
	}
	if err := s.repo.UpsertLyricsSource(ctx, source); err != nil {
		return false, false, err
	}
	return true, false, nil
}

func (s *Scanner) refreshFileSource(ctx context.Context, trackID, kind, path, format string, found bool) (bool, error) {
	if !found {
		return false, s.repo.DeleteLyricsSource(ctx, trackID, kind)
	}
	content, err := readLyricsFile(path)
	if err != nil {
		_ = s.repo.DeleteLyricsSource(ctx, trackID, kind)
		return false, err
	}
	source, err := newSource(trackID, kind, path, format, content)
	if err != nil {
		_ = s.repo.DeleteLyricsSource(ctx, trackID, kind)
		return false, err
	}
	if err := s.repo.UpsertLyricsSource(ctx, source); err != nil {
		return false, err
	}
	return true, nil
}

func newSource(trackID, kind, ref, format, content string) (Source, error) {
	document, err := Parse(format, content)
	if err != nil {
		return Source{}, err
	}
	if len(document.Lines) == 0 {
		return Source{}, fmt.Errorf("lyrics contain no displayable lines")
	}
	hash := sha256.Sum256([]byte(content))
	return Source{
		TrackID:     trackID,
		Kind:        kind,
		Ref:         ref,
		Format:      format,
		Content:     content,
		ContentHash: fmt.Sprintf("%x", hash),
		UpdatedAt:   time.Now().UTC(),
	}, nil
}

func findLyricsFile(directory, stem string) (string, string, bool, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", false, nil
		}
		return "", "", false, err
	}
	for _, format := range []string{"lrc", "ttml", "txt"} {
		name := stem + "." + format
		for _, entry := range entries {
			if !entry.IsDir() && strings.EqualFold(entry.Name(), name) {
				return filepath.Join(directory, entry.Name()), formatFromExtension(format), true, nil
			}
		}
	}
	return "", "", false, nil
}

func readLyricsFile(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(content) > maxLyricsFileSize {
		return "", fmt.Errorf("lyrics file exceeds %d bytes", maxLyricsFileSize)
	}
	return string(content), nil
}

func writeProviderLyrics(root, trackID, format, content string) error {
	directory := filepath.Join(root, trackID)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return err
	}
	extension := format
	if extension == "plain" {
		extension = "txt"
	}
	target := filepath.Join(directory, SourceLRCLIB+"."+extension)
	temporary, err := os.CreateTemp(directory, ".lrclib-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o640); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.WriteString(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryName, target); err != nil {
		return err
	}
	for _, other := range []string{"lrc", "ttml", "txt"} {
		otherPath := filepath.Join(directory, SourceLRCLIB+"."+other)
		if otherPath != target {
			_ = os.Remove(otherPath)
		}
	}
	return nil
}

func formatFromExtension(extension string) string {
	if strings.EqualFold(extension, "txt") {
		return "plain"
	}
	return strings.ToLower(extension)
}

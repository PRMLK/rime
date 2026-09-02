package sqlite

import (
	"context"
	"database/sql"
	"embed"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
	"golang.org/x/text/unicode/norm"

	"rime/backend/internal/artwork"
	"rime/backend/internal/catalog"
	"rime/backend/internal/id"
	"rime/backend/internal/library/scanner"
	"rime/backend/internal/lyrics"
	"rime/backend/internal/playback"
	"rime/backend/internal/search"
	"rime/backend/internal/tasks"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	query := u.Query()
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "foreign_keys(1)")
	u.RawQuery = query.Encode()

	db, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	store := &Store{db: db}
	if err := store.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return fmt.Errorf("initialize migrations: %w", err)
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		prefix, _, ok := strings.Cut(entry.Name(), "_")
		version, parseErr := strconv.Atoi(prefix)
		if !ok || parseErr != nil {
			return fmt.Errorf("invalid migration filename %q", entry.Name())
		}
		var applied int
		err := s.db.QueryRowContext(ctx, `SELECT 1 FROM schema_migrations WHERE version = ?`, version).Scan(&applied)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		schema, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %d: %w", version, err)
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(schema)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, version, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) UpsertScannedFile(ctx context.Context, scanID string, file scanner.File) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var artworkID *string
	if file.Artwork != nil {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO artworks(id, content_hash, content_type, extension, storage_key, source_kind, source_path, size, width, height, created_at)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				content_type = excluded.content_type,
				extension = excluded.extension,
				storage_key = excluded.storage_key,
				source_kind = excluded.source_kind,
				source_path = excluded.source_path,
				size = excluded.size,
				width = excluded.width,
				height = excluded.height`,
			file.Artwork.ID, file.Artwork.ContentHash, file.Artwork.ContentType, file.Artwork.Extension,
			file.Artwork.StorageKey, file.Artwork.SourceKind, file.Artwork.SourcePath, file.Artwork.Size,
			file.Artwork.Width, file.Artwork.Height, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		artworkID = &file.Artwork.ID
	}

	artistIDs := make([]string, 0, len(file.Metadata.Artists))
	for _, name := range file.Metadata.Artists {
		artistID, err := ensureArtist(ctx, tx, name)
		if err != nil {
			return err
		}
		artistIDs = append(artistIDs, artistID)
	}
	albumArtistIDs := make([]string, 0, len(file.Metadata.AlbumArtists))
	for _, name := range file.Metadata.AlbumArtists {
		artistID, err := ensureArtist(ctx, tx, name)
		if err != nil {
			return err
		}
		albumArtistIDs = append(albumArtistIDs, artistID)
	}

	albumKey := normalized(strings.Join(file.Metadata.AlbumArtists, "\x1f") + "\x1e" + file.Metadata.Album)
	albumID, err := ensureAlbum(ctx, tx, albumKey, file.Metadata.Album, artworkID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM album_artists WHERE album_id = ?`, albumID); err != nil {
		return err
	}
	for position, artistID := range albumArtistIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO album_artists(album_id, artist_id, position) VALUES(?, ?, ?)`, albumID, artistID, position); err != nil {
			return err
		}
	}

	trackKey := normalized(fmt.Sprintf("%s\x1e%d\x1e%d\x1e%s\x1e%d", albumKey, file.Metadata.DiscNumber, file.Metadata.TrackNumber, file.Metadata.Title, file.Metadata.DurationMs))
	trackID, err := ensureTrack(ctx, tx, trackKey, albumID, artworkID, file)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM track_artists WHERE track_id = ?`, trackID); err != nil {
		return err
	}
	for position, artistID := range artistIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO track_artists(track_id, artist_id, role, position) VALUES(?, ?, 'primary', ?)`, trackID, artistID, position); err != nil {
			return err
		}
	}

	mediaID, err := id.New("med")
	if err != nil {
		return err
	}
	contentVersion := fmt.Sprintf("%d-%d", file.Size, file.ModifiedUnixMs)
	indexedAt := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO media_files(id, track_id, path, container, codec, content_type, bitrate_kbps, size, modified_unix_ms, content_version, indexed_at, available, seen_scan_id)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
		ON CONFLICT(path) DO UPDATE SET
			track_id = excluded.track_id,
			container = excluded.container,
			codec = excluded.codec,
			content_type = excluded.content_type,
			bitrate_kbps = excluded.bitrate_kbps,
			size = excluded.size,
			modified_unix_ms = excluded.modified_unix_ms,
			indexed_at = CASE WHEN media_files.content_version <> excluded.content_version THEN excluded.indexed_at ELSE media_files.indexed_at END,
			content_version = excluded.content_version,
			available = 1,
			seen_scan_id = excluded.seen_scan_id`,
		mediaID, trackID, file.Path, file.Metadata.Container, file.Metadata.Codec, file.Metadata.ContentType, file.Metadata.BitrateKbps,
		file.Size, file.ModifiedUnixMs, contentVersion, indexedAt, scanID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CompleteScan(ctx context.Context, scanID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE media_files SET available = 0 WHERE seen_scan_id <> ?`, scanID)
	return err
}

func (s *Store) RecentAlbums(ctx context.Context, limit int) ([]catalog.Album, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT al.id, al.title, al.artwork_id, MAX(mf.indexed_at) AS added_at
		FROM albums al
		JOIN tracks t ON t.album_id = al.id
		JOIN media_files mf ON mf.track_id = t.id
		WHERE mf.available = 1 AND mf.indexed_at IS NOT NULL
		GROUP BY al.id, al.title, al.artwork_id
		ORDER BY added_at DESC, al.normalized_title, al.id
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]catalog.Album, 0, limit)
	for rows.Next() {
		var album catalog.Album
		var artworkID sql.NullString
		var addedAt string
		if err := rows.Scan(&album.ID, &album.Title, &artworkID, &addedAt); err != nil {
			return nil, err
		}
		parsed, err := time.Parse(time.RFC3339Nano, addedAt)
		if err != nil {
			return nil, fmt.Errorf("parse album indexed time: %w", err)
		}
		album.AddedAt = parsed
		if artworkID.Valid {
			album.ArtworkID = &artworkID.String
		}
		album.Artists, err = s.albumArtists(ctx, album.ID)
		if err != nil {
			return nil, err
		}
		result = append(result, album)
	}
	return result, rows.Err()
}

func (s *Store) albumArtists(ctx context.Context, albumID string) ([]catalog.ArtistRef, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT ar.id, ar.name
		FROM album_artists aa
		JOIN artists ar ON ar.id = aa.artist_id
		WHERE aa.album_id = ?
		ORDER BY aa.position`, albumID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	artists := make([]catalog.ArtistRef, 0)
	for rows.Next() {
		var artist catalog.ArtistRef
		if err := rows.Scan(&artist.ID, &artist.Name); err != nil {
			return nil, err
		}
		artists = append(artists, artist)
	}
	return artists, rows.Err()
}

func (s *Store) ListLyricsTracks(ctx context.Context) ([]lyrics.TrackCandidate, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.title, al.title, t.duration_ms, mf.path
		FROM tracks t
		JOIN albums al ON al.id = t.album_id
		JOIN media_files mf ON mf.id = (
			SELECT candidate.id FROM media_files candidate
			WHERE candidate.track_id = t.id AND candidate.available = 1
			ORDER BY candidate.size DESC, candidate.id
			LIMIT 1
		)
		ORDER BY al.normalized_title, t.disc_number, t.track_number, t.normalized_title`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]lyrics.TrackCandidate, 0)
	for rows.Next() {
		var track lyrics.TrackCandidate
		if err := rows.Scan(&track.ID, &track.Title, &track.Album, &track.DurationMs, &track.MediaPath); err != nil {
			return nil, err
		}
		track.Artists, err = s.trackArtistNames(ctx, track.ID)
		if err != nil {
			return nil, err
		}
		result = append(result, track)
	}
	return result, rows.Err()
}

func (s *Store) UpsertLyricsSource(ctx context.Context, source lyrics.Source) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO track_lyrics(track_id, source_kind, source_ref, format, content, content_hash, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(track_id, source_kind) DO UPDATE SET
			source_ref = excluded.source_ref,
			format = excluded.format,
			content = excluded.content,
			content_hash = excluded.content_hash,
			updated_at = CASE WHEN track_lyrics.content_hash <> excluded.content_hash THEN excluded.updated_at ELSE track_lyrics.updated_at END`,
		source.TrackID, source.Kind, source.Ref, source.Format, source.Content, source.ContentHash, source.UpdatedAt.UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Store) DeleteLyricsSource(ctx context.Context, trackID, kind string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM track_lyrics WHERE track_id = ? AND source_kind = ?`, trackID, kind)
	return err
}

func (s *Store) GetLyricsSource(ctx context.Context, trackID string) (lyrics.Source, error) {
	var source lyrics.Source
	var updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT lyric.track_id, lyric.source_kind, lyric.source_ref, lyric.format, lyric.content, lyric.content_hash, lyric.updated_at
		FROM track_lyrics lyric
		WHERE lyric.track_id = ?
		  AND EXISTS (SELECT 1 FROM media_files mf WHERE mf.track_id = lyric.track_id AND mf.available = 1)
		ORDER BY CASE lyric.source_kind
			WHEN 'manual' THEN 0
			WHEN 'sidecar' THEN 1
			WHEN 'embedded' THEN 2
			WHEN 'lrclib' THEN 3
			ELSE 100
		END
		LIMIT 1`, trackID).
		Scan(&source.TrackID, &source.Kind, &source.Ref, &source.Format, &source.Content, &source.ContentHash, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return lyrics.Source{}, lyrics.ErrNotFound
	}
	if err != nil {
		return lyrics.Source{}, err
	}
	source.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return lyrics.Source{}, fmt.Errorf("parse lyrics update time: %w", err)
	}
	return source, nil
}

func (s *Store) trackArtistNames(ctx context.Context, trackID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT ar.name
		FROM track_artists ta
		JOIN artists ar ON ar.id = ta.artist_id
		WHERE ta.track_id = ? AND ta.role = 'primary'
		ORDER BY ta.position`, trackID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		result = append(result, name)
	}
	return result, rows.Err()
}

func (s *Store) EnsureScheduledTask(ctx context.Context, taskID, name string, position int) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO scheduled_tasks(id, name, position) VALUES(?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position`,
		taskID, name, position)
	return err
}

func (s *Store) ListScheduledTasks(ctx context.Context) ([]tasks.Task, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, last_run_at, last_duration_ms, last_succeeded
		FROM scheduled_tasks ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]tasks.Task, 0)
	for rows.Next() {
		var task tasks.Task
		var lastRunAt sql.NullString
		var lastDurationMs sql.NullInt64
		var lastSucceeded sql.NullBool
		if err := rows.Scan(&task.ID, &task.Name, &lastRunAt, &lastDurationMs, &lastSucceeded); err != nil {
			return nil, err
		}
		if lastRunAt.Valid {
			parsed, err := time.Parse(time.RFC3339Nano, lastRunAt.String)
			if err != nil {
				return nil, fmt.Errorf("parse scheduled task run time: %w", err)
			}
			task.LastRunAt = &parsed
		}
		if lastDurationMs.Valid {
			task.LastDurationMs = &lastDurationMs.Int64
		}
		if lastSucceeded.Valid {
			task.LastSucceeded = &lastSucceeded.Bool
		}
		result = append(result, task)
	}
	return result, rows.Err()
}

func (s *Store) RecordScheduledTaskRun(ctx context.Context, taskID string, started time.Time, duration time.Duration, runErr error) error {
	succeeded := runErr == nil
	var errorText any
	if runErr != nil {
		errorText = runErr.Error()
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE scheduled_tasks
		SET last_run_at = ?, last_duration_ms = ?, last_succeeded = ?, last_error = ?
		WHERE id = ?`,
		started.UTC().Format(time.RFC3339Nano), duration.Milliseconds(), succeeded, errorText, taskID)
	return err
}

func ensureArtist(ctx context.Context, tx *sql.Tx, name string) (string, error) {
	key := normalized(name)
	var artistID string
	err := tx.QueryRowContext(ctx, `SELECT id FROM artists WHERE identity_key = ?`, key).Scan(&artistID)
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE artists SET name = ?, normalized_name = ? WHERE id = ?`, name, key, artistID)
		return artistID, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	artistID, err = id.New("art")
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO artists(id, identity_key, name, normalized_name) VALUES(?, ?, ?, ?)`, artistID, key, name, key)
	return artistID, err
}

func ensureAlbum(ctx context.Context, tx *sql.Tx, key, title string, artworkID *string) (string, error) {
	var albumID string
	err := tx.QueryRowContext(ctx, `SELECT id FROM albums WHERE identity_key = ?`, key).Scan(&albumID)
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE albums SET title = ?, normalized_title = ?, artwork_id = COALESCE(?, artwork_id) WHERE id = ?`, title, normalized(title), artworkID, albumID)
		return albumID, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	albumID, err = id.New("alb")
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO albums(id, identity_key, title, normalized_title, artwork_id) VALUES(?, ?, ?, ?, ?)`, albumID, key, title, normalized(title), artworkID)
	return albumID, err
}

func ensureTrack(ctx context.Context, tx *sql.Tx, key, albumID string, artworkID *string, file scanner.File) (string, error) {
	var trackID string
	err := tx.QueryRowContext(ctx, `SELECT id FROM tracks WHERE identity_key = ?`, key).Scan(&trackID)
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE tracks SET album_id = ?, title = ?, normalized_title = ?, duration_ms = ?, disc_number = ?, track_number = ?, artwork_id = ? WHERE id = ?`,
			albumID, file.Metadata.Title, normalized(file.Metadata.Title), file.Metadata.DurationMs, file.Metadata.DiscNumber, file.Metadata.TrackNumber, artworkID, trackID)
		return trackID, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	trackID, err = id.New("trk")
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO tracks(id, identity_key, album_id, title, normalized_title, duration_ms, disc_number, track_number, artwork_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		trackID, key, albumID, file.Metadata.Title, normalized(file.Metadata.Title), file.Metadata.DurationMs, file.Metadata.DiscNumber, file.Metadata.TrackNumber, artworkID)
	return trackID, err
}

func (s *Store) SearchTracks(ctx context.Context, query string, limit int, cursor string) (search.Page, error) {
	offset, err := decodeCursor(cursor)
	if err != nil {
		return search.Page{}, err
	}
	needle := normalized(query)
	contains := "%" + escapeLike(needle) + "%"
	prefix := escapeLike(needle) + "%"
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT t.id
		FROM tracks t
		JOIN albums al ON al.id = t.album_id
		LEFT JOIN track_artists ta ON ta.track_id = t.id
		LEFT JOIN artists ar ON ar.id = ta.artist_id
		WHERE EXISTS (SELECT 1 FROM media_files mf WHERE mf.track_id = t.id AND mf.available = 1)
		  AND (? = '' OR t.normalized_title LIKE ? ESCAPE '\' OR al.normalized_title LIKE ? ESCAPE '\' OR ar.normalized_name LIKE ? ESCAPE '\')
		ORDER BY
		  CASE WHEN t.normalized_title = ? THEN 0 WHEN t.normalized_title LIKE ? ESCAPE '\' THEN 1 ELSE 2 END,
		  t.normalized_title, t.id
		LIMIT ? OFFSET ?`, needle, contains, contains, contains, needle, prefix, limit+1, offset)
	if err != nil {
		return search.Page{}, err
	}
	defer rows.Close()
	ids := make([]string, 0, limit+1)
	for rows.Next() {
		var trackID string
		if err := rows.Scan(&trackID); err != nil {
			return search.Page{}, err
		}
		ids = append(ids, trackID)
	}
	if err := rows.Err(); err != nil {
		return search.Page{}, err
	}

	page := search.Page{Items: make([]catalog.Track, 0, min(limit, len(ids)))}
	if len(ids) > limit {
		ids = ids[:limit]
		page.NextCursor = encodeCursor(offset + limit)
	}
	for _, trackID := range ids {
		track, err := s.GetTrack(ctx, trackID)
		if err != nil {
			return search.Page{}, err
		}
		page.Items = append(page.Items, track)
	}
	return page, nil
}

func (s *Store) GetTrack(ctx context.Context, trackID string) (catalog.Track, error) {
	var track catalog.Track
	var artworkID sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT t.id, t.title, t.duration_ms, t.disc_number, t.track_number, al.id, al.title, COALESCE(t.artwork_id, al.artwork_id)
		FROM tracks t JOIN albums al ON al.id = t.album_id
		WHERE t.id = ? AND EXISTS (SELECT 1 FROM media_files mf WHERE mf.track_id = t.id AND mf.available = 1)`, trackID).
		Scan(&track.ID, &track.Title, &track.DurationMs, &track.DiscNumber, &track.TrackNumber, &track.Album.ID, &track.Album.Title, &artworkID)
	if artworkID.Valid {
		track.ArtworkID = &artworkID.String
	}
	if errors.Is(err, sql.ErrNoRows) {
		return catalog.Track{}, playback.ErrTrackNotFound
	}
	if err != nil {
		return catalog.Track{}, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT ar.id, ar.name, ta.role
		FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id
		WHERE ta.track_id = ? ORDER BY ta.position`, trackID)
	if err != nil {
		return catalog.Track{}, err
	}
	defer rows.Close()
	track.Artists = []catalog.ArtistRef{}
	for rows.Next() {
		var artist catalog.ArtistRef
		if err := rows.Scan(&artist.ID, &artist.Name, &artist.Role); err != nil {
			return catalog.Track{}, err
		}
		track.Artists = append(track.Artists, artist)
	}
	return track, rows.Err()
}

func (s *Store) GetArtwork(ctx context.Context, artworkID string) (artwork.Asset, error) {
	var asset artwork.Asset
	err := s.db.QueryRowContext(ctx, `
		SELECT id, content_hash, content_type, extension, storage_key, source_kind, source_path, size, width, height
		FROM artworks WHERE id = ?`, artworkID).
		Scan(&asset.ID, &asset.ContentHash, &asset.ContentType, &asset.Extension, &asset.StorageKey,
			&asset.SourceKind, &asset.SourcePath, &asset.Size, &asset.Width, &asset.Height)
	if errors.Is(err, sql.ErrNoRows) {
		return artwork.Asset{}, artwork.ErrNotFound
	}
	return asset, err
}

func (s *Store) AvailableMedia(ctx context.Context, trackID string) ([]catalog.MediaFile, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, track_id, path, container, codec, content_type, bitrate_kbps, size, modified_unix_ms, content_version FROM media_files WHERE track_id = ? AND available = 1 ORDER BY size DESC`, trackID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []catalog.MediaFile
	for rows.Next() {
		var media catalog.MediaFile
		if err := rows.Scan(&media.ID, &media.TrackID, &media.Path, &media.Container, &media.Codec, &media.ContentType, &media.BitrateKbps, &media.Size, &media.ModifiedUnixMs, &media.ContentVersion); err != nil {
			return nil, err
		}
		result = append(result, media)
	}
	return result, rows.Err()
}

func (s *Store) CreatePlaybackSession(ctx context.Context, sessionID, trackID, mediaID, playerID string, createdAt, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO playback_sessions(id, track_id, media_file_id, player_id, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?)`,
		sessionID, trackID, mediaID, playerID, createdAt.Format(time.RFC3339Nano), expiresAt.Format(time.RFC3339Nano))
	return err
}

func (s *Store) PlaybackSessionMedia(ctx context.Context, sessionID string, now time.Time) (catalog.Track, catalog.MediaFile, error) {
	var trackID string
	var media catalog.MediaFile
	err := s.db.QueryRowContext(ctx, `
		SELECT ps.track_id, mf.id, mf.track_id, mf.path, mf.container, mf.codec, mf.content_type, mf.bitrate_kbps, mf.size, mf.modified_unix_ms, mf.content_version
		FROM playback_sessions ps JOIN media_files mf ON mf.id = ps.media_file_id
		WHERE ps.id = ? AND ps.expires_at > ? AND mf.available = 1`, sessionID, now.Format(time.RFC3339Nano)).
		Scan(&trackID, &media.ID, &media.TrackID, &media.Path, &media.Container, &media.Codec, &media.ContentType, &media.BitrateKbps, &media.Size, &media.ModifiedUnixMs, &media.ContentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return catalog.Track{}, catalog.MediaFile{}, playback.ErrSessionNotFound
	}
	if err != nil {
		return catalog.Track{}, catalog.MediaFile{}, err
	}
	track, err := s.GetTrack(ctx, trackID)
	return track, media, err
}

func (s *Store) RecordPlaybackEvent(ctx context.Context, sessionID string, event playback.Event) error {
	_, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO playback_events(event_id, session_id, event_type, position_ms, occurred_at) VALUES(?, ?, ?, ?, ?)`,
		event.EventID, sessionID, event.Type, event.PositionMs, event.OccurredAt.UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Store) DeletePlaybackSession(ctx context.Context, sessionID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM playback_sessions WHERE id = ?`, sessionID)
	return err
}

func normalized(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(norm.NFKC.String(value)), " "))
}

func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

func encodeCursor(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodeCursor(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, fmt.Errorf("invalid cursor")
	}
	offset, err := strconv.Atoi(string(raw))
	if err != nil || offset < 0 {
		return 0, fmt.Errorf("invalid cursor")
	}
	return offset, nil
}

package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"rime/backend/internal/catalog"
	"rime/backend/internal/playlists"
)

func (s *Store) ListPlaylists(ctx context.Context, userID string) ([]playlists.Playlist, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.id, p.name, p.kind, COUNT(pt.track_id), p.created_at, p.updated_at
		FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
		WHERE p.owner_user_id = ?
		GROUP BY p.id
		ORDER BY p.kind = 'favorites' DESC, p.updated_at DESC, p.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []playlists.Playlist{}
	for rows.Next() {
		playlist, err := scanPlaylist(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, playlist)
	}
	return result, rows.Err()
}

func (s *Store) GetPlaylist(ctx context.Context, playlistID, userID string) (playlists.Detail, error) {
	playlist, err := scanPlaylist(s.db.QueryRowContext(ctx, `
		SELECT p.id, p.name, p.kind, COUNT(pt.track_id), p.created_at, p.updated_at
		FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
		WHERE p.id = ? AND p.owner_user_id = ? GROUP BY p.id`, playlistID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return playlists.Detail{}, playlists.ErrNotFound
	}
	if err != nil {
		return playlists.Detail{}, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, added_at`, playlistID)
	if err != nil {
		return playlists.Detail{}, err
	}
	trackIDs := []string{}
	for rows.Next() {
		var trackID string
		if err := rows.Scan(&trackID); err != nil {
			rows.Close()
			return playlists.Detail{}, err
		}
		trackIDs = append(trackIDs, trackID)
	}
	if err := rows.Close(); err != nil {
		return playlists.Detail{}, err
	}
	detail := playlists.Detail{Playlist: playlist, Tracks: make([]catalog.Track, 0, len(trackIDs))}
	for _, trackID := range trackIDs {
		track, err := s.getTrack(ctx, trackID, false)
		if err != nil {
			return playlists.Detail{}, err
		}
		detail.Tracks = append(detail.Tracks, track)
	}
	return detail, nil
}

func (s *Store) CreatePlaylist(ctx context.Context, playlistID, userID, name string, now time.Time) (playlists.Playlist, error) {
	formatted := now.Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `INSERT INTO playlists(id, owner_user_id, name, kind, created_at, updated_at) VALUES(?, ?, ?, 'custom', ?, ?)`, playlistID, userID, name, formatted, formatted)
	if err != nil {
		return playlists.Playlist{}, err
	}
	return playlists.Playlist{ID: playlistID, Name: name, Kind: playlists.KindCustom, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) RenamePlaylist(ctx context.Context, playlistID, userID, name string, now time.Time) (playlists.Playlist, error) {
	result, err := s.db.ExecContext(ctx, `UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND owner_user_id = ? AND kind = 'custom'`, name, now.Format(time.RFC3339Nano), playlistID, userID)
	if err != nil {
		return playlists.Playlist{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return playlists.Playlist{}, err
	}
	if affected == 0 {
		return playlists.Playlist{}, s.playlistMutationError(ctx, playlistID, userID)
	}
	detail, err := s.GetPlaylist(ctx, playlistID, userID)
	return detail.Playlist, err
}

func (s *Store) DeletePlaylist(ctx context.Context, playlistID, userID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM playlists WHERE id = ? AND owner_user_id = ? AND kind = 'custom'`, playlistID, userID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return s.playlistMutationError(ctx, playlistID, userID)
	}
	return nil
}

func (s *Store) AddPlaylistTrack(ctx context.Context, playlistID, userID, trackID string, now time.Time) error {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM playlists WHERE id = ? AND owner_user_id = ?`, playlistID, userID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return playlists.ErrNotFound
	} else if err != nil {
		return err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM tracks WHERE id = ?`, trackID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return playlists.ErrNotFound
	} else if err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO playlist_tracks(playlist_id, track_id, position, added_at)
		VALUES(?, ?, COALESCE((SELECT MAX(position) + 1 FROM playlist_tracks WHERE playlist_id = ?), 0), ?)`,
		playlistID, trackID, playlistID, now.Format(time.RFC3339Nano))
	if err != nil {
		if strings.Contains(err.Error(), "playlist_tracks.playlist_id, playlist_tracks.track_id") {
			return playlists.ErrDuplicate
		}
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE playlists SET updated_at = ? WHERE id = ?`, now.Format(time.RFC3339Nano), playlistID)
	return err
}

func (s *Store) RemovePlaylistTrack(ctx context.Context, playlistID, userID, trackID string, now time.Time) error {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM playlists WHERE id = ? AND owner_user_id = ?`, playlistID, userID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return playlists.ErrNotFound
	} else if err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`, playlistID, trackID)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE playlists SET updated_at = ? WHERE id = ?`, now.Format(time.RFC3339Nano), playlistID)
	return err
}

func (s *Store) FavoritePlaylistID(ctx context.Context, userID string) (string, error) {
	var playlistID string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM playlists WHERE owner_user_id = ? AND kind = 'favorites'`, userID).Scan(&playlistID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", playlists.ErrNotFound
	}
	return playlistID, err
}

func (s *Store) IsFavorite(ctx context.Context, userID, trackID string) (bool, error) {
	var exists int
	err := s.db.QueryRowContext(ctx, `
		SELECT 1 FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
		WHERE p.owner_user_id = ? AND p.kind = 'favorites' AND pt.track_id = ?`, userID, trackID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) playlistMutationError(ctx context.Context, playlistID, userID string) error {
	var kind string
	err := s.db.QueryRowContext(ctx, `SELECT kind FROM playlists WHERE id = ? AND owner_user_id = ?`, playlistID, userID).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return playlists.ErrNotFound
	}
	if err != nil {
		return err
	}
	return playlists.ErrProtected
}

func scanPlaylist(row rowScanner) (playlists.Playlist, error) {
	var playlist playlists.Playlist
	var createdAt, updatedAt string
	err := row.Scan(&playlist.ID, &playlist.Name, &playlist.Kind, &playlist.TrackCount, &createdAt, &updatedAt)
	if err != nil {
		return playlists.Playlist{}, err
	}
	playlist.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return playlists.Playlist{}, err
	}
	playlist.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	return playlist, err
}

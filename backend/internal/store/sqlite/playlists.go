package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"rime/backend/internal/catalog"
	"rime/backend/internal/playlists"
)

// ListPlaylists 按最近更新时间返回当前用户的一批歌单。
// cursor 是由同一接口返回的内部偏移游标；额外查询一条记录来判断是否还有下一批。
func (s *Store) ListPlaylists(ctx context.Context, userID string, limit int, cursor string) (playlists.Page, error) {
	offset, err := decodeCursor(cursor)
	if err != nil {
		return playlists.Page{}, playlists.ErrInvalidCursor
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.id, p.name, p.kind, COUNT(pt.track_id), p.created_at, p.updated_at
		FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
		WHERE p.owner_user_id = ?
		GROUP BY p.id
		ORDER BY p.kind = 'favorites' DESC, p.updated_at DESC, p.name
		LIMIT ? OFFSET ?`, userID, limit+1, offset)
	if err != nil {
		return playlists.Page{}, err
	}
	defer rows.Close()
	result := make([]playlists.Playlist, 0, limit+1)
	for rows.Next() {
		playlist, err := scanPlaylist(rows)
		if err != nil {
			return playlists.Page{}, err
		}
		result = append(result, playlist)
	}
	if err := rows.Err(); err != nil {
		return playlists.Page{}, err
	}
	page := playlists.Page{Items: result}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = encodeCursor(offset + limit)
	}
	return page, nil
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

// FavoriteAlbums 返回当前用户直接喜欢且仍可播放的专辑。
//
// 参数 ctx 用于取消查询，userID 限制偏好归属，limit 已由服务层校验为 1 至 50。查询只
// 返回仍至少包含一个可用媒体文件的专辑，避免首页展示无法进入详情或播放的卡片；专辑
// 资料与常规专辑列表保持同一响应形状，方便前端复用 AlbumCard（专辑卡片）。
func (s *Store) FavoriteAlbums(ctx context.Context, userID string, limit int) ([]catalog.Album, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT al.id, al.title, al.artwork_id, MAX(mf.indexed_at) AS library_added_at
		FROM favorite_albums fa
		JOIN albums al ON al.id = fa.album_id
		JOIN tracks t ON t.album_id = al.id
		JOIN media_files mf ON mf.track_id = t.id
		WHERE fa.user_id = ? AND mf.available = 1 AND mf.indexed_at IS NOT NULL
		GROUP BY fa.user_id, fa.album_id, fa.created_at, al.id, al.title, al.artwork_id
		ORDER BY fa.created_at DESC, al.id DESC
		LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]catalog.Album, 0, limit)
	for rows.Next() {
		var album catalog.Album
		var artworkID sql.NullString
		var addedAt string
		if err := rows.Scan(&album.ID, &album.Title, &artworkID, &addedAt); err != nil {
			return nil, err
		}
		parsedAddedAt, err := time.Parse(time.RFC3339Nano, addedAt)
		if err != nil {
			return nil, fmt.Errorf("parse favorite album indexed time: %w", err)
		}
		album.AddedAt = parsedAddedAt
		if artworkID.Valid {
			album.ArtworkID = &artworkID.String
		}
		album.Artists, err = s.albumArtists(ctx, album.ID)
		if err != nil {
			return nil, err
		}
		items = append(items, album)
	}
	return items, rows.Err()
}

// SetFavoriteAlbum 新增或移除当前用户与专辑之间的直接喜欢关系。
//
// 参数 ctx 用于取消数据库写入，userID 与 albumID 确定关联记录，favorite 控制新增或移除，
// now 作为新增时的稳定排序时间。添加前验证专辑存在，避免无效 ID 产生孤立偏好；移除则
// 保持幂等，即未收藏时同样可安全返回成功。
func (s *Store) SetFavoriteAlbum(ctx context.Context, userID, albumID string, favorite bool, now time.Time) error {
	if favorite {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM albums WHERE id = ?`, albumID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
			return playlists.ErrAlbumNotFound
		} else if err != nil {
			return err
		}
		_, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO favorite_albums(user_id, album_id, created_at) VALUES(?, ?, ?)`, userID, albumID, now.Format(time.RFC3339Nano))
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM favorite_albums WHERE user_id = ? AND album_id = ?`, userID, albumID)
	return err
}

// IsFavoriteAlbum 检查当前用户是否直接喜欢目标专辑。
//
// 参数 ctx 用于取消查询，userID 限制偏好归属，albumID 为目标专辑。未找到关联记录时返回
// false 与 nil，使首次进入专辑详情的未收藏状态不被视为错误。
func (s *Store) IsFavoriteAlbum(ctx context.Context, userID, albumID string) (bool, error) {
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM favorite_albums WHERE user_id = ? AND album_id = ?`, userID, albumID).Scan(&exists)
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

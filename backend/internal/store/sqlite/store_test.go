package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"rime/backend/internal/playback"
)

// TestOpenRepairsPlaybackSourceColumnsWhenMigrationWasRecorded 验证历史数据库的
// schema_migrations（迁移记录表）即使错误登记了第 10 版，Open（打开存储）仍会补齐
// playback_sessions（播放会话表）的播放源字段。这避免旧数据库在创建会话时因
// source_kind 等列不存在而返回 SQLite 错误。
func TestOpenRepairsPlaybackSourceColumnsWhenMigrationWasRecorded(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "legacy-rime.db")
	legacy, err := sql.Open("sqlite3", "file:"+databasePath)
	if err != nil {
		t.Fatal(err)
	}

	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		_ = legacy.Close()
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") || entry.Name() == "010_playback_sources.sql" {
			continue
		}
		schema, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
		if _, err := legacy.ExecContext(ctx, string(schema)); err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		prefix, _, _ := strings.Cut(entry.Name(), "_")
		version, err := strconv.Atoi(prefix)
		if err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
		if _, err := legacy.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, version, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	for _, column := range []string{
		"source_kind", "source_path", "source_container", "source_codec", "source_content_type",
		"source_bitrate_kbps", "source_size", "source_modified_unix_ms", "source_content_version",
		"content_key", "profile_id",
	} {
		var columnCount int
		if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info('playback_sessions') WHERE name = ?`, column).Scan(&columnCount); err != nil {
			t.Fatal(err)
		}
		if columnCount != 1 {
			t.Fatalf("%s column count = %d, want 1", column, columnCount)
		}
	}
}

// TestRecordPlaybackEventUsesServerTimeForHistory 验证继续聆听不会信任客户端未来时间。
//
// 客户端发生时间仍必须原样落入 playback_events（播放事件表），以便保留诊断信息；但
// playback_history（播放历史表）的排序时间必须来自服务端接收时刻。否则时钟错误的设备
// 会让单首歌在首页长期置顶，并影响历史记录的 300 条裁剪结果。
func TestRecordPlaybackEventUsesServerTimeForHistory(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "rime.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	serverNow := time.Date(2026, time.September, 6, 12, 0, 0, 123_000_000, time.UTC)
	clientFuture := serverNow.AddDate(10, 0, 0)
	seedPlaybackHistoryTestData(t, ctx, store, serverNow)

	err = store.RecordPlaybackEvent(ctx, "user-test", "session-test", playback.Event{
		EventID:    "event-future-time",
		Type:       "started",
		PositionMs: 0,
		OccurredAt: clientFuture,
	}, serverNow)
	if err != nil {
		t.Fatal(err)
	}

	var historyPlayedAt int64
	if err := store.db.QueryRowContext(ctx, `SELECT played_at FROM playback_history WHERE user_id = ? AND track_id = ?`, "user-test", "track-test").Scan(&historyPlayedAt); err != nil {
		t.Fatal(err)
	}
	if historyPlayedAt != serverNow.UnixMilli() {
		t.Fatalf("history played_at = %d, want server time %d", historyPlayedAt, serverNow.UnixMilli())
	}

	var storedOccurredAt string
	if err := store.db.QueryRowContext(ctx, `SELECT occurred_at FROM playback_events WHERE event_id = ?`, "event-future-time").Scan(&storedOccurredAt); err != nil {
		t.Fatal(err)
	}
	if storedOccurredAt != clientFuture.Format(time.RFC3339Nano) {
		t.Fatalf("event occurred_at = %q, want client audit time %q", storedOccurredAt, clientFuture.Format(time.RFC3339Nano))
	}
}

// seedPlaybackHistoryTestData 写入 RecordPlaybackEvent（记录播放事件）所需的最小关系数据。
//
// 参数 t 用于报告夹具初始化失败，ctx 用于数据库调用，store 为待写入的 SQLite 存储，now
// 同时作为会话创建和用户资料的固定时间。夹具显式保留外键关系，确保测试覆盖生产环境中
// playback_sessions（播放会话）到用户、曲目和媒体文件的完整校验路径。
func seedPlaybackHistoryTestData(t *testing.T, ctx context.Context, store *Store, now time.Time) {
	t.Helper()
	timestamp := now.Format(time.RFC3339Nano)
	statements := []struct {
		query string
		args  []any
	}{
		{
			query: `INSERT INTO users(id, username, username_key, display_name, password_hash, role, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			args:  []any{"user-test", "test-user", "test-user", "Test User", "unused", "user", timestamp, timestamp},
		},
		{
			query: `INSERT INTO albums(id, identity_key, title, normalized_title) VALUES(?, ?, ?, ?)`,
			args:  []any{"album-test", "album-identity-test", "Test Album", "test album"},
		},
		{
			query: `INSERT INTO tracks(id, identity_key, album_id, title, normalized_title, duration_ms) VALUES(?, ?, ?, ?, ?, ?)`,
			args:  []any{"track-test", "track-identity-test", "album-test", "Test Track", "test track", 1_000},
		},
		{
			query: `INSERT INTO media_files(id, track_id, path, container, codec, content_type, size, modified_unix_ms, content_version, seen_scan_id, indexed_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args:  []any{"media-test", "track-test", "/test-track.wav", "wav", "pcm", "audio/wav", 1, now.UnixMilli(), "v1", "scan-test", timestamp},
		},
		{
			query: `INSERT INTO playback_sessions(id, user_id, track_id, media_file_id, player_id, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?)`,
			args:  []any{"session-test", "user-test", "track-test", "media-test", "test-player", timestamp, now.Add(time.Hour).Format(time.RFC3339Nano)},
		},
	}

	for _, statement := range statements {
		if _, err := store.db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
}

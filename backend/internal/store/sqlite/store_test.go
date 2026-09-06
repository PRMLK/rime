package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"rime/backend/internal/playback"
)

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

-- 早期播放历史按会话保存，可能让同一首歌在“继续聆听”中重复出现。
-- 每组只保留最新一条；相同时间戳时 id 较大的记录视为更新。
DELETE FROM playback_history
WHERE id IN (
    SELECT older.id
    FROM playback_history AS older
    JOIN playback_history AS newer
      ON newer.user_id = older.user_id
     AND newer.track_id = older.track_id
     AND (
        newer.played_at > older.played_at
        OR (newer.played_at = older.played_at AND newer.id > older.id)
     )
);

-- 同一用户的一首歌始终只有一条历史，新的播放会更新它的时间与来源会话。
CREATE UNIQUE INDEX idx_playback_history_user_track
    ON playback_history(user_id, track_id);

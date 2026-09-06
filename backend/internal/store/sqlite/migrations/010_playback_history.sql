-- 播放会话会在播放器释放时删除，不能作为“继续聆听”的持久化来源。
-- 历史记录独立关联用户和曲目，不保存播放进度，也不引用临时会话。
CREATE TABLE playback_history (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL UNIQUE,
    played_at INTEGER NOT NULL
);

-- 同一用户的首页读取始终按最近播放时间取得少量歌曲。
CREATE INDEX idx_playback_history_user_played_at
    ON playback_history(user_id, played_at DESC, id DESC);

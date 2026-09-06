-- 播放会话会在播放器释放时删除，不能作为“继续聆听”的持久化来源。
-- 历史记录独立关联用户和曲目，不保存播放进度，也不引用临时会话。
-- 此表必须在 012 的去重迁移之前创建；010 已保留给已发布的播放来源字段迁移。
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

-- 专辑喜欢与歌曲喜欢是独立偏好：歌曲继续由“我喜欢的音乐”歌单维护，专辑直接关联用户。
-- 删除用户或媒体库中的专辑时，关联记录会自动回收。
CREATE TABLE favorite_albums (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, album_id)
);

-- 首页按最近喜欢时间读取少量专辑；album_id 让相同时间下的顺序保持稳定。
CREATE INDEX idx_favorite_albums_user_created
    ON favorite_albums(user_id, created_at DESC, album_id DESC);

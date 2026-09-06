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

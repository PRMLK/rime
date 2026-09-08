-- 013 版曾将调试模式作为全局设置保存。本版将已有值作为各账号的初始偏好，之后每个账号独立维护。
CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    debug_enabled INTEGER NOT NULL DEFAULT 0 CHECK (debug_enabled IN (0, 1)),
    updated_at TEXT NOT NULL
);

INSERT INTO user_settings(user_id, debug_enabled, updated_at)
SELECT users.id, system_settings.debug_enabled, system_settings.updated_at
FROM users
CROSS JOIN system_settings
WHERE system_settings.id = 1;

DROP TABLE system_settings;

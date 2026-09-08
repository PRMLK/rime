-- 全局系统设置只保留一行；管理员调整后，所有已认证客户端均可读取生效状态。
CREATE TABLE system_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    debug_enabled INTEGER NOT NULL DEFAULT 0 CHECK (debug_enabled IN (0, 1)),
    updated_at TEXT NOT NULL
);

INSERT INTO system_settings(id, debug_enabled, updated_at)
VALUES(1, 0, CURRENT_TIMESTAMP);

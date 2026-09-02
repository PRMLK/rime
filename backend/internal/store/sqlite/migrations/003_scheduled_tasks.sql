CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    last_duration_ms INTEGER,
    last_succeeded INTEGER,
    last_error TEXT
);

CREATE INDEX idx_scheduled_tasks_position ON scheduled_tasks(position, id);

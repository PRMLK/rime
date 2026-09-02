ALTER TABLE media_files ADD COLUMN indexed_at TEXT;

UPDATE media_files
SET indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE indexed_at IS NULL;

CREATE INDEX idx_media_files_available_indexed_at
    ON media_files(available, indexed_at);

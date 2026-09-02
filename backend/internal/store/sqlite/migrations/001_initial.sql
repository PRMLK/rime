PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    identity_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    identity_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS album_artists (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (album_id, artist_id)
);

CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    identity_key TEXT NOT NULL UNIQUE,
    album_id TEXT NOT NULL REFERENCES albums(id),
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    disc_number INTEGER NOT NULL DEFAULT 0,
    track_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS track_artists (
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'primary',
    position INTEGER NOT NULL,
    PRIMARY KEY (track_id, artist_id, role)
);

CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    path TEXT NOT NULL UNIQUE,
    container TEXT NOT NULL,
    codec TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_unix_ms INTEGER NOT NULL,
    content_version TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1,
    seen_scan_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS media_files_track_available_idx
    ON media_files(track_id, available);

CREATE INDEX IF NOT EXISTS tracks_normalized_title_idx
    ON tracks(normalized_title);

CREATE TABLE IF NOT EXISTS playback_sessions (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    media_file_id TEXT NOT NULL REFERENCES media_files(id),
    player_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES playback_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    position_ms INTEGER NOT NULL,
    occurred_at TEXT NOT NULL
);

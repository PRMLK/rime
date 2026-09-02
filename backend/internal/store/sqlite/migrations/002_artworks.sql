CREATE TABLE artworks (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    extension TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

ALTER TABLE albums ADD COLUMN artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL;
ALTER TABLE tracks ADD COLUMN artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL;

CREATE INDEX idx_albums_artwork_id ON albums(artwork_id);
CREATE INDEX idx_tracks_artwork_id ON tracks(artwork_id);

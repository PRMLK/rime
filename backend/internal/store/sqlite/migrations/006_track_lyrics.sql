CREATE TABLE track_lyrics (
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    format TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (track_id, source_kind)
);

CREATE INDEX idx_track_lyrics_track_source
    ON track_lyrics(track_id, source_kind);

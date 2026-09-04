ALTER TABLE artworks ADD COLUMN focus_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX artworks_focus_version_idx ON artworks(focus_version);

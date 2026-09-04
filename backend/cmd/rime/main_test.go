package main

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"rime/backend/internal/artwork"
)

type focusStoreStub struct {
	assets  []artwork.Asset
	updates map[string]artwork.Focus
}

func (s *focusStoreStub) ArtworkFocusAssets(context.Context) ([]artwork.Asset, error) {
	return s.assets, nil
}

func (s *focusStoreStub) UpdateArtworkFocus(_ context.Context, artworkID string, focus artwork.Focus) error {
	s.updates[artworkID] = focus
	return nil
}

type focusCacheStub struct {
	primed   map[string]artwork.Focus
	analyzed []string
	result   artwork.Focus
}

func (c *focusCacheStub) PrimeFocus(contentHash string, focus artwork.Focus) {
	c.primed[contentHash] = focus
}

func (c *focusCacheStub) AnalyzeStoredFocus(asset artwork.Asset) (artwork.Focus, error) {
	c.analyzed = append(c.analyzed, asset.ID)
	return c.result, nil
}

func TestPrepareArtworkFocusOnlyAnalyzesMissingVersions(t *testing.T) {
	existingFocus := artwork.Focus{X: 0.2, Y: 0.3}
	calculatedFocus := artwork.Focus{X: 0.7, Y: 0.4}
	store := &focusStoreStub{
		assets: []artwork.Asset{
			{ID: "existing", ContentHash: "existing-hash", FocusX: existingFocus.X, FocusY: existingFocus.Y, FocusVersion: artwork.FocusAlgorithmVersion},
			{ID: "missing", ContentHash: "missing-hash", FocusX: 0.5, FocusY: 0.5, FocusVersion: 0},
		},
		updates: make(map[string]artwork.Focus),
	}
	cache := &focusCacheStub{
		primed: make(map[string]artwork.Focus),
		result: calculatedFocus,
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	if err := prepareArtworkFocus(context.Background(), store, cache, logger); err != nil {
		t.Fatal(err)
	}
	if got := cache.primed["existing-hash"]; got != existingFocus {
		t.Fatalf("primed focus = %#v, want %#v", got, existingFocus)
	}
	if len(cache.analyzed) != 1 || cache.analyzed[0] != "missing" {
		t.Fatalf("analyzed artwork = %#v, want [missing]", cache.analyzed)
	}
	if got := store.updates["missing"]; got != calculatedFocus {
		t.Fatalf("updated focus = %#v, want %#v", got, calculatedFocus)
	}
	if _, ok := store.updates["existing"]; ok {
		t.Fatal("existing focus was unexpectedly updated")
	}
}

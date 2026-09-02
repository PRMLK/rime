package lyrics

import "testing"

func TestParseLRCWithOffset(t *testing.T) {
	document, err := Parse("lrc", "[offset:100]\n[00:01.25]First\n[00:03.000][00:04.00]Second\n")
	if err != nil {
		t.Fatal(err)
	}
	if !document.Synced || len(document.Lines) != 3 {
		t.Fatalf("unexpected document: %+v", document)
	}
	if got := *document.Lines[0].StartMs; got != 1350 {
		t.Fatalf("first start = %d, want 1350", got)
	}
	if document.Lines[0].EndMs == nil || *document.Lines[0].EndMs != 3100 {
		t.Fatalf("first end = %v, want 3100", document.Lines[0].EndMs)
	}
}

func TestParseTTML(t *testing.T) {
	document, err := Parse("ttml", `<tt><body><div><p begin="00:00:01.500" end="3s"><span>Hello</span> world</p></div></body></tt>`)
	if err != nil {
		t.Fatal(err)
	}
	if !document.Synced || len(document.Lines) != 1 || document.Lines[0].Text != "Hello world" {
		t.Fatalf("unexpected document: %+v", document)
	}
	if *document.Lines[0].StartMs != 1500 || *document.Lines[0].EndMs != 3000 {
		t.Fatalf("unexpected timing: %+v", document.Lines[0])
	}
}

func TestBestLRCLIBResultMatchesTitleVariants(t *testing.T) {
	track := TrackCandidate{
		Title:      "躺在你的衣櫃 - Guitar",
		Album:      "吉他手",
		Artists:    []string{"陳綺貞"},
		DurationMs: 306_000,
	}
	result, ok := bestLRCLIBResult(track, []lrclibResult{
		{ID: 1, TrackName: "躺在你的衣櫃 (Guitar)", ArtistName: "陳綺貞", AlbumName: "吉他手", Duration: 306, SyncedLyrics: "[00:00.00]Line"},
	})
	if !ok || result.ID != 1 {
		t.Fatalf("unexpected result: %+v, matched=%v", result, ok)
	}
}

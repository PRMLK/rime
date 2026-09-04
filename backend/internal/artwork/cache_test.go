package artwork

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

type countingAnalyzer struct {
	calls int
}

func (a *countingAnalyzer) FindBestCrop(image.Image, int, int) (image.Rectangle, error) {
	a.calls++
	return image.Rect(20, 10, 80, 60), nil
}

func TestFocusCachesAnalysisByContentHash(t *testing.T) {
	canvas := image.NewRGBA(image.Rect(0, 0, 100, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 100; x++ {
			canvas.Set(x, y, color.White)
		}
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, canvas, nil); err != nil {
		t.Fatal(err)
	}

	analyzer := &countingAnalyzer{}
	cache := &Cache{focuses: make(map[string]Focus), analyzer: analyzer}
	first := cache.focus(encoded.Bytes(), "shared-artwork")
	second := cache.focus(encoded.Bytes(), "shared-artwork")

	if analyzer.calls != 1 {
		t.Fatalf("analysis calls = %d, want 1", analyzer.calls)
	}
	if first != (Focus{X: 0.5, Y: 0.35}) || second != first {
		t.Fatalf("cached focus = %#v and %#v, want {0.5 0.35}", first, second)
	}
}

func TestPrimeFocusSkipsAnalysis(t *testing.T) {
	analyzer := &countingAnalyzer{}
	cache := &Cache{focuses: make(map[string]Focus), analyzer: analyzer}
	want := Focus{X: 0.25, Y: 0.75}
	cache.PrimeFocus("existing-artwork", want)

	if got := cache.focus(nil, "existing-artwork"); got != want {
		t.Fatalf("primed focus = %#v, want %#v", got, want)
	}
	if analyzer.calls != 0 {
		t.Fatalf("analysis calls = %d, want 0", analyzer.calls)
	}
}

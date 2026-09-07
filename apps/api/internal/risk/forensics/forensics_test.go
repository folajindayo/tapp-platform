package forensics

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"strings"
	"testing"
	"time"

	"github.com/usezoracle/tapp/api/internal/risk"
)

// A real JPEG, encoded by the standard library at a given quality. Using
// genuine encoder output rather than a hand-built fixture means the parser is
// tested against what it will actually meet.
func encodeJPEG(t *testing.T, w, h, quality int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		t.Fatalf("encode: %v", err)
	}
	return buf.Bytes()
}

func TestQualityIsRecoveredFromTheTables(t *testing.T) {
	// The estimate inverts the encoder's scaling exactly, once the table is
	// un-zigzagged. Getting this wrong is silent: comparing zigzag-ordered
	// entries against a raster-ordered reference still produces a plausible
	// number, just one that is about seven points out.
	for _, want := range []int{10, 25, 50, 60, 75, 85, 90, 95, 100} {
		c, err := ReadCompression(encodeJPEG(t, 320, 240, want))
		if err != nil {
			t.Fatalf("ReadCompression(q=%d): %v", want, err)
		}
		if c.Quality != want {
			t.Errorf("quality %d estimated as %d", want, c.Quality)
		}
	}
}

func TestFrameDimensionsAreRead(t *testing.T) {
	c, err := ReadCompression(encodeJPEG(t, 800, 600, 90))
	if err != nil {
		t.Fatalf("ReadCompression: %v", err)
	}
	if c.Width != 800 || c.Height != 600 {
		t.Errorf("read %dx%d, want 800x600", c.Width, c.Height)
	}
}

// A mid-quality encode is the shape of a re-save; a high one is not.
func TestRecompressionIsDistinguishedFromCameraOutput(t *testing.T) {
	low, err := ReadCompression(encodeJPEG(t, 1600, 1200, 60))
	if err != nil {
		t.Fatal(err)
	}
	if !low.LooksRecompressed() {
		t.Errorf("quality %d was not flagged as re-saved", low.Quality)
	}

	high, err := ReadCompression(encodeJPEG(t, 1600, 1200, 95))
	if err != nil {
		t.Fatal(err)
	}
	if high.LooksRecompressed() {
		t.Errorf("quality %d was flagged as re-saved; camera output must not be", high.Quality)
	}
}

func TestNonJPEGInputIsRefusedNotMisread(t *testing.T) {
	for name, data := range map[string][]byte{
		"empty":     {},
		"truncated": {0xFF, 0xD8},
		"png":       []byte("\x89PNG\r\n\x1a\n"),
		"text":      []byte("this is not an image at all"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ReadCompression(data); err == nil {
				t.Errorf("%s was parsed as a JPEG", name)
			}
		})
	}
}

// Go's encoder writes no EXIF, so its output is exactly the "no camera
// information" case -- which is a real and common one.
func TestAnImageWithNoMetadataIsNoticedButNotCondemned(t *testing.T) {
	c := &Check{}
	signals, err := c.Inspect(context.Background(), risk.Subject{
		Kind: "pledge", Image: encodeJPEG(t, 1600, 1200, 95),
	})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}

	var found bool
	for _, s := range signals {
		if strings.HasPrefix(s.Name, "forensics.no_") {
			found = true
			if s.Severity > risk.Low {
				t.Errorf("%s carries severity %d; absent metadata is weak evidence",
					s.Name, s.Severity)
			}
		}
	}
	if !found {
		t.Error("an image with no metadata produced no signal")
	}
}

// The whole point of the severity design: a photograph that is merely poor
// must not add up to a denial on its own.
func TestAPoorPhotographDoesNotDenyOnItsOwn(t *testing.T) {
	engine := &risk.Engine{
		Checks:     []risk.Check{&Check{}},
		Thresholds: risk.DefaultThresholds(),
	}
	// Small, mid-quality, no metadata: every weak signal this check has.
	a, err := engine.Assess(context.Background(), risk.Subject{
		Kind: "pledge", Image: encodeJPEG(t, 400, 300, 55),
	})
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.Decision == risk.Deny {
		t.Fatalf("a merely poor photograph was denied outright (score %d, signals %+v)",
			a.Score, a.Signals)
	}
}

func TestNoImageIsNotAFailure(t *testing.T) {
	c := &Check{}
	signals, err := c.Inspect(context.Background(), risk.Subject{Kind: "tap"})
	if err != nil {
		t.Fatalf("a subject with no image errored: %v", err)
	}
	if len(signals) != 0 {
		t.Errorf("a subject with no image produced %d signals", len(signals))
	}
}

// EXIF parsing against a file that genuinely carries it. The segment is built
// here because the standard library will not write one.
func TestEXIFIsParsedWhenPresent(t *testing.T) {
	img := withEXIF(t, encodeJPEG(t, 640, 480, 90), "Photoshop 25.0", "2020:01:02 03:04:05")

	meta, err := ReadMetadata(img)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}
	if !meta.HasEXIF {
		t.Fatal("EXIF segment was not detected")
	}
	if meta.Software != "Photoshop 25.0" {
		t.Errorf("Software = %q, want %q", meta.Software, "Photoshop 25.0")
	}
	if meta.EditedBy() == "" {
		t.Error("Photoshop was not recognised as an editor")
	}
	if meta.Taken.IsZero() {
		t.Fatal("capture time was not parsed")
	}

	// And the check turns that into the right signals.
	c := &Check{Now: func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) }}
	signals, err := c.Inspect(context.Background(), risk.Subject{Kind: "pledge", Image: img})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	names := map[string]bool{}
	for _, s := range signals {
		names[s.Name] = true
	}
	if !names["forensics.edited"] {
		t.Error("an image saved by Photoshop produced no edited signal")
	}
	if !names["forensics.old_photo"] {
		t.Error("a photo dated six years ago produced no staleness signal")
	}
}

// withEXIF splices a minimal APP1 segment carrying Software and DateTime into
// a JPEG, so the parser is exercised against a real segment layout.
func withEXIF(t *testing.T, jpg []byte, software, taken string) []byte {
	t.Helper()

	// TIFF header, little-endian, IFD at offset 8.
	tiff := []byte{'I', 'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00}

	entries := []struct {
		tag   uint16
		value string
	}{
		{tagSoftware, software + "\x00"},
		{tagDateTimeOriginal, taken + "\x00"},
	}

	// 2-byte count, 12 bytes per entry, 4-byte next-IFD pointer.
	dataStart := 8 + 2 + len(entries)*12 + 4
	var ifd, data []byte
	ifd = append(ifd, byte(len(entries)), 0x00)

	for _, e := range entries {
		n := uint32(len(e.value))
		ifd = append(ifd, byte(e.tag), byte(e.tag>>8)) // tag
		ifd = append(ifd, 0x02, 0x00)                  // ASCII
		ifd = append(ifd, byte(n), byte(n>>8), byte(n>>16), byte(n>>24))
		off := uint32(dataStart + len(data))
		ifd = append(ifd, byte(off), byte(off>>8), byte(off>>16), byte(off>>24))
		data = append(data, e.value...)
	}
	ifd = append(ifd, 0, 0, 0, 0) // no next IFD

	payload := append([]byte("Exif\x00\x00"), append(tiff, append(ifd, data...)...)...)
	size := len(payload) + 2
	segment := append([]byte{0xFF, 0xE1, byte(size >> 8), byte(size)}, payload...)

	// Insert directly after SOI.
	out := append([]byte{}, jpg[:2]...)
	out = append(out, segment...)
	return append(out, jpg[2:]...)
}

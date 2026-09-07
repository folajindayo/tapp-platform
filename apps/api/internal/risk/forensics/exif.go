// Package forensics inspects an image file itself, rather than what it depicts.
//
// A recognition model answers "what is in this picture". These checks answer a
// different question: "was this picture taken by a camera, just now, and not
// altered since". They are cheap, deterministic and need no network call, and
// they catch things a model looking at the depicted scene cannot -- an image
// re-saved by an editor, one downloaded and re-uploaded, one whose metadata
// says it was taken last year.
//
// Every check here produces evidence, never a verdict. Editing software in the
// metadata is not proof of fraud; a great many photographs pass through an
// editor innocently. The engine weighs these against everything else.
package forensics

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// Metadata is what could be read out of the file's headers.
type Metadata struct {
	HasEXIF bool
	Make    string
	Model   string
	// Software is the producing application. A camera writes its firmware
	// here; an editor writes itself.
	Software string
	// Taken is the capture time as the file claims it.
	Taken time.Time
}

// tags we care about, from the TIFF/EXIF specification.
const (
	tagMake             = 0x010F
	tagModel            = 0x0110
	tagSoftware         = 0x0131
	tagDateTime         = 0x0132
	tagDateTimeOriginal = 0x9003
	tagExifIFD          = 0x8769
)

// editors are strings that appear in the Software tag of an image that has
// been through a desktop or mobile editor. Presence is evidence, not a verdict.
var editors = []string{
	"photoshop", "gimp", "lightroom", "affinity", "pixelmator", "paint.net",
	"snapseed", "picsart", "canva", "facetune", "imagemagick", "inkscape",
}

// ReadMetadata extracts what the file says about itself.
//
// Hand-rolled rather than pulling in an EXIF library: this needs four tags out
// of a JPEG's APP1 segment, and a dependency that parses every metadata format
// ever written is a larger attack surface than the four tags are worth on a
// path that accepts arbitrary uploads from the public.
func ReadMetadata(img []byte) (*Metadata, error) {
	m := &Metadata{}

	app1, err := findAPP1(img)
	if err != nil {
		return m, nil // no EXIF is a finding, not an error
	}
	m.HasEXIF = true

	// "Exif\0\0" then a TIFF header.
	if len(app1) < 14 || !bytes.HasPrefix(app1, []byte("Exif\x00\x00")) {
		return m, nil
	}
	tiff := app1[6:]

	var order binary.ByteOrder
	switch {
	case bytes.HasPrefix(tiff, []byte("II")):
		order = binary.LittleEndian
	case bytes.HasPrefix(tiff, []byte("MM")):
		order = binary.BigEndian
	default:
		return m, nil
	}
	if len(tiff) < 8 {
		return m, nil
	}
	offset := order.Uint32(tiff[4:8])

	// Walk the first IFD, then the Exif sub-IFD if it points to one.
	seen := map[uint32]bool{}
	for depth := 0; depth < 4 && offset != 0 && !seen[offset]; depth++ {
		seen[offset] = true
		next, sub := m.readIFD(tiff, order, offset)
		if sub != 0 && !seen[sub] {
			m.readIFD(tiff, order, sub)
			seen[sub] = true
		}
		offset = next
	}
	return m, nil
}

// readIFD reads one image file directory, returning the offset of the next one
// and of any Exif sub-directory it points to.
func (m *Metadata) readIFD(tiff []byte, order binary.ByteOrder, offset uint32) (next, sub uint32) {
	if int(offset)+2 > len(tiff) {
		return 0, 0
	}
	count := int(order.Uint16(tiff[offset : offset+2]))
	pos := int(offset) + 2

	for i := 0; i < count; i++ {
		if pos+12 > len(tiff) {
			return 0, sub
		}
		entry := tiff[pos : pos+12]
		pos += 12

		tag := order.Uint16(entry[0:2])
		typ := order.Uint16(entry[2:4])
		n := order.Uint32(entry[4:8])

		switch tag {
		case tagExifIFD:
			sub = order.Uint32(entry[8:12])
		case tagMake, tagModel, tagSoftware, tagDateTime, tagDateTimeOriginal:
			if typ != 2 { // ASCII
				continue
			}
			value := readASCII(tiff, order, entry[8:12], n)
			switch tag {
			case tagMake:
				m.Make = value
			case tagModel:
				m.Model = value
			case tagSoftware:
				m.Software = value
			case tagDateTime, tagDateTimeOriginal:
				// EXIF timestamps are local with no zone. Parsed as UTC and
				// only ever used for differences measured in days, where an
				// hour of zone error cannot change the answer.
				if t, err := time.Parse("2006:01:02 15:04:05", value); err == nil {
					if m.Taken.IsZero() || tag == tagDateTimeOriginal {
						m.Taken = t
					}
				}
			}
		}
	}

	if pos+4 <= len(tiff) {
		next = order.Uint32(tiff[pos : pos+4])
	}
	return next, sub
}

func readASCII(tiff []byte, order binary.ByteOrder, field []byte, n uint32) string {
	if n == 0 || n > 1024 {
		return ""
	}
	var raw []byte
	if n <= 4 {
		raw = field[:n]
	} else {
		off := order.Uint32(field)
		if int(off)+int(n) > len(tiff) {
			return ""
		}
		raw = tiff[off : off+n]
	}
	return strings.TrimRight(string(raw), "\x00 ")
}

// findAPP1 locates the EXIF segment in a JPEG.
func findAPP1(img []byte) ([]byte, error) {
	if len(img) < 4 || img[0] != 0xFF || img[1] != 0xD8 {
		return nil, fmt.Errorf("forensics: not a JPEG")
	}
	for i := 2; i+4 <= len(img); {
		if img[i] != 0xFF {
			i++
			continue
		}
		marker := img[i+1]
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2
			continue
		}
		if marker == 0xDA || marker == 0xD9 { // start of scan / end of image
			break
		}
		if i+4 > len(img) {
			break
		}
		size := int(binary.BigEndian.Uint16(img[i+2 : i+4]))
		if size < 2 || i+2+size > len(img) {
			break
		}
		if marker == 0xE1 {
			return img[i+4 : i+2+size], nil
		}
		i += 2 + size
	}
	return nil, fmt.Errorf("forensics: no EXIF segment")
}

// EditedBy returns the editor named in the metadata, if it names one.
func (m *Metadata) EditedBy() string {
	lower := strings.ToLower(m.Software)
	for _, e := range editors {
		if strings.Contains(lower, e) {
			return m.Software
		}
	}
	return ""
}

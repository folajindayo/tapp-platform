package forensics

import (
	"encoding/binary"
	"fmt"
)

// Compression describes how the JPEG was encoded.
//
// The useful property is that a camera and an editor quantize differently, and
// re-saving quantizes twice. A photograph straight off a phone carries that
// phone's quantization tables; one that has been opened and saved again
// carries the editor's, and its coefficients bear the marks of having been
// through the process twice.
type Compression struct {
	// Tables are the quantization tables in natural (row-major) order.
	//
	// The file stores them in zigzag order, which is the order the DCT
	// coefficients are transmitted in, not the order the frequencies sit in.
	// They are un-zigzagged on read so that comparing entry i against entry i
	// of the reference table compares the same frequency -- doing it the
	// obvious way silently compares unrelated coefficients and produces a
	// quality estimate that is wrong by about seven points.
	Tables [][64]uint16
	// Quality estimates the encoder's quality setting from the luminance
	// table, on the usual 1-100 scale.
	Quality int
	// Progressive encoding is common in web pipelines and rare in camera
	// output, so it suggests the file has been through one.
	Progressive   bool
	Width, Height int
}

// ReadCompression parses the quantization tables and frame header.
func ReadCompression(img []byte) (*Compression, error) {
	if len(img) < 4 || img[0] != 0xFF || img[1] != 0xD8 {
		return nil, fmt.Errorf("forensics: not a JPEG")
	}
	c := &Compression{}

	for i := 2; i+4 <= len(img); {
		if img[i] != 0xFF {
			i++
			continue
		}
		marker := img[i+1]
		if marker == 0x01 || (marker >= 0xD0 && marker <= 0xD8) {
			i += 2
			continue
		}
		if marker == 0xDA || marker == 0xD9 {
			break
		}
		if i+4 > len(img) {
			break
		}
		size := int(binary.BigEndian.Uint16(img[i+2 : i+4]))
		if size < 2 || i+2+size > len(img) {
			break
		}
		payload := img[i+4 : i+2+size]

		switch marker {
		case 0xDB: // define quantization table
			c.readTables(payload)
		case 0xC0, 0xC1: // baseline frame
			c.readFrame(payload)
		case 0xC2: // progressive frame
			c.Progressive = true
			c.readFrame(payload)
		}
		i += 2 + size
	}

	if len(c.Tables) == 0 {
		return nil, fmt.Errorf("forensics: no quantization tables")
	}
	c.Quality = estimateQuality(c.Tables[0])
	return c, nil
}

func (c *Compression) readFrame(p []byte) {
	if len(p) >= 5 {
		c.Height = int(binary.BigEndian.Uint16(p[1:3]))
		c.Width = int(binary.BigEndian.Uint16(p[3:5]))
	}
}

func (c *Compression) readTables(p []byte) {
	for len(p) > 0 {
		precision := p[0] >> 4 // 0 = 8-bit, 1 = 16-bit
		var table [64]uint16

		if precision == 0 {
			if len(p) < 65 {
				return
			}
			for i := 0; i < 64; i++ {
				table[zigzag[i]] = uint16(p[1+i])
			}
			p = p[65:]
		} else {
			if len(p) < 129 {
				return
			}
			for i := 0; i < 64; i++ {
				table[zigzag[i]] = binary.BigEndian.Uint16(p[1+i*2 : 3+i*2])
			}
			p = p[129:]
		}
		c.Tables = append(c.Tables, table)
	}
}

// zigzag maps a position in the file's transmission order to its position in
// the natural 8x8 frequency grid.
var zigzag = [64]int{
	0, 1, 8, 16, 9, 2, 3, 10,
	17, 24, 32, 25, 18, 11, 4, 5,
	12, 19, 26, 33, 40, 48, 41, 34,
	27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36,
	29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46,
	53, 60, 61, 54, 47, 55, 62, 63,
}

// standardLuminance is the JPEG specification's Annex K luminance table, the
// baseline every quality setting scales from.
var standardLuminance = [64]uint16{
	16, 11, 10, 16, 24, 40, 51, 61,
	12, 12, 14, 19, 26, 58, 60, 55,
	14, 13, 16, 24, 40, 57, 69, 56,
	14, 17, 22, 29, 51, 87, 80, 62,
	18, 22, 37, 56, 68, 109, 103, 77,
	24, 35, 55, 64, 81, 104, 113, 92,
	49, 64, 78, 87, 103, 121, 120, 101,
	72, 92, 95, 98, 112, 100, 103, 99,
}

// estimateQuality recovers the encoder's quality setting.
//
// The libjpeg scaling is invertible: the table is the standard one multiplied
// by a factor derived from quality, so averaging the ratio across the table
// recovers the factor and hence the setting. Cameras and editors both use this
// scaling, which is what makes the estimate comparable between them.
func estimateQuality(table [64]uint16) int {
	// Entries that hit the encoder's clamps carry no information about the
	// scale -- a 1 could have come from any high quality, and a 255 from any
	// low one -- so they are excluded rather than dragging the mean.
	var sum float64
	var n int
	for i := 0; i < 64; i++ {
		if standardLuminance[i] == 0 || table[i] <= 1 || table[i] >= 255 {
			continue
		}
		sum += float64(table[i]) / float64(standardLuminance[i])
		n++
	}
	if n == 0 {
		// Every entry hit a clamp, which happens at the extremes: a table of
		// all ones is maximum quality, a table of all 255s is minimum. Saying
		// 0 here would be a lie indistinguishable from "could not parse".
		if table[0] <= 1 {
			return 100
		}
		return 1
	}
	scale := sum / float64(n) * 100

	var quality float64
	if scale < 100 {
		quality = 100 - scale/2
	} else {
		quality = 5000 / scale
	}
	switch {
	case quality < 1:
		return 1
	case quality > 100:
		return 100
	default:
		return int(quality + 0.5)
	}
}

// LooksRecompressed reports whether the tables suggest the file has been
// encoded more than once.
//
// The signal is a quality setting that is high but not one a camera uses.
// Phone cameras cluster at a handful of specific settings; an editor saving at
// "90%" or a web pipeline normalising to a fixed quality lands elsewhere. This
// is weak evidence on its own and is scored as such -- plenty of legitimate
// images pass through a resize.
func (c *Compression) LooksRecompressed() bool {
	if c.Progressive {
		return true
	}
	// Cameras generally encode at 90 or above. A mid-range quality on an image
	// somebody says they just took is worth noticing.
	return c.Quality > 0 && c.Quality < 85
}

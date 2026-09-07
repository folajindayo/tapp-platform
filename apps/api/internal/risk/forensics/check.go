package forensics

import (
	"context"
	"fmt"
	"time"

	"github.com/usezoracle/tapp/api/internal/risk"
)

// StaleAfter is how old a photograph may claim to be before that is worth
// noticing. Somebody photographing cash to send it does so in the moment; a
// picture from last week is more likely to have come from a gallery than a
// pocket.
const StaleAfter = 24 * time.Hour

// Check inspects the image file itself.
//
// It never returns a verdict, only observations. Editing software in the
// metadata is not proof of anything -- images pass through editors innocently
// all the time -- and every signal here is weighted so that no single one, and
// no accumulation of them, denies a transfer on its own.
type Check struct {
	// Now is injectable for tests.
	Now func() time.Time
}

func (c *Check) Name() string { return "forensics" }

func (c *Check) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// Inspect reads what the file says about itself.
func (c *Check) Inspect(ctx context.Context, s risk.Subject) ([]risk.Signal, error) {
	if len(s.Image) == 0 {
		return nil, nil // nothing to inspect is not a failure
	}

	var out []risk.Signal

	meta, err := ReadMetadata(s.Image)
	if err != nil {
		return nil, fmt.Errorf("forensics: read metadata: %w", err)
	}

	// Absent metadata. Common and weak: every messaging app strips EXIF, and
	// so do most web upload pipelines. It says the image did not come straight
	// off a camera, which is worth one point of suspicion and no more.
	if !meta.HasEXIF {
		out = append(out, risk.Signal{
			Name:     "forensics.no_metadata",
			Detail:   "This photo has no camera information attached.",
			Severity: risk.Low,
		})
	} else if meta.Make == "" && meta.Model == "" {
		out = append(out, risk.Signal{
			Name:     "forensics.no_camera",
			Detail:   "This photo has no camera information attached.",
			Severity: risk.Low,
		})
	}

	// Named editing software. Stronger, because a camera does not write
	// Photoshop into its own metadata.
	if editor := meta.EditedBy(); editor != "" {
		out = append(out, risk.Signal{
			Name:     "forensics.edited",
			Detail:   "This photo was saved by photo editing software.",
			Severity: risk.Medium,
		})
		out = append(out, risk.Signal{
			Name:     "forensics.editor_name",
			Detail:   "Editor: " + editor,
			Severity: risk.Info,
		})
	}

	// A capture time well before the upload.
	if !meta.Taken.IsZero() {
		age := c.now().Sub(meta.Taken)
		if age > StaleAfter {
			out = append(out, risk.Signal{
				Name: "forensics.old_photo",
				Detail: fmt.Sprintf("This photo was taken %d days ago, not just now.",
					int(age.Hours()/24)),
				Severity: risk.Medium,
			})
		}
		// A capture time in the future means the clock is wrong or the
		// metadata was written by hand. Either is worth recording.
		if age < -time.Hour {
			out = append(out, risk.Signal{
				Name:     "forensics.future_timestamp",
				Detail:   "This photo is dated in the future.",
				Severity: risk.Medium,
			})
		}
	}

	comp, err := ReadCompression(s.Image)
	if err != nil {
		// Not a JPEG, or an unreadable one. The recognition stage will have
		// its own opinion; this check simply has nothing more to say.
		return out, nil
	}

	if comp.LooksRecompressed() {
		out = append(out, risk.Signal{
			Name: "forensics.recompressed",
			Detail: "This photo has been saved again since it was taken, " +
				"rather than sent straight from the camera.",
			Severity: risk.Low,
		})
	}

	// Very small images are the shape of something taken from a web page
	// rather than a camera. A phone photograph is thousands of pixels wide.
	if comp.Width > 0 && comp.Width < 640 {
		out = append(out, risk.Signal{
			Name:     "forensics.low_resolution",
			Detail:   "This photo is too small to have come from a phone camera.",
			Severity: risk.Medium,
		})
	}

	out = append(out, risk.Signal{
		Name: "forensics.encoding",
		Detail: fmt.Sprintf("quality %d, %dx%d, progressive=%v",
			comp.Quality, comp.Width, comp.Height, comp.Progressive),
		Severity: risk.Info,
	})

	return out, nil
}

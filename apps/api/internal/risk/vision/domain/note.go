// Package domain holds the shape of what recognition reports.
//
// Separate from the recogniser so that the note registry, the risk engine and
// the cash flow can all talk about a banknote without importing a Claude
// client.
package domain

import "github.com/usezoracle/tapp/api/internal/money"

// Note is a single banknote identified inside a photograph.
type Note struct {
	Denomination money.Amount `json:"denomination"`
	// Serial is the printed serial number, when it is legible. Often it is
	// not: a phone photograph of notes on a table rarely resolves them, which
	// is why the perceptual hash exists alongside.
	Serial           string  `json:"serial"`
	SerialConfidence float64 `json:"serialConfidence"`
	// PHash identifies the note by appearance, so a re-uploaded photograph is
	// caught even when no serial could be read.
	PHash string `json:"phash"`
}

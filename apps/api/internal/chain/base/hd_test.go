package base

import (
	"errors"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	ethcrypto "github.com/ethereum/go-ethereum/crypto"
)

const testSeed = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

func deriver(t *testing.T) *Deriver {
	t.Helper()
	seed, err := ParseSeed(testSeed)
	if err != nil {
		t.Fatalf("ParseSeed: %v", err)
	}
	d, err := NewDeriver(seed)
	if err != nil {
		t.Fatalf("NewDeriver: %v", err)
	}
	return d
}

// The property everything else rests on: given the seed, an address is
// reproducible. Nothing needs to be backed up except the seed, and losing the
// database does not lose anybody's money.
func TestDerivationIsDeterministic(t *testing.T) {
	first, second := deriver(t), deriver(t)

	for _, index := range []uint32{0, 1, 42, 1_000_000} {
		a, err := first.Address(index)
		if err != nil {
			t.Fatalf("Address(%d): %v", index, err)
		}
		b, err := second.Address(index)
		if err != nil {
			t.Fatalf("Address(%d): %v", index, err)
		}
		if a != b {
			t.Fatalf("index %d derived %s then %s", index, a, b)
		}
		if a == (common.Address{}) {
			t.Fatalf("index %d derived the zero address", index)
		}
	}
}

// Every user must get a different address, or deposits cannot be attributed.
func TestEachIndexIsADifferentAddress(t *testing.T) {
	d := deriver(t)
	seen := map[common.Address]uint32{}

	for index := uint32(0); index < 500; index++ {
		addr, err := d.Address(index)
		if err != nil {
			t.Fatalf("Address(%d): %v", index, err)
		}
		if prev, clash := seen[addr]; clash {
			t.Fatalf("indices %d and %d both derive %s", prev, index, addr)
		}
		seen[addr] = index
	}
}

// A different seed must produce entirely different addresses, or one
// deployment could receive another's deposits.
func TestADifferentSeedIsADifferentWallet(t *testing.T) {
	a := deriver(t)

	otherSeed, _ := ParseSeed(strings.Repeat("ab", SeedLen))
	b, err := NewDeriver(otherSeed)
	if err != nil {
		t.Fatalf("NewDeriver: %v", err)
	}

	for index := uint32(0); index < 20; index++ {
		x, _ := a.Address(index)
		y, _ := b.Address(index)
		if x == y {
			t.Fatalf("two seeds derived the same address at index %d: %s", index, x)
		}
	}
}

// The key for an address must actually control it, or a sweep cannot move the
// deposit.
func TestTheDerivedKeyControlsTheDerivedAddress(t *testing.T) {
	d := deriver(t)

	for _, index := range []uint32{0, 7, 999} {
		addr, err := d.Address(index)
		if err != nil {
			t.Fatalf("Address: %v", err)
		}
		key, err := d.PrivateKey(index)
		if err != nil {
			t.Fatalf("PrivateKey: %v", err)
		}
		if got := ethcrypto.PubkeyToAddress(key.PublicKey); got != addr {
			t.Fatalf("index %d: key controls %s but the address is %s", index, got, addr)
		}
	}
}

// No default seed, and no silently-accepted short one. A deposit rail that
// fell back to a fixed seed would put every deployment's funds under the same
// key -- which is exactly the failure the per-user keys had.
func TestASeedMustBePresentAndFullLength(t *testing.T) {
	if _, err := ParseSeed(""); !errors.Is(err, ErrNoSeed) {
		t.Errorf("an empty seed gave %v, want ErrNoSeed", err)
	}
	for name, seed := range map[string]string{
		"too short": strings.Repeat("ab", SeedLen-1),
		"too long":  strings.Repeat("ab", SeedLen+1),
		"not hex":   strings.Repeat("zz", SeedLen),
	} {
		if _, err := ParseSeed(seed); err == nil {
			t.Errorf("a %s seed was accepted", name)
		}
	}
	// A 0x prefix is accepted, because operators paste keys that way.
	if _, err := ParseSeed("0x" + testSeed); err != nil {
		t.Errorf("a 0x-prefixed seed was refused: %v", err)
	}
}

// A hardened index is a different derivation and would silently produce a
// different address from the one a deposit was sent to.
func TestHardenedIndicesAreRefused(t *testing.T) {
	d := deriver(t)
	if _, err := d.Address(1 << 31); err == nil {
		t.Fatal("a hardened index was accepted")
	}
}

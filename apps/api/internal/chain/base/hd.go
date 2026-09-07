// Package base is the USDC rail on Base.
//
// Money arrives at an address derived for one person, is swept into a pooled
// treasury, and their balance is a ledger entry. Money leaves by a ledger
// debit followed by a transfer from that treasury.
//
// # Why pooled, and why derived
//
// Each user gets their OWN deposit address so a payment can be attributed on
// chain without asking anybody to quote a reference. But the funds are swept
// into one treasury, so there is ONE key to protect rather than one per
// account. The predecessor generated a fresh secp256k1 key per signup and
// sealed each with a master key -- which meant N secrets at risk instead of
// one, and every one of them sealed by a literal committed to the repository.
//
// Deposit addresses are derived, not stored. Given the seed and an index the
// address and its key are reproducible, so nothing needs to be backed up
// except the seed, and losing the database does not lose anybody's money.
package base

import (
	"crypto/ecdsa"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	ethcrypto "github.com/ethereum/go-ethereum/crypto"
	"github.com/tyler-smith/go-bip32"
)

// SeedLen is the required master seed size in bytes.
//
// 32 bytes of entropy. Shorter would weaken every address derived from it, and
// there is no reason to accept less when generating one costs a command.
const SeedLen = 32

// ErrNoSeed means no master seed is configured.
//
// Fatal at startup, deliberately. A deposit rail that cannot derive an address
// cannot take a deposit, and one that fell back to a fixed seed would put
// every deployment's funds under the same key -- which is precisely the
// failure this replaces.
var ErrNoSeed = errors.New("base: no deposit master seed configured")

// derivationPath is m/44'/60'/0'/0/index -- the standard Ethereum account
// path. Using the standard one matters for recovery: an operator with the seed
// can reach these addresses from any wallet software rather than needing this
// program.
const (
	purpose  = bip32.FirstHardenedChild + 44
	coinType = bip32.FirstHardenedChild + 60
	account  = bip32.FirstHardenedChild + 0
	change   = 0
)

// Deriver turns an index into an address and its key.
type Deriver struct {
	// external is the m/44'/60'/0'/0 node. The seed itself is not retained
	// beyond construction: everything below this node can be derived from it,
	// and nothing above it is ever needed.
	external *bip32.Key
}

// ParseSeed validates a hex master seed.
func ParseSeed(hexSeed string) ([]byte, error) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(hexSeed), "0x")
	if trimmed == "" {
		return nil, ErrNoSeed
	}
	seed, err := hex.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("base: master seed is not valid hex: %w", err)
	}
	if len(seed) != SeedLen {
		return nil, fmt.Errorf("base: master seed must be %d bytes (%d hex characters), got %d",
			SeedLen, SeedLen*2, len(seed))
	}
	return seed, nil
}

// NewDeriver builds a deriver from a validated seed.
func NewDeriver(seed []byte) (*Deriver, error) {
	if len(seed) != SeedLen {
		return nil, fmt.Errorf("base: master seed must be %d bytes, got %d", SeedLen, len(seed))
	}

	master, err := bip32.NewMasterKey(seed)
	if err != nil {
		return nil, fmt.Errorf("base: derive master key: %w", err)
	}
	node := master
	for _, step := range []uint32{purpose, coinType, account, change} {
		node, err = node.NewChildKey(step)
		if err != nil {
			return nil, fmt.Errorf("base: derive m/44'/60'/0'/0: %w", err)
		}
	}
	return &Deriver{external: node}, nil
}

// Address returns the deposit address for an index.
func (d *Deriver) Address(index uint32) (common.Address, error) {
	key, err := d.privateKey(index)
	if err != nil {
		return common.Address{}, err
	}
	return ethcrypto.PubkeyToAddress(key.PublicKey), nil
}

// PrivateKey returns the key for an index, for sweeping a deposit.
//
// Derived on demand and never persisted. A key that is not stored cannot be
// stolen from storage, and this one is reproducible from the seed whenever it
// is actually needed -- which is only when moving a deposit to the treasury.
func (d *Deriver) PrivateKey(index uint32) (*ecdsa.PrivateKey, error) {
	return d.privateKey(index)
}

func (d *Deriver) privateKey(index uint32) (*ecdsa.PrivateKey, error) {
	if index >= bip32.FirstHardenedChild {
		// Hardened indices are a different derivation and would silently
		// produce a different address from the one a deposit was sent to.
		return nil, fmt.Errorf("base: deposit index %d is out of range", index)
	}
	child, err := d.external.NewChildKey(index)
	if err != nil {
		return nil, fmt.Errorf("base: derive index %d: %w", index, err)
	}
	key, err := ethcrypto.ToECDSA(child.Key)
	if err != nil {
		return nil, fmt.Errorf("base: index %d is not a valid key: %w", index, err)
	}
	return key, nil
}

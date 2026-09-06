package crypto

import (
	"bytes"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

const testKeyHex = "4a1f8e3c9b7d2a604f8e1c3b5d7a9f204e6c8a0b2d4f6180a3c5e7092b4d6f81"

func mustKey(t *testing.T) []byte {
	t.Helper()
	k, err := ParseMasterKey(testKeyHex)
	if err != nil {
		t.Fatalf("ParseMasterKey(valid): %v", err)
	}
	return k
}

// A master key that is absent, not hex, or the wrong length must be refused.
// Every one of these used to silently resolve to a constant compiled into the
// binary, which meant an operator could believe they had configured custody
// when they had not.
func TestParseMasterKeyRefusesAnythingButAValidKey(t *testing.T) {
	t.Run("empty is a distinct error so startup can name the mistake", func(t *testing.T) {
		_, err := ParseMasterKey("")
		if !errors.Is(err, ErrNoMasterKey) {
			t.Fatalf("want ErrNoMasterKey, got %v", err)
		}
	})

	for name, in := range map[string]string{
		"not hex":   strings.Repeat("z", 64),
		"too short": strings.Repeat("ab", MasterKeyLen-1),
		"too long":  strings.Repeat("ab", MasterKeyLen+1),
		"odd hex":   strings.Repeat("a", 63),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseMasterKey(in); err == nil {
				t.Fatalf("ParseMasterKey(%s) accepted an invalid key", name)
			}
		})
	}

	if _, err := ParseMasterKey(testKeyHex); err != nil {
		t.Fatalf("a valid 32-byte key was refused: %v", err)
	}
}

func TestWalletRoundTrips(t *testing.T) {
	key := mustKey(t)

	addr, sealed, err := GenerateEVMWallet(key)
	if err != nil {
		t.Fatalf("GenerateEVMWallet: %v", err)
	}
	if !strings.HasPrefix(addr, "0x") || len(addr) != 42 {
		t.Fatalf("not an EVM address: %q", addr)
	}

	opened, err := DecryptEVMPrivateKey(sealed, key)
	if err != nil {
		t.Fatalf("DecryptEVMPrivateKey: %v", err)
	}
	if len(opened) != 32 {
		t.Fatalf("secp256k1 private key should be 32 bytes, got %d", len(opened))
	}
}

// GCM uses a fresh nonce per call, so sealing the same key twice must not
// produce the same ciphertext -- otherwise equal ciphertexts would leak that
// two users share a key.
func TestEncryptionIsNonDeterministic(t *testing.T) {
	key := mustKey(t)
	priv := bytes.Repeat([]byte{0x11}, 32)

	a, err := EncryptPrivateKey(priv, key)
	if err != nil {
		t.Fatalf("first seal: %v", err)
	}
	b, err := EncryptPrivateKey(priv, key)
	if err != nil {
		t.Fatalf("second seal: %v", err)
	}
	if a == b {
		t.Fatal("identical ciphertexts for the same plaintext: the nonce is not fresh")
	}
}

// The whole point of removing the default: a ciphertext sealed under one key
// must not open under another. If this ever passes with a mismatched key, the
// fallback has crept back in.
func TestWrongMasterKeyCannotOpen(t *testing.T) {
	key := mustKey(t)
	other, err := ParseMasterKey(strings.Repeat("cd", MasterKeyLen))
	if err != nil {
		t.Fatalf("ParseMasterKey(other): %v", err)
	}

	_, sealed, err := GenerateEVMWallet(key)
	if err != nil {
		t.Fatalf("GenerateEVMWallet: %v", err)
	}
	if _, err := DecryptEVMPrivateKey(sealed, other); err == nil {
		t.Fatal("a private key opened under the wrong master key")
	}
}

func TestShortCiphertextIsRejectedNotPanicked(t *testing.T) {
	key := mustKey(t)
	if _, err := DecryptEVMPrivateKey(hex.EncodeToString([]byte{0x01, 0x02}), key); err == nil {
		t.Fatal("a ciphertext shorter than the nonce was accepted")
	}
}

// A key of the wrong length must be refused at the cipher boundary too, not
// only by ParseMasterKey -- callers hold []byte and could construct one.
func TestSealRefusesAWrongLengthKey(t *testing.T) {
	if _, err := EncryptPrivateKey(bytes.Repeat([]byte{0x01}, 32), []byte{0x01, 0x02}); err == nil {
		t.Fatal("EncryptPrivateKey accepted a 2-byte master key")
	}
}

// The constant that used to live in this package must be gone. This is a
// regression guard: reintroducing it would silently re-key every wallet.
func TestNoHardcodedKeyRemains(t *testing.T) {
	if _, err := ParseMasterKey(""); !errors.Is(err, ErrNoMasterKey) {
		t.Fatal("an empty master key resolved to something usable")
	}
}

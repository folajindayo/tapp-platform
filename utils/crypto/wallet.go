package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	"github.com/ethereum/go-ethereum/crypto"
)

// MasterKeyLen is the AES-256 key size. A master key of any other length is
// rejected rather than stretched or truncated: silently accepting a short key
// would weaken every private key encrypted under it, and silently accepting a
// long one would discard entropy the operator believed they had configured.
const MasterKeyLen = 32

// ErrNoMasterKey means the wallet master key is absent. It is deliberately a
// distinct error from a malformed one so startup can tell an operator which
// mistake they made.
var ErrNoMasterKey = errors.New("crypto: wallet master key is not configured")

// ParseMasterKey decodes and validates the configured master key.
//
// There is no default and no fallback. A previous revision of this file
// carried a literal 32-byte key used whenever WALLET_MASTER_KEY was unset OR
// malformed, which meant every custodied private key was encrypted under a
// value committed to the repository -- and, because both call sites passed an
// empty string, that path was the only one ever taken. Refusing to start is
// the only safe behaviour: a key-management failure must never degrade into
// key-management theatre.
func ParseMasterKey(masterKeyHex string) ([]byte, error) {
	if masterKeyHex == "" {
		return nil, ErrNoMasterKey
	}
	b, err := hex.DecodeString(masterKeyHex)
	if err != nil {
		return nil, fmt.Errorf("crypto: wallet master key is not valid hex: %w", err)
	}
	if len(b) != MasterKeyLen {
		return nil, fmt.Errorf(
			"crypto: wallet master key must be %d bytes (%d hex characters), got %d",
			MasterKeyLen, MasterKeyLen*2, len(b))
	}
	return b, nil
}

// GenerateEVMWallet creates a secp256k1 keypair and returns the 0x-prefixed
// address alongside the AES-256-GCM encrypted private key, hex-encoded.
//
// masterKey must already have come from ParseMasterKey.
func GenerateEVMWallet(masterKey []byte) (address string, encryptedKeyHex string, err error) {
	privateKey, err := crypto.GenerateKey()
	if err != nil {
		return "", "", fmt.Errorf("generate keypair: %w", err)
	}

	address = crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
	privKeyBytes := crypto.FromECDSA(privateKey)

	encryptedKeyHex, err = EncryptPrivateKey(privKeyBytes, masterKey)
	if err != nil {
		return "", "", fmt.Errorf("encrypt private key: %w", err)
	}
	return address, encryptedKeyHex, nil
}

// EncryptPrivateKey seals raw private key bytes with AES-256-GCM under
// masterKey. The nonce is generated per call and prefixed to the ciphertext.
func EncryptPrivateKey(privKeyBytes, masterKey []byte) (string, error) {
	aesGCM, err := newGCM(masterKey)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce generation: %w", err)
	}

	return hex.EncodeToString(aesGCM.Seal(nonce, nonce, privKeyBytes, nil)), nil
}

// DecryptEVMPrivateKey opens a ciphertext produced by EncryptPrivateKey.
func DecryptEVMPrivateKey(encryptedHex string, masterKey []byte) ([]byte, error) {
	data, err := hex.DecodeString(encryptedHex)
	if err != nil {
		return nil, fmt.Errorf("hex decode: %w", err)
	}

	aesGCM, err := newGCM(masterKey)
	if err != nil {
		return nil, err
	}

	nonceSize := aesGCM.NonceSize()
	if len(data) < nonceSize {
		return nil, errors.New("crypto: ciphertext is shorter than the nonce")
	}

	privKeyBytes, err := aesGCM.Open(nil, data[:nonceSize], data[nonceSize:], nil)
	if err != nil {
		// Wrong master key and tampered ciphertext are indistinguishable here,
		// and both mean the same thing to the caller: this value cannot be
		// trusted. Do not report which.
		return nil, fmt.Errorf("decrypt failed: %w", err)
	}
	return privKeyBytes, nil
}

func newGCM(masterKey []byte) (cipher.AEAD, error) {
	if len(masterKey) != MasterKeyLen {
		return nil, fmt.Errorf(
			"crypto: wallet master key must be %d bytes, got %d", MasterKeyLen, len(masterKey))
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return nil, fmt.Errorf("aes cipher: %w", err)
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm cipher: %w", err)
	}
	return aesGCM, nil
}

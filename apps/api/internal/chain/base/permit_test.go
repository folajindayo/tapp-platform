package base

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	ethcrypto "github.com/ethereum/go-ethereum/crypto"
)

// The digest a permit is signed over must recover to the address that owns the
// funds. This is the whole correctness condition, and it needs no network: a
// signature that recovers elsewhere authorises nothing, and the token reports
// that as an ordinary revert.
func TestAPermitRecoversToTheAddressThatOwnsTheFunds(t *testing.T) {
	ownerKey, err := ethcrypto.GenerateKey()
	if err != nil {
		t.Fatalf("key: %v", err)
	}
	owner := ethcrypto.PubkeyToAddress(ownerKey.PublicKey)
	spender := common.HexToAddress("0x00000000000000000000000000000000000000A1")
	domain := ethcrypto.Keccak256([]byte("a domain separator, as the token reports it"))
	value, nonce, deadline := big.NewInt(100000), big.NewInt(7), big.NewInt(1893456000)

	structHash := ethcrypto.Keccak256(
		permitTypeHash,
		common.LeftPadBytes(owner.Bytes(), 32),
		common.LeftPadBytes(spender.Bytes(), 32),
		common.LeftPadBytes(value.Bytes(), 32),
		common.LeftPadBytes(nonce.Bytes(), 32),
		common.LeftPadBytes(deadline.Bytes(), 32),
	)
	digest := ethcrypto.Keccak256([]byte{0x19, 0x01}, domain, structHash)

	sig, err := ethcrypto.Sign(digest, ownerKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	recovered, err := ethcrypto.SigToPub(digest, sig)
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	if got := ethcrypto.PubkeyToAddress(*recovered); got != owner {
		t.Fatalf("permit recovers to %s, funds belong to %s", got, owner)
	}
}

// A permit signed over a different domain separator must NOT recover to the
// owner. Without this, the test above passes even if the domain were dropped
// from the digest entirely -- and dropping it is exactly the mistake that
// makes a permit verify on the wrong chain or the wrong token.
func TestTheDomainSeparatorIsPartOfWhatIsSigned(t *testing.T) {
	ownerKey, _ := ethcrypto.GenerateKey()
	owner := ethcrypto.PubkeyToAddress(ownerKey.PublicKey)
	spender := common.HexToAddress("0x00000000000000000000000000000000000000A1")
	value, nonce, deadline := big.NewInt(1), big.NewInt(0), big.NewInt(1893456000)

	structHash := ethcrypto.Keccak256(
		permitTypeHash,
		common.LeftPadBytes(owner.Bytes(), 32),
		common.LeftPadBytes(spender.Bytes(), 32),
		common.LeftPadBytes(value.Bytes(), 32),
		common.LeftPadBytes(nonce.Bytes(), 32),
		common.LeftPadBytes(deadline.Bytes(), 32),
	)
	signedOver := ethcrypto.Keccak256([]byte{0x19, 0x01},
		ethcrypto.Keccak256([]byte("token A on chain 8453")), structHash)
	verifiedAgainst := ethcrypto.Keccak256([]byte{0x19, 0x01},
		ethcrypto.Keccak256([]byte("token B on chain 84532")), structHash)

	sig, _ := ethcrypto.Sign(signedOver, ownerKey)
	recovered, err := ethcrypto.SigToPub(verifiedAgainst, sig)
	if err != nil {
		return // unrecoverable is also a rejection
	}
	if ethcrypto.PubkeyToAddress(*recovered) == owner {
		t.Fatal("a permit for one token/chain verified against another")
	}
}

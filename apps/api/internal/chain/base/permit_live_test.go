package base

import (
	"context"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	ethcrypto "github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Simulates a real permit against a live USDC contract with eth_call. No state
// change, no gas.
//
// Skipped unless RPC, SEED and USDC are set, because it needs the network and
// the real derivation seed. Worth running before a deploy that touches
// permit.go: a wrong EIP-712 digest still produces a VALID signature, it just
// recovers to an address that does not own the funds, and the only place that
// difference shows up is a revert nobody sees until a sweep fails.
func TestPermitDigestIsAcceptedByRealUSDC(t *testing.T) {
	rpc, seedHex, usdc := os.Getenv("RPC"), os.Getenv("SEED"), os.Getenv("USDC")
	if rpc == "" || seedHex == "" || usdc == "" {
		t.Skip("needs RPC, SEED, USDC")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client, err := ethclient.DialContext(ctx, rpc)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	seed, err := ParseSeed(seedHex)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	d, err := NewDeriver(seed)
	if err != nil {
		t.Fatalf("deriver: %v", err)
	}
	ownerKey, err := d.PrivateKey(13)
	if err != nil {
		t.Fatalf("key: %v", err)
	}
	owner := ethcrypto.PubkeyToAddress(ownerKey.PublicKey)
	token := common.HexToAddress(usdc)
	spender := common.HexToAddress("0x000000000000000000000000000000000000dEaD") // stand-in treasury

	call := func(data []byte) ([]byte, error) {
		return client.CallContract(ctx, ethereum.CallMsg{To: &token, Data: data}, nil)
	}

	dsData, _ := parsedERC20.Pack("DOMAIN_SEPARATOR")
	domain, err := call(dsData)
	if err != nil {
		t.Fatalf("domain separator: %v", err)
	}
	nData, _ := parsedERC20.Pack("nonces", owner)
	nRaw, err := call(nData)
	if err != nil {
		t.Fatalf("nonces: %v", err)
	}
	nonce := new(big.Int).SetBytes(nRaw)
	value := big.NewInt(100000) // 0.1 USDC
	deadline := big.NewInt(time.Now().Add(30 * time.Minute).Unix())

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
	var r, s [32]byte
	copy(r[:], sig[:32])
	copy(s[:], sig[32:64])
	v := sig[64] + 27

	permitData, err := parsedERC20.Pack("permit", owner, spender, value, deadline, v, r, s)
	if err != nil {
		t.Fatalf("pack permit: %v", err)
	}
	// The permit is simulated AS the treasury would send it: from a third
	// party, which is the whole point -- the owner pays nothing.
	if _, err := client.CallContract(ctx, ethereum.CallMsg{
		From: common.HexToAddress("0x000000000000000000000000000000000000dEaD"),
		To:   &token, Data: permitData,
	}, nil); err != nil {
		t.Fatalf("REAL USDC REJECTED THE PERMIT: %v", err)
	}
	t.Logf("permit accepted by USDC %s for owner %s (nonce %s)", token.Hex(), owner.Hex(), nonce)
}

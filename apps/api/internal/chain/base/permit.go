// Sweeping a deposit address that holds no gas.
//
// A derived deposit address receives USDC and nothing else. It has no ETH,
// and nothing funds it: sweeping by signing a transfer FROM that address
// therefore fails for want of gas, however much USDC is sitting there.
//
// The way out is EIP-2612. USDC on Base is a permit token, so the address can
// authorise a spender with an OFF-CHAIN signature, which costs nothing and
// needs no balance. The treasury -- the one key that is funded -- then submits
// the permit and the pull, paying gas for both.
//
// The alternative, funding every deposit address with a little ETH, means
// dust at a thousand addresses, a second asset to monitor, and a top-up path
// that is itself a drain vector. This needs none of it.
package base

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	ethcrypto "github.com/ethereum/go-ethereum/crypto"
)

// permitTypeHash is keccak256 of the EIP-2612 Permit struct signature.
var permitTypeHash = ethcrypto.Keccak256(
	[]byte("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"))

// permitValidity is how long a signed permit is good for.
//
// Short, because the signature authorises the treasury to pull funds and a
// long-lived one left in a log or a failed transaction is an authorisation
// nobody is tracking. Long enough that a slow block does not expire it
// mid-flight.
const permitValidity = 30 * time.Minute

// SweepWithPermit moves an address's USDC to the treasury without that address
// holding any gas.
//
// Two transactions, both submitted and paid for by the treasury:
//
//  1. permit(owner, treasury, value, deadline, v, r, s)  -- grants the pull
//  2. transferFrom(owner, treasury, value)               -- performs it
//
// They are separate because doing both atomically would need a contract
// deployed to batch them, and a deployment is a larger commitment than this
// problem warrants. Splitting them is safe: the allowance names the treasury
// as the only spender, so nobody else can act on it in between.
//
// Idempotent by inspection rather than by bookkeeping. If a previous attempt
// left an allowance standing -- permit landed, the pull did not -- the permit
// is skipped and the pull retried. Re-signing would consume a fresh nonce and
// invalidate nothing, but it would also spend gas to buy an authorisation
// that already exists.
func (c *Chain) SweepWithPermit(
	ctx context.Context, ownerKey *ecdsa.PrivateKey, amountMicro *big.Int,
) (string, error) {
	if !c.CanSend() {
		return "", fmt.Errorf("base: no treasury key; cannot pay for a permit sweep")
	}
	if amountMicro == nil || amountMicro.Sign() <= 0 {
		return "", fmt.Errorf("base: nothing to sweep")
	}
	owner := ethcrypto.PubkeyToAddress(ownerKey.PublicKey)

	allowance, err := c.allowance(ctx, owner, c.Treasury)
	if err != nil {
		return "", err
	}
	if allowance.Cmp(amountMicro) < 0 {
		if err := c.grantPermit(ctx, ownerKey, owner, amountMicro); err != nil {
			return "", err
		}
	}

	data, err := parsedERC20.Pack("transferFrom", owner, c.Treasury, amountMicro)
	if err != nil {
		return "", err
	}
	return c.submitFromTreasury(ctx, data)
}

// grantPermit signs the authorisation off-chain and has the treasury post it.
func (c *Chain) grantPermit(
	ctx context.Context, ownerKey *ecdsa.PrivateKey, owner common.Address, value *big.Int,
) error {
	nonce, err := c.permitNonce(ctx, owner)
	if err != nil {
		return err
	}
	domain, err := c.domainSeparator(ctx)
	if err != nil {
		return err
	}
	deadline := big.NewInt(time.Now().Add(permitValidity).Unix())

	// EIP-712: digest = keccak256(0x19 0x01 ‖ domainSeparator ‖ structHash).
	//
	// The domain separator is READ FROM THE CONTRACT rather than rebuilt from
	// a name and version guessed here. Rebuilding it is how a permit comes to
	// be signed over a domain the token does not recognise: the signature
	// verifies as valid and recovers to the wrong address, and the failure
	// surfaces as an opaque revert.
	structHash := ethcrypto.Keccak256(
		permitTypeHash,
		common.LeftPadBytes(owner.Bytes(), 32),
		common.LeftPadBytes(c.Treasury.Bytes(), 32),
		common.LeftPadBytes(value.Bytes(), 32),
		common.LeftPadBytes(nonce.Bytes(), 32),
		common.LeftPadBytes(deadline.Bytes(), 32),
	)
	digest := ethcrypto.Keccak256([]byte{0x19, 0x01}, domain, structHash)

	sig, err := ethcrypto.Sign(digest, ownerKey)
	if err != nil {
		return fmt.Errorf("base: sign permit: %w", err)
	}
	// go-ethereum returns v as 0/1; EIP-2612 expects 27/28.
	var r, s [32]byte
	copy(r[:], sig[:32])
	copy(s[:], sig[32:64])
	v := sig[64] + 27

	data, err := parsedERC20.Pack("permit", owner, c.Treasury, value, deadline, v, r, s)
	if err != nil {
		return err
	}
	txHash, err := c.submitFromTreasury(ctx, data)
	if err != nil {
		return fmt.Errorf("base: submit permit: %w", err)
	}

	// The pull is a separate transaction and would revert if it arrived first,
	// so the permit has to be mined before continuing.
	ok, err := c.WaitMined(ctx, txHash)
	if err != nil {
		return fmt.Errorf("base: waiting for permit %s: %w", txHash, err)
	}
	if !ok {
		return fmt.Errorf("base: permit %s reverted", txHash)
	}
	return nil
}

// submitFromTreasury sends arbitrary USDC calldata, signed and paid by the
// treasury. The fee ceiling matches SendUSDC's: room for the base fee to
// double, so a transaction does not sit unmined and read as stuck.
func (c *Chain) submitFromTreasury(ctx context.Context, data []byte) (string, error) {
	return c.submitCall(ctx, c.treasuryKey, data)
}

func (c *Chain) allowance(ctx context.Context, owner, spender common.Address) (*big.Int, error) {
	data, err := parsedERC20.Pack("allowance", owner, spender)
	if err != nil {
		return nil, err
	}
	out, err := c.Client.CallContract(ctx, ethereumCall(c.USDC, data), nil)
	if err != nil {
		return nil, fmt.Errorf("base: read allowance: %w", err)
	}
	return new(big.Int).SetBytes(out), nil
}

func (c *Chain) permitNonce(ctx context.Context, owner common.Address) (*big.Int, error) {
	data, err := parsedERC20.Pack("nonces", owner)
	if err != nil {
		return nil, err
	}
	out, err := c.Client.CallContract(ctx, ethereumCall(c.USDC, data), nil)
	if err != nil {
		return nil, fmt.Errorf("base: read permit nonce: %w", err)
	}
	return new(big.Int).SetBytes(out), nil
}

func (c *Chain) domainSeparator(ctx context.Context) ([]byte, error) {
	data, err := parsedERC20.Pack("DOMAIN_SEPARATOR")
	if err != nil {
		return nil, err
	}
	out, err := c.Client.CallContract(ctx, ethereumCall(c.USDC, data), nil)
	if err != nil {
		return nil, fmt.Errorf("base: read domain separator: %w", err)
	}
	if len(out) != 32 {
		return nil, fmt.Errorf("base: domain separator is %d bytes, want 32 -- is this a permit token?", len(out))
	}
	return out, nil
}

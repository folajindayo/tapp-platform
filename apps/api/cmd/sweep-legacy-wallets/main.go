// Command sweep-legacy-wallets moves funds out of the per-user wallets that
// predate the pooled treasury, so the old master key can be retired.
//
// # Why this exists
//
// An earlier revision generated a secp256k1 keypair per signup and sealed each
// private key with an AES master key -- which, because both call sites passed
// an empty string, was always a literal committed to the repository. Every one
// of those keys must be treated as known to anybody who has seen the source.
//
// The fix is not to rotate the master key. Re-encrypting a key an attacker
// already holds changes nothing: they do not need our copy. The funds have to
// MOVE, to addresses derived from a seed that was never in the repository.
//
// # Order of operations, which matters
//
//  1. run this, with the OLD key, and let it drain every legacy address
//  2. confirm the balances are zero
//  3. only then rotate WALLET_MASTER_KEY and drop the columns
//
// Rotating first would leave the funds exactly where they are, still reachable
// by anybody with the old key, and remove our own ability to move them.
//
// The old key is supplied as an argument rather than carried in the code. It
// is a compromised secret; the code that replaced it should not know it.
package main

import (
	"context"
	"flag"
	"fmt"
	"math/big"
	"os"
	"time"

	"github.com/ethereum/go-ethereum/common"
	ethcrypto "github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/chain/base"
	"github.com/usezoracle/tapp/api/utils/crypto"
)

func main() {
	var (
		dsn       = flag.String("database", os.Getenv("DATABASE_URL"), "Postgres URL")
		legacyKey = flag.String("legacy-key", os.Getenv("LEGACY_WALLET_MASTER_KEY"),
			"the OLD master key the per-user private keys were sealed with, hex")
		rpcURL   = flag.String("rpc", os.Getenv("BASE_RPC_URL"), "Base RPC URL")
		usdc     = flag.String("usdc", os.Getenv("BASE_USDC_CONTRACT"), "USDC contract")
		treasury = flag.String("treasury", "", "address to sweep into")
		chainID  = flag.Int64("chain-id", 8453, "Base chain id")
		dryRun   = flag.Bool("dry-run", true, "report what would move without moving it")
	)
	flag.Parse()

	if *dsn == "" || *legacyKey == "" || *rpcURL == "" || *usdc == "" || *treasury == "" {
		fmt.Fprintln(os.Stderr,
			"usage: sweep-legacy-wallets -database ... -legacy-key ... -rpc ... -usdc ... -treasury 0x... [-dry-run=false]")
		os.Exit(2)
	}
	if !common.IsHexAddress(*treasury) {
		fmt.Fprintf(os.Stderr, "%q is not an address\n", *treasury)
		os.Exit(2)
	}

	master, err := crypto.ParseMasterKey(*legacyKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "legacy key: %s\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "database: %s\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	chain, err := base.NewChain(ctx, *rpcURL, *usdc, "", *chainID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "chain: %s\n", err)
		os.Exit(1)
	}

	rows, err := pool.Query(ctx, `
		SELECT id, evm_address, encrypted_private_key
		  FROM users
		 WHERE evm_address IS NOT NULL AND evm_address <> ''
		   AND encrypted_private_key IS NOT NULL AND encrypted_private_key <> ''`)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read users: %s\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	type wallet struct {
		user      string
		address   string
		sealedKey string
	}
	var wallets []wallet
	for rows.Next() {
		var w wallet
		if err := rows.Scan(&w.user, &w.address, &w.sealedKey); err != nil {
			fmt.Fprintf(os.Stderr, "scan: %s\n", err)
			os.Exit(1)
		}
		wallets = append(wallets, w)
	}

	fmt.Printf("%d legacy wallets to check\n", len(wallets))
	if *dryRun {
		fmt.Println("DRY RUN — nothing will be moved. Re-run with -dry-run=false to sweep.")
	}

	var held, moved int
	total := big.NewInt(0)

	for _, w := range wallets {
		addr := common.HexToAddress(w.address)
		balance, err := chain.USDCBalance(ctx, addr)
		if err != nil {
			fmt.Printf("  %s  BALANCE UNREADABLE: %s\n", w.address, err)
			continue
		}
		if balance.Sign() == 0 {
			continue
		}
		held++
		total.Add(total, balance)
		fmt.Printf("  %s  holds %s USDC micro (user %s)\n", w.address, balance, w.user)

		if *dryRun {
			continue
		}

		raw, err := crypto.DecryptEVMPrivateKey(w.sealedKey, master)
		if err != nil {
			// The wrong old key, or a row sealed under a different one. Not
			// something to guess at: report it and move on, so the operator
			// knows exactly which wallets were not drained.
			fmt.Printf("    COULD NOT DECRYPT: %s\n", err)
			continue
		}
		key, err := ethcrypto.ToECDSA(raw)
		if err != nil {
			fmt.Printf("    NOT A VALID KEY: %s\n", err)
			continue
		}
		if got := ethcrypto.PubkeyToAddress(key.PublicKey); got != addr {
			fmt.Printf("    KEY CONTROLS %s, NOT %s — skipped\n", got, addr)
			continue
		}

		txHash, err := chain.SendUSDC(ctx, key, common.HexToAddress(*treasury), balance)
		if err != nil {
			fmt.Printf("    SWEEP FAILED: %s\n", err)
			continue
		}
		fmt.Printf("    swept in %s\n", txHash)
		moved++
	}

	fmt.Printf("\n%d wallets hold funds, %s USDC micro in total, %d swept\n", held, total, moved)
	if held > moved {
		fmt.Println("\nNOT every wallet was drained. Do NOT rotate WALLET_MASTER_KEY yet:")
		fmt.Println("the remaining funds are only reachable with the old key.")
		os.Exit(1)
	}
	if !*dryRun && held > 0 {
		fmt.Println("\nEvery legacy wallet is drained. WALLET_MASTER_KEY can now be rotated,")
		fmt.Println("and users.encrypted_private_key dropped.")
	}
}

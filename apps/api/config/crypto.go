package config

import (
	"fmt"

	"github.com/spf13/viper"
)

// CryptoConfiguration holds the key material this service encrypts with.
//
// AggregatorPublicKey/AggregatorPrivateKey are the RSA keypair used to encrypt
// and decrypt the `recipient` blob that travels on-chain as `message_hash` on
// every OrderCreated event. Sender encrypts with the public key when
// constructing the create_order PTB; the indexer decrypts with the private key.
//
// WalletMasterKey is the AES-256 key that seals custodied EVM private keys at
// rest. Validation and access live in utils/crypto, which owns that key end to
// end; this struct only carries the raw configured string. It is distinct from
// SUI_AGGREGATOR_PRIVATE_KEY (the Ed25519 seed for signing Sui transactions,
// configured in OrderConfiguration).
type CryptoConfiguration struct {
	AggregatorPublicKey  string
	AggregatorPrivateKey string
	WalletMasterKey      string
}

// AnthropicAPIKey is the key for banknote recognition.
//
// Without it there is no recognition, and without recognition a cash pledge is
// a photograph nobody looked at. The cash routes are not registered at all in
// that case rather than accepting pledges unscreened.
func (c *CryptoConfiguration) AnthropicAPIKey() string {
	return viper.GetString("ANTHROPIC_API_KEY")
}

// VisionModel is which model counts the notes. Chosen by measured accuracy
// against real photographs, not by intuition.
func VisionModel() string {
	if m := viper.GetString("VISION_MODEL"); m != "" {
		return m
	}
	return "claude-haiku-4-5"
}

// CryptoConfig loads the key material from environment / viper.
func CryptoConfig() *CryptoConfiguration {
	return &CryptoConfiguration{
		AggregatorPublicKey:  viper.GetString("AGGREGATOR_PUBLIC_KEY"),
		AggregatorPrivateKey: viper.GetString("AGGREGATOR_PRIVATE_KEY"),
		WalletMasterKey:      viper.GetString("WALLET_MASTER_KEY"),
	}
}

func init() {
	if err := SetupConfig(); err != nil {
		panic(fmt.Sprintf("config SetupConfig() error: %s", err))
	}
}

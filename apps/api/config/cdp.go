package config

import "github.com/spf13/viper"

// CDPConfiguration is what the Coinbase Developer Platform integration needs.
//
// Three secrets and one URL. All three secrets must be present for the
// integration to be considered configured; a partial set is refused at boot
// rather than half-working, because the failure mode of "the API key works
// but the wallet secret is missing" is an account that can be created but
// never spent from.
type CDPConfiguration struct {
	// APIKeyID and APIKeySecret authenticate every request (Bearer JWT).
	// The secret is the base64 Ed25519 key from the CDP portal.
	APIKeyID     string
	APIKeySecret string

	// WalletSecret authenticates the operations that move or create keys
	// (X-Wallet-Auth JWT). Separate from the API key on purpose: leaking it is
	// worse than leaking the API key, and the split lets it be held more
	// tightly.
	WalletSecret string

	// PaymasterURL is what makes a Smart Account gasless. Without it a user
	// operation still works but the account must hold ETH to pay for itself,
	// which is the exact thing this integration exists to remove -- so it is
	// required, not optional.
	PaymasterURL string

	// BaseURL is the CDP API root. Defaulted to the production endpoint that
	// CDP publishes; it is a documented public address, not a secret.
	BaseURL string
}

// CDPConfig reads the CDP settings from env. There are no defaults for any
// secret.
func CDPConfig() *CDPConfiguration {
	viper.SetDefault("CDP_BASE_URL", "https://api.cdp.coinbase.com/platform")

	return &CDPConfiguration{
		APIKeyID:     viper.GetString("CDP_API_KEY_ID"),
		APIKeySecret: viper.GetString("CDP_API_KEY_SECRET"),
		WalletSecret: viper.GetString("CDP_WALLET_SECRET"),
		PaymasterURL: viper.GetString("CDP_PAYMASTER_URL"),
		BaseURL:      viper.GetString("CDP_BASE_URL"),
	}
}

// Enabled reports whether enough is set to build the integration at all.
//
// Only the credentials decide this. A missing paymaster with credentials
// present is a configuration ERROR (see cdp.New), not "not enabled": the
// operator clearly meant to turn this on and left out the part that makes it
// worth turning on.
func (c *CDPConfiguration) Enabled() bool {
	return c.APIKeyID != "" && c.APIKeySecret != "" && c.WalletSecret != ""
}

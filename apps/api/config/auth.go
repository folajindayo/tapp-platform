package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

// AuthConfiguration defines the authentication & authorization settings.
//
// Key separation: `Secret` is the application's master AES key (used by
// utils/crypto for AES-256-GCM). `JwtSigningKey` is used ONLY for JWT
// HMAC. Conflating the two means a leak of one compromises both — and
// rotating one without the other is impossible. Default `JwtSigningKey`
// falls back to `Secret` for backwards compatibility, but production
// deployments MUST set JWT_SIGNING_KEY separately.
type AuthConfiguration struct {
	Secret                    string
	JwtSigningKey             string
	JwtIssuer                 string
	JwtAudience               string
	JwtAccessLifespan         time.Duration
	JwtRefreshLifespan        time.Duration
	HmacTimestampAge          time.Duration
	PasswordResetLifespan     time.Duration
	EmailVerificationLifespan time.Duration
}

// AuthConfig sets the authentication & authorization configurations
func AuthConfig() (config *AuthConfiguration) {
	viper.SetDefault("JWT_ACCESS_LIFESPAN", 15)     // 15 minutes
	viper.SetDefault("JWT_REFRESH_LIFESPAN", 10080) // 7 days
	viper.SetDefault("JWT_ISSUER", "rails.zoracle")
	viper.SetDefault("JWT_AUDIENCE", "rails.zoracle.clients")
	viper.SetDefault("HMAC_TIMESTAMP_AGE", 5)
	viper.SetDefault("PASSWORD_RESET_LIFESPAN", 15)       // 15 minutes — short by design
	viper.SetDefault("EMAIL_VERIFICATION_LIFESPAN", 1440) // 24 hours — UX-friendly

	signingKey := viper.GetString("JWT_SIGNING_KEY")
	if signingKey == "" {
		// Backwards-compat fallback — log a warning at boot if you
		// land in production with this branch active.
		signingKey = viper.GetString("SECRET")
	}

	return &AuthConfiguration{
		Secret:                    viper.GetString("SECRET"),
		JwtSigningKey:             signingKey,
		JwtIssuer:                 viper.GetString("JWT_ISSUER"),
		JwtAudience:               viper.GetString("JWT_AUDIENCE"),
		JwtAccessLifespan:         time.Duration(viper.GetInt("JWT_ACCESS_LIFESPAN")) * time.Minute,
		JwtRefreshLifespan:        time.Duration(viper.GetInt("JWT_REFRESH_LIFESPAN")) * time.Minute,
		HmacTimestampAge:          time.Duration(viper.GetInt("HMAC_TIMESTAMP_AGE")) * time.Minute,
		PasswordResetLifespan:     time.Duration(viper.GetInt("PASSWORD_RESET_LIFESPAN")) * time.Minute,
		EmailVerificationLifespan: time.Duration(viper.GetInt("EMAIL_VERIFICATION_LIFESPAN")) * time.Minute,
	}
}

// minSecretLen is the shortest SECRET or JWT_SIGNING_KEY the service will
// boot with. 32 bytes is HS256's key size; `openssl rand -hex 32` gives 64.
const minSecretLen = 32

// RequireSecrets refuses to run with an empty or short SECRET or signing key.
//
// Called from main before anything serves a request, not from init, so tests
// and tooling that never sign a token are unaffected. Without this a
// deployment that forgot SECRET signed every session with the empty string,
// and the only symptom was that any forged token verified.
func RequireSecrets() error {
	c := AuthConfig()
	if len(c.Secret) < minSecretLen {
		return fmt.Errorf("SECRET must be set and at least %d characters (openssl rand -hex 32)", minSecretLen)
	}
	if len(c.JwtSigningKey) < minSecretLen {
		return fmt.Errorf("JWT_SIGNING_KEY must be set and at least %d characters (openssl rand -hex 32)", minSecretLen)
	}
	return nil
}

func init() {
	if err := SetupConfig(); err != nil {
		panic(fmt.Sprintf("config SetupConfig() error: %s", err))
	}
}

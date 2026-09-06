package crypto

import (
	"fmt"
	"sync"

	"github.com/usezoracle/rails-sui/config"
)

// The wallet master key is resolved once, at startup, and cached. Request
// paths must never re-read configuration: a process that has begun serving
// signups has already committed to being able to seal the keys it creates.
var (
	masterKeyOnce sync.RWMutex
	masterKey     []byte
)

// RequireMasterKey validates WALLET_MASTER_KEY and caches it.
//
// Called from the composition root, and its error is fatal by design. A
// service that cannot seal a private key must not accept a signup that
// creates one -- the alternative, which this codebase shipped, was a literal
// key in source used whenever the configured one was missing or malformed.
func RequireMasterKey() error {
	key, err := ParseMasterKey(config.CryptoConfig().WalletMasterKey)
	if err != nil {
		return fmt.Errorf("%w (generate one with `openssl rand -hex 32`)", err)
	}
	masterKeyOnce.Lock()
	masterKey = key
	masterKeyOnce.Unlock()
	return nil
}

// MasterKey returns the validated wallet master key.
//
// It returns an error rather than panicking. A panic here would take down a
// request path over a configuration fault, and callers already have somewhere
// sensible to put the failure -- a signup that cannot seal a key must fail
// that signup, not the process.
//
// If RequireMasterKey has not run, the key is resolved and validated on
// demand. That keeps tests and one-off tools working without a composition
// root, while giving them exactly the same strictness: no configured key
// still means no key.
func MasterKey() ([]byte, error) {
	masterKeyOnce.RLock()
	key := masterKey
	masterKeyOnce.RUnlock()
	if key != nil {
		return key, nil
	}
	if err := RequireMasterKey(); err != nil {
		return nil, err
	}
	masterKeyOnce.RLock()
	defer masterKeyOnce.RUnlock()
	return masterKey, nil
}

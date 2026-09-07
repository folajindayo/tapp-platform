package tap

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/card/auth"
	"github.com/usezoracle/tapp/api/internal/money"
)

// NonceTTL bounds how long a challenge stays answerable. Long enough for
// somebody to find their card and type a PIN; short enough that a response
// captured at the counter is worthless by the time it is replayed.
const NonceTTL = 2 * time.Minute

var (
	// ErrNonceInvalid covers every reason a nonce cannot be used: unknown,
	// already consumed, expired, or issued to a different merchant. They are
	// deliberately one error, because distinguishing them tells an attacker
	// which of their guesses was closer.
	ErrNonceInvalid = errors.New("challenge is invalid, already used, or expired")

	// ErrAmountChanged means the debit does not match what the nonce was
	// issued for. This is the guard against a merchant quoting a small amount
	// to get a low authentication tier and then charging a large one.
	ErrAmountChanged = errors.New("amount does not match the challenge")
)

// Challenge is what the merchant app receives before a debit.
type Challenge struct {
	ID     uuid.UUID
	Nonce  []byte
	Tier   auth.Tier
	Amount money.Amount
	// StepUpRef is the token the cardholder's own app uses to approve a
	// step-up. Empty for lower tiers.
	StepUpRef string
	ExpiresAt time.Time
}

// issued is a challenge as stored, read back at debit time.
type issued struct {
	ID          uuid.UUID
	Tier        auth.Tier
	AmountMinor int64
	Currency    money.Currency
	StepUpAt    *time.Time
}

// consumeNonce claims a challenge exactly once.
//
// The UPDATE ... WHERE consumed_at IS NULL RETURNING is the whole mechanism: a
// nonce is claimed by the statement that sets consumed_at, and a second
// attempt matches no rows. Two requests presenting the same captured PIN
// response therefore cannot both proceed, whatever their timing, because the
// database decides which one wins rather than the application.
//
// It is also bound to the merchant. A nonce issued to one merchant cannot be
// spent at another, so a response captured at a compromised terminal cannot be
// carried elsewhere.
func consumeNonce(ctx context.Context, tx pgx.Tx, nonce []byte, merchantID uuid.UUID) (*issued, error) {
	var (
		i          issued
		amountText string
		currency   string
	)
	err := tx.QueryRow(ctx, `
		UPDATE card_server_nonces
		   SET consumed_at = now()
		 WHERE nonce = $1
		   AND sender_profile_card_server_nonces = $2
		   AND consumed_at IS NULL
		   AND expires_at > now()
		RETURNING id, tier, amount, currency, step_up_granted_at`,
		nonce, merchantID).
		Scan(&i.ID, &i.Tier, &amountText, &currency, &i.StepUpAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNonceInvalid
	}
	if err != nil {
		return nil, fmt.Errorf("tap: consume challenge: %w", err)
	}

	i.Currency = money.Currency(currency)
	minor, err := parseMinor(amountText, i.Currency)
	if err != nil {
		return nil, err
	}
	i.AmountMinor = minor
	return &i, nil
}

// matches checks the debit against what the challenge was issued for.
func (i *issued) matches(amount money.Amount) error {
	if amount.Currency() != i.Currency {
		return fmt.Errorf("%w: challenged in %s, charged in %s",
			ErrAmountChanged, i.Currency, amount.Currency())
	}
	if amount.Minor() != i.AmountMinor {
		return fmt.Errorf("%w: challenged for %s, charged %s",
			ErrAmountChanged, money.New(i.AmountMinor, i.Currency), amount)
	}
	return nil
}

// ParseAmount reads a decimal amount into minor units, exactly.
//
// Exported because the HTTP layer needs the same parse the nonce table does --
// two different readings of "1500.00" would be a way to make a debit disagree
// with the challenge that authorised it.
func ParseAmount(s string, c money.Currency) (int64, error) { return parseMinor(s, c) }

// parseMinor reads the stored decimal amount into minor units.
//
// The column is text holding a decimal, which is not how money should be
// stored -- it is the predecessor's shape and changing it is a migration of
// live rows. Parsing is exact: the string is split on the point and the
// fractional part is padded or rejected, so nothing here rounds.
func parseMinor(s string, c money.Currency) (int64, error) {
	var whole, frac int64
	var fracDigits int
	neg := false

	i := 0
	if i < len(s) && (s[i] == '-' || s[i] == '+') {
		neg = s[i] == '-'
		i++
	}
	seenDigit := false
	for ; i < len(s) && s[i] != '.'; i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, fmt.Errorf("tap: %q is not a decimal amount", s)
		}
		whole = whole*10 + int64(s[i]-'0')
		seenDigit = true
	}
	if i < len(s) && s[i] == '.' {
		for i++; i < len(s); i++ {
			if s[i] < '0' || s[i] > '9' {
				return 0, fmt.Errorf("tap: %q is not a decimal amount", s)
			}
			frac = frac*10 + int64(s[i]-'0')
			fracDigits++
			seenDigit = true
		}
	}
	if !seenDigit {
		return 0, fmt.Errorf("tap: %q is not a decimal amount", s)
	}

	exp := c.Exponent()
	if fracDigits > exp {
		// More precision than the currency has. Truncating would silently
		// change the amount somebody agreed to.
		return 0, fmt.Errorf("tap: %q has more decimal places than %s allows", s, c)
	}
	for ; fracDigits < exp; fracDigits++ {
		frac *= 10
	}

	minor := whole*c.Scale() + frac
	if neg {
		minor = -minor
	}
	return minor, nil
}

// newNonce returns a fresh challenge value.
func newNonce() ([]byte, error) {
	b := make([]byte, auth.NonceLen)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

package offramp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/money"
)

// MaxAttempts bounds how often one tap's order is retried.
//
// A tap that cannot be sold after this many tries is not going to start
// working on the next tick, and retrying it forever buries the taps behind it
// under log noise. It is left failed and visible rather than retried in
// silence.
const MaxAttempts = 5

// Execer is the part of a transaction Record needs, so the tap can pass its
// own and the write commits with the charge.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Settler turns taps into settlement orders.
//
// Separate from the tap itself on purpose. Creating an order is an on-chain
// operation, and the cardholder is standing at a till: making the tap wait for
// a chain confirmation would put a provider's latency between somebody and
// their coffee. The tap authorises against the ledger and finishes; this
// follows moments later.
type Settler struct {
	Pool   *pgxpool.Pool
	Orders *Client
	Now    func() time.Time
}

func (s *Settler) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Record notes that a tap needs settling.
//
// Written by the tap, in the tap's own transaction, so a charge cannot exist
// without a record that it has to be settled. The primary key on tap_id is
// what makes one payment open one order and no more.
func (s *Settler) Record(
	ctx context.Context, q Execer, tapID uuid.UUID, from string, sellMicro int64,
) error {
	_, err := q.Exec(ctx, `
		INSERT INTO card_tap_settlements (tap_id, from_address, sell_micro)
		VALUES ($1, $2, $3)
		ON CONFLICT (tap_id) DO NOTHING`, tapID, from, sellMicro)
	if err != nil {
		return fmt.Errorf("offramp: record tap settlement: %w", err)
	}
	return nil
}

// Tick creates orders for taps that have none yet.
func (s *Settler) Tick(ctx context.Context) (created int, err error) {
	if s.Orders == nil {
		return 0, ErrNotConfigured
	}

	// Everything one order needs, in one read: what to sell, from where, and
	// the bank the merchant verified.
	//
	// The bank must be VERIFIED -- account_name is what the bank returned for
	// the number, not what somebody typed, and a provider pays against that
	// blob without a second check. A merchant who has not verified one leaves
	// their taps outstanding rather than sending money to a mistyped digit.
	rows, err := s.Pool.Query(ctx, `
		SELECT st.tap_id, st.from_address, st.sell_micro, st.attempts,
		       t.currency, t.amount_minor,
		       b.bank_code, b.account_number, b.account_name
		  FROM card_tap_settlements st
		  JOIN card_taps t ON t.id = st.tap_id
		  JOIN merchant_bank_accounts b
		    ON b.sender_profile_merchant_bank_account = t.merchant_id
		   AND b.currency = t.currency::text
		   AND b.verified_at IS NOT NULL
		 WHERE st.state = 'pending'
		   AND st.attempts < $1
		 ORDER BY st.created_at
		 LIMIT 20`, MaxAttempts)
	if err != nil {
		return 0, fmt.Errorf("offramp: find taps to settle: %w", err)
	}

	type pending struct {
		tap      uuid.UUID
		from     string
		sell     int64
		attempts int
		deliver  money.Amount
		bank     Bank
	}
	var due []pending
	for rows.Next() {
		var (
			p     pending
			cur   string
			minor int64
		)
		if err := rows.Scan(&p.tap, &p.from, &p.sell, &p.attempts,
			&cur, &minor, &p.bank.Institution, &p.bank.AccountNumber, &p.bank.AccountName); err != nil {
			rows.Close()
			return 0, err
		}
		p.deliver = money.New(minor, money.Currency(cur))
		due = append(due, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, p := range due {
		// The attempt is counted BEFORE the call, not after.
		//
		// createOrder can be accepted by the chain and still fail to answer
		// us. Counting afterwards would leave a submitted order looking
		// untried, and the next tick would sell the cardholder's money a
		// second time. The idempotency key on the tap is the other half of
		// that guarantee; this is the half that survives a crash.
		if _, err := s.Pool.Exec(ctx, `
			UPDATE card_tap_settlements
			   SET attempts = attempts + 1, updated_at = now()
			 WHERE tap_id = $1`, p.tap); err != nil {
			return created, err
		}

		txHash, err := s.Orders.Create(ctx, Order{
			From:      p.from,
			Sell:      big.NewInt(p.sell),
			Deliver:   p.deliver,
			Bank:      p.bank,
			Reference: p.tap.String(),
		})
		if err != nil {
			final := p.attempts+1 >= MaxAttempts
			state := "pending"
			if final {
				state = "failed"
			}
			if _, e := s.Pool.Exec(ctx, `
				UPDATE card_tap_settlements
				   SET state = $2, last_error = $3, updated_at = now()
				 WHERE tap_id = $1`, p.tap, state, err.Error()); e != nil {
				return created, e
			}
			if final {
				slog.Error("offramp: giving up on a tap settlement",
					"tap", p.tap, "attempts", p.attempts+1, "err", err)
			} else {
				slog.Warn("offramp: tap settlement failed, will retry",
					"tap", p.tap, "attempt", p.attempts+1, "err", err)
			}
			continue
		}

		if _, err := s.Pool.Exec(ctx, `
			UPDATE card_tap_settlements
			   SET state = 'submitted', tx_hash = $2, last_error = NULL, updated_at = now()
			 WHERE tap_id = $1`, p.tap, txHash); err != nil {
			// The order is on chain. Failing here loses only our note of it,
			// and the attempt counter above stops it being sold again.
			return created, fmt.Errorf("offramp: record submitted order for tap %s (tx %s): %w",
				p.tap, txHash, err)
		}
		created++
	}
	return created, nil
}

// Run settles until the context ends.
func (s *Settler) Run(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			created, err := s.Tick(ctx)
			if err != nil {
				// Not configured is a deployment without a gateway, which is
				// said once at boot; repeating it every tick adds nothing.
				if !errors.Is(err, ErrNotConfigured) {
					slog.Error("offramp: settle failed", "err", err)
				}
				continue
			}
			if created > 0 {
				slog.Info("offramp: settlement orders created", "count", created)
			}
		}
	}
}

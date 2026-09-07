package cash

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/agents"
	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
)

var (
	// ErrPledgeUnknown means no such pledge, or not this trader's.
	ErrPledgeUnknown = errors.New("cash: no such pledge")
	// ErrWrongState means the pledge is not at a point where this makes sense.
	ErrWrongState = errors.New("cash: this pledge cannot do that now")
	// ErrWrongCode means the code spoken at the counter does not match.
	ErrWrongCode = errors.New("cash: that code is not right")
)

// AgentFinder locates agents who can take a handover.
type AgentFinder interface {
	Nearby(ctx context.Context, q agents.Search) ([]agents.Agent, error)
}

// Match offers a pledge to the nearest agent who can cover it.
//
// The agent's float is LOCKED at this point, not at settlement. That is what
// makes the offer real: an agent who is told somebody is walking over with
// ₦50,000 has committed to having ₦50,000, and a trader who walks there should
// not arrive to find it spent. The lock is released if nobody comes.
func (s *Service) Match(ctx context.Context, finder AgentFinder, pledgeID, traderID uuid.UUID) (*Handover, error) {
	p, err := s.load(ctx, s.Pool, pledgeID, traderID)
	if err != nil {
		return nil, err
	}
	if p.State != StateOpen {
		return nil, fmt.Errorf("%w: it is %s", ErrWrongState, p.State)
	}

	now := s.now()
	nearby, err := finder.Nearby(ctx, agents.Search{
		Lat: p.Lat, Lng: p.Lng, Amount: p.Declared, OpenAt: now, Limit: 5,
	})
	if err != nil {
		return nil, err
	}
	if len(nearby) == 0 {
		return nil, ErrNoAgent
	}

	code, err := handoverCode()
	if err != nil {
		return nil, err
	}

	// Try each candidate in turn. The nearest may lose a race for their own
	// float to another trader between the search and the lock, and that is
	// ordinary rather than exceptional -- so it moves to the next one instead
	// of failing the whole request.
	for _, candidate := range nearby {
		h := &Handover{
			ID: uuid.New(), PledgeID: p.ID, AgentID: candidate.ID,
			Amount: p.Declared, Code: code, DistanceM: candidate.DistanceM,
			State: HandoverProposed, ExpiresAt: now.Add(HandoverTTL),
		}

		err := movements.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
			lockTx, err := movements.LockAgentFloat(ctx, tx, candidate.ID, p.Declared, h.ID.String())
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO cash_handovers
					(id, pledge_id, agent_id, currency, amount_minor, code, distance_m,
					 state, lock_tx_id, expires_at)
				VALUES ($1, $2, $3, $4::currency, $5, $6, $7, 'proposed', $8, $9)`,
				h.ID, h.PledgeID, h.AgentID, string(h.Amount.Currency()),
				h.Amount.Minor(), h.Code, h.DistanceM, lockTx, h.ExpiresAt); err != nil {
				return fmt.Errorf("cash: propose handover: %w", err)
			}
			_, err = tx.Exec(ctx,
				`UPDATE cash_pledges SET state = 'matched', updated_at = now()
				  WHERE id = $1 AND state = 'open'`, p.ID)
			return err
		})
		if err == nil {
			return h, nil
		}
		if !errors.Is(err, movements.ErrInsufficientFunds) {
			return nil, err
		}
	}
	return nil, ErrNoAgent
}

// ConfirmByTrader records that the trader says they handed the notes over.
func (s *Service) ConfirmByTrader(ctx context.Context, handoverID, traderID uuid.UUID) (*Handover, error) {
	return s.confirm(ctx, handoverID, traderID, "", true)
}

// ConfirmByAgent records that the agent says they received them, checking the
// code the trader read out.
func (s *Service) ConfirmByAgent(ctx context.Context, handoverID, agentID uuid.UUID, code string) (*Handover, error) {
	return s.confirm(ctx, handoverID, agentID, code, false)
}

// confirm advances one side, and settles when both have.
//
// Both sides must confirm independently. One-sided confirmation in either
// direction is an obvious attack: a trader who could settle alone would be
// paid for notes they kept, and an agent who could settle alone could claim
// notes that were never brought. Requiring both means the money moves only
// when two people who met each other agree that they did.
func (s *Service) confirm(
	ctx context.Context, handoverID, actorID uuid.UUID, code string, isTrader bool,
) (*Handover, error) {
	var out *Handover

	err := movements.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		h, traderID, err := s.loadHandover(ctx, tx, handoverID)
		if err != nil {
			return err
		}
		if s.now().After(h.ExpiresAt) {
			return fmt.Errorf("%w: this handover has expired", ErrWrongState)
		}

		switch {
		case isTrader && actorID != traderID:
			return ErrPledgeUnknown
		case !isTrader && actorID != h.AgentID:
			return ErrPledgeUnknown
		}

		// The code is checked on the agent's side, because the agent is the
		// one being told it by somebody standing in front of them. It bounds
		// who can confirm a given meeting; it does not authenticate anybody,
		// and the two-sided requirement is what actually does.
		if !isTrader && h.Code != code {
			return ErrWrongCode
		}

		next, settle := advance(h.State, isTrader)
		if next == h.State {
			return fmt.Errorf("%w: already confirmed", ErrWrongState)
		}

		column := "agent_confirmed_at"
		if isTrader {
			column = "trader_confirmed_at"
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`
			UPDATE cash_handovers SET state = $2::handover_state, %s = now() WHERE id = $1`, column),
			h.ID, string(next)); err != nil {
			return fmt.Errorf("cash: confirm handover: %w", err)
		}

		if !settle {
			if _, err := tx.Exec(ctx, `
				UPDATE cash_pledges SET state = 'handed_over', updated_at = now() WHERE id = $1`,
				h.PledgeID); err != nil {
				return err
			}
			h.State = next
			out = h
			return nil
		}

		if err := s.settle(ctx, tx, h, traderID); err != nil {
			return err
		}
		h.State = HandoverCompleted
		out = h
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// advance moves the state machine one step and says whether that completes it.
func advance(current HandoverState, isTrader bool) (HandoverState, bool) {
	switch current {
	case HandoverProposed:
		if isTrader {
			return HandoverTraderConfirmed, false
		}
		return HandoverAgentConfirmed, false
	case HandoverTraderConfirmed:
		if isTrader {
			return current, false // already done their part
		}
		return HandoverCompleted, true
	case HandoverAgentConfirmed:
		if isTrader {
			return HandoverCompleted, true
		}
		return current, false
	default:
		return current, false
	}
}

// settle pays the trader from the agent's locked float and closes the pledge.
func (s *Service) settle(ctx context.Context, tx pgx.Tx, h *Handover, traderID uuid.UUID) error {
	settleTx, err := movements.SettleHandover(ctx, tx, h.AgentID, traderID, h.Amount, h.ID.String())
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE cash_handovers SET state = 'completed', settle_tx_id = $2 WHERE id = $1`,
		h.ID, settleTx); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE cash_pledges SET state = 'settled', settled_at = now(), updated_at = now()
		 WHERE id = $1`, h.PledgeID); err != nil {
		return err
	}

	// The agent has the notes now and may bank them, so the note identities
	// are freed. Keeping them claimed would mean every settled pledge
	// permanently burned that cash.
	return release(ctx, tx, h.PledgeID)
}

// handoverCode is six digits, generated with a cryptographic source.
//
// Six is a compromise: long enough that guessing inside a thirty-minute window
// is not worth trying, short enough to read off a screen and say once across a
// counter in a noisy market.
func handoverCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func (s *Service) load(ctx context.Context, q ledger.Querier, id, traderID uuid.UUID) (*Pledge, error) {
	var (
		p                 Pledge
		currency          string
		declared, counted int64
	)
	err := q.QueryRow(ctx, `
		SELECT id, ref, trader_id, currency, declared_minor, COALESCE(counted_minor, 0),
		       state, lat, lng, created_at, expires_at
		  FROM cash_pledges WHERE id = $1 AND trader_id = $2`, id, traderID).
		Scan(&p.ID, &p.Ref, &p.TraderID, &currency, &declared, &counted,
			&p.State, &p.Lat, &p.Lng, &p.CreatedAt, &p.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPledgeUnknown
	}
	if err != nil {
		return nil, fmt.Errorf("cash: load pledge: %w", err)
	}
	p.Declared = money.New(declared, money.Currency(currency))
	p.Counted = money.New(counted, money.Currency(currency))
	return &p, nil
}

func (s *Service) loadHandover(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Handover, uuid.UUID, error) {
	var (
		h        Handover
		traderID uuid.UUID
		currency string
		amount   int64
	)
	err := tx.QueryRow(ctx, `
		SELECT h.id, h.pledge_id, h.agent_id, h.currency, h.amount_minor, h.code,
		       h.distance_m, h.state, h.expires_at, p.trader_id
		  FROM cash_handovers h JOIN cash_pledges p ON p.id = h.pledge_id
		 WHERE h.id = $1
		   FOR UPDATE OF h`, id).
		Scan(&h.ID, &h.PledgeID, &h.AgentID, &currency, &amount, &h.Code,
			&h.DistanceM, &h.State, &h.ExpiresAt, &traderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, uuid.Nil, ErrPledgeUnknown
	}
	if err != nil {
		return nil, uuid.Nil, fmt.Errorf("cash: load handover: %w", err)
	}
	h.Amount = money.New(amount, money.Currency(currency))
	return &h, traderID, nil
}

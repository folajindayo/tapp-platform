package v1

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/chain/base"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// WithdrawHandler moves USDC out to an address the holder names.
type WithdrawHandler struct {
	Svc  *base.Withdrawals
	User func(*gin.Context) (uuid.UUID, bool)
}

type withdrawRequest struct {
	// Amount is a decimal string in USD. The dollars are debited from the
	// ledger and the same value leaves as USDC.
	Amount string `json:"amount" binding:"required"`
	To     string `json:"to"     binding:"required"`
}

type withdrawalView struct {
	ID     string       `json:"id"`
	Amount money.Amount `json:"amount"`
	To     string       `json:"to"`
	State  string       `json:"state"`
	// TxHash is set once the send has been submitted. Absent is not a failure:
	// a withdrawal is debited and queued first, and sent by a worker.
	TxHash    string `json:"txHash,omitempty"`
	LastError string `json:"lastError,omitempty"`
	CreatedAt string `json:"createdAt"`
	SentAt    string `json:"sentAt,omitempty"`
}

// Open debits the holder and queues the send.
//
// Two steps, and in this order: a debit with no send is money we still hold
// and can return; a send with no debit is money gone that nobody paid for.
// The response therefore describes something queued, not something sent, and
// says so -- a screen that claims a transfer has happened before it has is how
// somebody comes to believe funds are somewhere they are not.
func (h *WithdrawHandler) Open(ctx *gin.Context) {
	var req withdrawRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}
	user, ok := h.User(ctx)
	if !ok {
		return
	}

	minor, err := parseDecimalAmount(req.Amount, money.USD)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	id, err := h.Svc.Open(ctx.Request.Context(), base.Request{
		UserID: user, Amount: money.New(minor, money.USD), To: req.To,
	})
	if err != nil {
		writeWithdrawError(ctx, err)
		return
	}

	view, err := readWithdrawal(ctx.Request.Context(), id, user)
	if err != nil {
		// The withdrawal is real and committed; only reading it back failed.
		// Answering an error here would invite a retry that withdraws twice.
		logger.Errorf("withdrawals: read back %s: %v", id, err)
		u.APIResponse(ctx, http.StatusAccepted, "success",
			"Queued. It will be sent shortly.", gin.H{"id": id.String()})
		return
	}
	u.APIResponse(ctx, http.StatusAccepted, "success",
		"Queued. It will be sent shortly.", view)
}

// Get reports one withdrawal's progress.
func (h *WithdrawHandler) Get(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid id", nil)
		return
	}
	user, ok := h.User(ctx)
	if !ok {
		return
	}

	view, err := readWithdrawal(ctx.Request.Context(), id, user)
	if err != nil {
		if errors.Is(err, errNoWithdrawal) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "No such withdrawal",
				map[string]any{"code": "not_found"})
			return
		}
		logger.Errorf("withdrawals: read %s: %v", id, err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Could not read that withdrawal", nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Withdrawal", view)
}

var errNoWithdrawal = errors.New("withdrawals: not found")

// readWithdrawal is scoped by user_id in the query rather than checked after
// loading: a query that cannot return somebody else's row cannot leak one.
func readWithdrawal(ctx context.Context, id, user uuid.UUID) (*withdrawalView, error) {
	var (
		v         withdrawalView
		micro     int64
		txHash    *string
		lastError *string
		sentAt    *string
	)
	err := storage.Pool.QueryRow(ctx, `
		SELECT id, amount_micro, to_address, state, tx_hash, last_error,
		       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(sent_at    AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		  FROM base_withdrawals WHERE id = $1 AND user_id = $2`, id, user).
		Scan(&v.ID, &micro, &v.To, &v.State, &txHash, &lastError, &v.CreatedAt, &sentAt)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, errNoWithdrawal
		}
		return nil, err
	}

	// base_withdrawals stores USDC micro-units (six decimal places); the
	// ledger holds USD cents. Converting here rather than storing both keeps
	// one of them authoritative.
	v.Amount = money.New(micro/10_000, money.USD)
	if txHash != nil {
		v.TxHash = *txHash
	}
	if lastError != nil {
		v.LastError = *lastError
	}
	if sentAt != nil {
		v.SentAt = *sentAt
	}
	return &v, nil
}

func writeWithdrawError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, base.ErrBadAddress):
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"That is not a valid Base address.",
			map[string]any{"code": "bad_address"})
	case errors.Is(err, base.ErrCannotSend):
		// Not a fault of the request. Saying so plainly beats a 500 that
		// invites somebody to keep retrying a thing that cannot work.
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error",
			"Withdrawals are temporarily unavailable.",
			map[string]any{"code": "withdrawals_unavailable"})
	case errors.Is(err, movements.ErrInsufficientFunds):
		u.APIResponse(ctx, http.StatusPaymentRequired, "error",
			"There is not enough in your dollar balance.",
			map[string]any{"code": "insufficient_funds"})
	default:
		logger.Errorf("withdrawals: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Something went wrong. Nothing has left your balance.", nil)
	}
}

package v1

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// BalanceHandler answers what somebody holds.
type BalanceHandler struct {
	User func(*gin.Context) (uuid.UUID, bool)
}

// currencyBalance is one currency's position, split by what it can be used for.
type currencyBalance struct {
	Currency money.Currency `json:"currency"`

	// Available is spendable now. Escrow is committed to a handover that has
	// not completed. They are reported separately because collapsing them into
	// one figure is how a user comes to believe money is theirs to spend when
	// somebody else is already relying on it.
	Available money.Amount `json:"available"`
	Escrow    money.Amount `json:"escrow"`
}

type balancesResponse struct {
	Balances []currencyBalance `json:"balances"`
}

// Balances returns every currency the caller holds.
//
// Every supported currency is returned, including the ones at zero. A client
// that only ever hears about currencies with a non-zero balance has no way to
// show somebody that USD exists and they could hold some -- and a balance
// appearing out of nowhere on first deposit reads as a bug.
func (h *BalanceHandler) Balances(ctx *gin.Context) {
	user, ok := h.User(ctx)
	if !ok {
		return
	}

	out := make([]currencyBalance, 0, len(money.SupportedCurrencies()))
	for _, c := range money.SupportedCurrencies() {
		row, err := readBalance(ctx.Request.Context(), user, c)
		if err != nil {
			// One unreadable currency makes the whole answer wrong, and a
			// partial list of balances is worse than no list: it is
			// indistinguishable from a real balance of zero.
			logger.Errorf("balances: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error",
				"We could not read your balances just now.", nil)
			return
		}
		out = append(out, row)
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Balances retrieved",
		balancesResponse{Balances: out})
}

func readBalance(ctx context.Context, user uuid.UUID, c money.Currency) (currencyBalance, error) {
	owner := ledger.User(user)

	available, err := ledger.Balance(ctx, storage.Pool, owner, ledger.KindAvailable, c)
	if err != nil {
		return currencyBalance{}, err
	}
	escrow, err := ledger.Balance(ctx, storage.Pool, owner, ledger.KindEscrow, c)
	if err != nil {
		return currencyBalance{}, err
	}
	return currencyBalance{Currency: c, Available: available, Escrow: escrow}, nil
}

// activityQuery is the paging contract for the movement feed.
type activityQuery struct {
	Limit  int    `form:"limit"`
	Cursor string `form:"cursor"`
}

// Activity returns the caller's movements, newest first.
//
// Derived from the ledger entries themselves, so the feed and the balance
// above it are the same rows read two ways and cannot disagree. Its
// predecessor read the user's on-chain transaction list from an RPC provider,
// which described what happened on a chain rather than what happened to their
// money.
func (h *BalanceHandler) Activity(ctx *gin.Context) {
	user, ok := h.User(ctx)
	if !ok {
		return
	}

	var q activityQuery
	if err := ctx.ShouldBindQuery(&q); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}

	page, err := ledger.History(ctx.Request.Context(), storage.Pool,
		ledger.User(user), q.Limit, q.Cursor)
	if err != nil {
		var bad ledger.ErrBadCursor
		if errors.As(err, &bad) {
			u.APIResponse(ctx, http.StatusBadRequest, "error",
				"That page reference is not one we issued.",
				map[string]any{"code": "bad_cursor"})
			return
		}
		logger.Errorf("activity: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"We could not read your activity just now.", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Activity retrieved", page)
}

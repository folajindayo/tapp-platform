// Package v1 holds the HTTP handlers for the consolidated API.
//
// Handlers parse a request, call one service, and map the result onto a
// response. They do not touch money: a movement goes through
// internal/ledger/movements, which is the only place the vocabulary of
// movements is defined and reviewed.
package v1

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// LedgerAudit reports whether the books balance, per currency.
//
// Operator-gated, because it discloses the platform's whole position -- what
// it holds, what it owes merchants, what its FX exposure is. Balanced-ness
// alone would be safe to publish, but the holdings are not.
//
// This endpoint is meant to be watched. The invariant it checks is enforced by
// a database trigger, so it can only ever fail if something wrote around the
// ledger: a hand-edited row, a restored backup, a migration that moved
// entries. Those are the failures that otherwise stay invisible until
// somebody reconciles by hand.
func LedgerAudit(ctx *gin.Context) {
	audit, err := ledger.Auditor(ctx.Request.Context(), storage.Pool)
	if err != nil {
		logger.Errorf("LedgerAudit: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to read the ledger", nil)
		return
	}

	// An unbalanced ledger is not a successful read of a healthy system, and
	// the status code should not say it is. A monitor watching for non-2xx
	// catches this without having to parse the body.
	if !audit.Balanced {
		logger.Errorf("LedgerAudit: THE LEDGER DOES NOT BALANCE: %+v", audit.Currencies)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"The ledger does not balance", audit)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Ledger balanced", audit)
}

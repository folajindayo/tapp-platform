// Reconciling fiat payouts against the bank.

package tasks

import (
	"context"
	"fmt"

	orderpkg "github.com/usezoracle/tapp/api/services/order"

	"github.com/usezoracle/tapp/api/ent/lockpaymentorder"
	"github.com/usezoracle/tapp/api/services/baas"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// ReconcileFiatPayouts polls the BaaS rail for the outcome of in-flight Route B
// payouts (fiat_payout_status=pending with a session id) and converges each lock
// order to a terminal status. It is the backstop to the inbound webhook: if a
// callback is missed, this closes the loop. No-op when the rail is unconfigured.
func ReconcileFiatPayouts() error {
	provider := baas.Default()
	if provider == nil {
		return nil
	}
	ctx := context.Background()

	orders, err := storage.Client.LockPaymentOrder.
		Query().
		Where(
			lockpaymentorder.FiatPayoutStatusEQ(lockpaymentorder.FiatPayoutStatusPending),
			lockpaymentorder.FiatPayoutSessionIDNEQ(""),
		).
		All(ctx)
	if err != nil {
		return fmt.Errorf("ReconcileFiatPayouts: query: %w", err)
	}

	for _, o := range orders {
		tr, err := provider.TransferStatus(ctx, o.FiatPayoutSessionID)
		if err != nil {
			logger.Warnf("ReconcileFiatPayouts %s: status: %v", o.ID, err)
			continue
		}
		switch tr.Status {
		case baas.TransferSuccess:
			if err := storage.Client.LockPaymentOrder.UpdateOneID(o.ID).
				SetFiatPayoutStatus(lockpaymentorder.FiatPayoutStatusSuccess).
				ClearFiatPayoutSessionID().
				ClearFiatPayoutError().
				Exec(ctx); err != nil {
				logger.Errorf("ReconcileFiatPayouts %s: persist success: %v", o.ID, err)
				continue
			}
			orderpkg.PublishOrderByID(orderpkg.EventOrderPayout, o.ID)
			// Fiat confirmed → release the LP's USDC (fulfil + settle).
			if err := orderpkg.NewExecuteOrderService().SettleAfterPayout(ctx, o.ID); err != nil {
				logger.Errorf("ReconcileFiatPayouts %s: settle: %v", o.ID, err)
			}
		case baas.TransferFailed:
			if err := storage.Client.LockPaymentOrder.UpdateOneID(o.ID).
				SetFiatPayoutStatus(lockpaymentorder.FiatPayoutStatusFailed).
				SetFiatPayoutError("rail reported: " + tr.RawStatus).
				ClearFiatPayoutSessionID().
				Exec(ctx); err != nil {
				logger.Errorf("ReconcileFiatPayouts %s: persist failed: %v", o.ID, err)
			}
			orderpkg.PublishOrderByID(orderpkg.EventOrderPayout, o.ID)
		default:
			// still pending — keep polling next tick
		}
	}
	return nil
}

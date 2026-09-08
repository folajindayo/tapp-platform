// Reassigning orders that nobody picked up, and orders whose provider went
// quiet after picking them up. Both put the order back on the queue rather
// than leaving it to age out.

package tasks

import (
	"context"
	"fmt"
	"time"

	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/lockorderfulfillment"
	"github.com/usezoracle/tapp/api/ent/lockpaymentorder"
	"github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// ReassignPendingOrders reassigns declined order requests to providers
func ReassignPendingOrders() {
	ctx := context.Background()

	// Remove provider id from pending lock orders
	_, err := storage.Client.LockPaymentOrder.
		Update().
		Where(
			lockpaymentorder.StatusEQ(lockpaymentorder.StatusPending),
			lockpaymentorder.Not(lockpaymentorder.HasFulfillments()),
		).
		ClearProvider().
		Save(ctx)
	if err != nil {
		logger.Errorf("ReassignPendingOrders.db: %v", err)
		return
	}

	// Query pending lock orders
	lockOrders, err := storage.Client.LockPaymentOrder.
		Query().
		Where(
			lockpaymentorder.StatusEQ(lockpaymentorder.StatusPending),
			lockpaymentorder.Not(lockpaymentorder.HasFulfillments()),
		).
		WithToken().
		WithProvider().
		WithProvisionBucket(
			func(pbq *ent.ProvisionBucketQuery) {
				pbq.WithCurrency()
			},
		).
		All(ctx)
	if err != nil {
		logger.Errorf("ReassignPendingOrders.db: %v", err)
		return
	}

	// Check if order_request_<order_id> exists in Redis
	for _, order := range lockOrders {
		orderKey := fmt.Sprintf("order_request_%s", order.ID)
		exists, err := storage.RedisClient.Exists(ctx, orderKey).Result()
		if err != nil {
			logger.Errorf("ReassignPendingOrders.redis: %v", err)
			continue
		}

		if exists == 0 {
			// Order request doesn't exist in Redis, reassign the order
			lockPaymentOrder := types.LockPaymentOrderFields{
				ID:                order.ID,
				Token:             order.Edges.Token,
				GatewayID:         order.GatewayID,
				Amount:            order.Amount,
				Rate:              order.Rate,
				BlockNumber:       order.BlockNumber,
				Institution:       order.Institution,
				AccountIdentifier: order.AccountIdentifier,
				AccountName:       order.AccountName,
				Memo:              order.Memo,
				ProvisionBucket:   order.Edges.ProvisionBucket,
			}

			if order.Edges.Provider != nil {
				lockPaymentOrder.ProviderID = order.Edges.Provider.ID
			}

			err := services.NewPriorityQueueService().AssignLockPaymentOrder(ctx, lockPaymentOrder)
			if err != nil {
				logger.Errorf("failed to reassign declined order request: %v", err)
			}
		}
	}
}

// ReassignUnfulfilledLockOrders reassigns lockOrder unfulfilled within a time frame.
func ReassignUnfulfilledLockOrders() {
	ctx := context.Background()

	// Unassign unfulfilled lock orders. Never touch an order whose platform
	// payout is in-flight or already paid (pending/success) — that order is
	// owned by the execute/settle flow and reassigning it could double-pay.
	// Node-operated orders keep fiat_payout_status=none, so they're unaffected.
	_, err := storage.Client.LockPaymentOrder.
		Update().
		Where(
			lockpaymentorder.FiatPayoutStatusNotIn(lockpaymentorder.FiatPayoutStatusPending, lockpaymentorder.FiatPayoutStatusSuccess),
			lockpaymentorder.Or(
				lockpaymentorder.And(
					lockpaymentorder.StatusEQ(lockpaymentorder.StatusProcessing),
					lockpaymentorder.UpdatedAtLTE(time.Now().Add(-orderConf.OrderFulfillmentValidity*time.Minute)),
				),
				lockpaymentorder.StatusEQ(lockpaymentorder.StatusCancelled),
			),
			lockpaymentorder.Or(
				lockpaymentorder.Not(lockpaymentorder.HasFulfillments()),
				lockpaymentorder.HasFulfillmentsWith(
					lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusFailed),
					lockorderfulfillment.Not(lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusSuccess)),
					lockorderfulfillment.Not(lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusPending)),
				),
			),
		).
		SetStatus(lockpaymentorder.StatusPending).
		ClearProvider().
		Save(ctx)
	if err != nil {
		logger.Errorf("ReassignUnfulfilledLockOrders: %v", err)
		return
	}

	// Query unfulfilled lock orders.
	lockOrders, err := storage.Client.LockPaymentOrder.
		Query().
		Where(
			lockpaymentorder.FiatPayoutStatusNotIn(lockpaymentorder.FiatPayoutStatusPending, lockpaymentorder.FiatPayoutStatusSuccess),
			lockpaymentorder.Or(
				lockpaymentorder.Not(lockpaymentorder.HasFulfillments()),
				lockpaymentorder.HasFulfillmentsWith(
					lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusFailed),
					lockorderfulfillment.Not(lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusSuccess)),
					lockorderfulfillment.Not(lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusPending)),
				),
			),
			lockpaymentorder.Or(
				lockpaymentorder.StatusEQ(lockpaymentorder.StatusProcessing),
				lockpaymentorder.StatusEQ(lockpaymentorder.StatusCancelled),
			),
			lockpaymentorder.Or(
				lockpaymentorder.Or(
					lockpaymentorder.And(
						lockpaymentorder.StatusEQ(lockpaymentorder.StatusProcessing),
						lockpaymentorder.UpdatedAtLTE(time.Now().Add(-orderConf.OrderFulfillmentValidity*time.Minute)),
					),
					lockpaymentorder.StatusEQ(lockpaymentorder.StatusCancelled),
				),
				lockpaymentorder.HasFulfillmentsWith(
					lockorderfulfillment.CreatedAtLTE(time.Now().Add(-orderConf.OrderFulfillmentValidity*time.Minute)),
				),
			),
		).
		WithToken().
		WithProvider().
		WithProvisionBucket(func(pbq *ent.ProvisionBucketQuery) {
			pbq.WithCurrency()
		}).
		All(ctx)
	if err != nil {
		logger.Errorf("ReassignUnfulfilledLockOrders: %v", err)
		return
	}

	for _, order := range lockOrders {
		lockPaymentOrder := types.LockPaymentOrderFields{
			ID:                order.ID,
			Token:             order.Edges.Token,
			GatewayID:         order.GatewayID,
			Amount:            order.Amount,
			Rate:              order.Rate,
			BlockNumber:       order.BlockNumber,
			Institution:       order.Institution,
			AccountIdentifier: order.AccountIdentifier,
			AccountName:       order.AccountName,
			Memo:              order.Memo,
			ProvisionBucket:   order.Edges.ProvisionBucket,
		}

		if order.Edges.Provider != nil {
			lockPaymentOrder.ProviderID = order.Edges.Provider.ID
		}

		err := services.NewPriorityQueueService().AssignLockPaymentOrder(ctx, lockPaymentOrder)
		if err != nil {
			logger.Errorf("ReassignUnfulfilledLockOrders.AssignLockPaymentOrder: %s => %v", order.GatewayID, err)
		}
	}
}

// Unvalidated lock orders: a provider claimed the order and said it had paid,
// but nothing confirmed it. Reassigned, or refunded when nobody will take it.

package tasks

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	fastshot "github.com/opus-domini/fast-shot"
	"github.com/redis/go-redis/v9"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/lockorderfulfillment"
	"github.com/usezoracle/tapp/api/ent/lockpaymentorder"
	"github.com/usezoracle/tapp/api/ent/providerprofile"
	"github.com/usezoracle/tapp/api/ent/transactionlog"
	"github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	"github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

func ReassignUnvalidatedLockOrders() {
	ctx := context.Background()

	// Query unvalidated lock orders. Exclude orders with an in-flight/paid
	// platform payout so a paid order is never refunded mid-settle.
	lockOrders, err := storage.Client.LockPaymentOrder.
		Query().
		Where(
			lockpaymentorder.FiatPayoutStatusNotIn(lockpaymentorder.FiatPayoutStatusPending, lockpaymentorder.FiatPayoutStatusSuccess),
			lockpaymentorder.Or(
				lockpaymentorder.StatusEQ(lockpaymentorder.StatusFulfilled),
				lockpaymentorder.And(
					lockpaymentorder.StatusEQ(lockpaymentorder.StatusCancelled),
					lockpaymentorder.HasFulfillmentsWith(
						lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusPending),
					),
				),
			),
			lockpaymentorder.Or(
				lockpaymentorder.HasFulfillmentsWith(
					lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusFailed),
					lockorderfulfillment.Not(lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusSuccess)),
					lockorderfulfillment.Not(lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusPending)),
				),
				lockpaymentorder.And(
					lockpaymentorder.HasFulfillmentsWith(
						lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusPending),
					),
					lockpaymentorder.HasFulfillmentsWith(
						lockorderfulfillment.UpdatedAtLTE(time.Now().Add(-orderConf.OrderFulfillmentValidity*time.Minute)),
						lockorderfulfillment.Not(lockorderfulfillment.UpdatedAtGT(time.Now().Add(-orderConf.OrderFulfillmentValidity*time.Minute))),
					),
				),
				lockpaymentorder.HasFulfillmentsWith(
					lockorderfulfillment.ValidationStatusEQ(lockorderfulfillment.ValidationStatusSuccess),
				),
			),
		).
		WithToken(func(tq *ent.TokenQuery) {
			tq.WithNetwork()
		}).
		WithProvider(func(pq *ent.ProviderProfileQuery) {
			pq.WithAPIKey()
		}).
		WithFulfillments().
		WithProvisionBucket(func(pb *ent.ProvisionBucketQuery) {
			pb.WithCurrency()
		}).
		All(ctx)
	if err != nil {
		logger.Errorf("ReassignUnvalidatedLockOrders.db: %v", err)
		return
	}

	for _, order := range lockOrders {
		for _, fulfillment := range order.Edges.Fulfillments {
			if fulfillment.ValidationStatus == lockorderfulfillment.ValidationStatusPending {
				// TODO: use auth
				// // Compute HMAC
				// decodedSecret, err := base64.StdEncoding.DecodeString(order.Edges.Provider.Edges.APIKey.Secret)
				// if err != nil {
				// 	logger.Errorf("ReassignUnvalidatedLockOrders: %v", err)
				// 	return
				// }
				// decryptedSecret, err := cryptoUtils.DecryptPlain(decodedSecret)
				// if err != nil {
				// 	logger.Errorf("ReassignUnvalidatedLockOrders: %v", err)
				// 	return
				// }

				// payload := map[string]interface{}{}

				// signature := tokenUtils.GenerateHMACSignature(payload, string(decryptedSecret))

				// Send GET request to the provider's node
				res, err := fastshot.NewClient(order.Edges.Provider.HostIdentifier).
					Config().SetTimeout(30 * time.Second).
					// Header().Add("X-Request-Signature", signature).
					Build().GET(fmt.Sprintf("/tx_status/%s/%s", fulfillment.Psp, fulfillment.TxID)).
					Send()
				if err != nil {
					logger.Errorf("ReassignUnvalidatedLockOrders: %v", err)
					continue
				}

				data, err := utils.ParseJSONResponse(res.RawResponse)
				if err != nil {
					logger.Errorf("ReassignUnvalidatedLockOrders: %v %v", err, data)
					continue
				}

				status := data["data"].(map[string]interface{})["status"].(string)

				if status == "failed" {
					_, err = storage.Client.LockOrderFulfillment.
						UpdateOneID(fulfillment.ID).
						SetValidationStatus(lockorderfulfillment.ValidationStatusFailed).
						SetValidationError(data["data"].(map[string]interface{})["error"].(string)).
						Save(ctx)
					if err != nil {
						logger.Errorf("ReassignUnvalidatedLockOrders.UpdateFulfillmentStatusFailed: %v", err)
						continue
					}

					_, err = order.Update().
						SetStatus(lockpaymentorder.StatusFulfilled).
						Save(ctx)
					if err != nil {
						logger.Errorf("ReassignUnvalidatedLockOrders.UpdateOrderStatusFulfilled: %v", err)
						continue
					}

				} else if status == "success" {
					_, err = storage.Client.LockOrderFulfillment.
						UpdateOneID(fulfillment.ID).
						SetValidationStatus(lockorderfulfillment.ValidationStatusSuccess).
						Save(ctx)
					if err != nil {
						logger.Errorf("ReassignUnvalidatedLockOrders.UpdateFulfillmentStatusSuccess: %v", err)
						continue
					}

					transactionLog, err := storage.Client.TransactionLog.
						Create().
						SetStatus(transactionlog.StatusOrderValidated).
						SetNetwork(order.Edges.Token.Edges.Network.Identifier).
						SetMetadata(map[string]interface{}{
							"TransactionID": fulfillment.TxID,
							"PSP":           fulfillment.Psp,
						}).
						Save(ctx)
					if err != nil {
						logger.Errorf("ReassignUnvalidatedLockOrders.CreateTransactionLog: %v", err)
						continue
					}

					_, err = storage.Client.LockPaymentOrder.
						UpdateOneID(order.ID).
						SetStatus(lockpaymentorder.StatusValidated).
						AddTransactions(transactionLog).
						Save(ctx)
					if err != nil {
						logger.Errorf("ReassignUnvalidatedLockOrders.UpdateOrderStatusValidated: %v", err)
						continue
					}
				}

			} else if fulfillment.ValidationStatus == lockorderfulfillment.ValidationStatusFailed {
				if order.Edges.Provider.VisibilityMode != providerprofile.VisibilityModePrivate {
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
						ProviderID:        "",
						Memo:              order.Memo,
						ProvisionBucket:   order.Edges.ProvisionBucket,
					}

					err := services.NewPriorityQueueService().AssignLockPaymentOrder(ctx, lockPaymentOrder)
					if err != nil {
						logger.Errorf("ReassignUnvalidatedLockOrders.AssignLockPaymentOrder: %v", err)
					}
				}
			} else if fulfillment.ValidationStatus == lockorderfulfillment.ValidationStatusSuccess {
				transactionLog, err := storage.Client.TransactionLog.
					Create().
					SetStatus(transactionlog.StatusOrderValidated).
					SetNetwork(order.Edges.Token.Edges.Network.Identifier).
					SetMetadata(map[string]interface{}{
						"TransactionID": fulfillment.TxID,
						"PSP":           fulfillment.Psp,
					}).
					Save(ctx)
				if err != nil {
					logger.Errorf("ReassignUnvalidatedLockOrders.CreateTransactionLog: %v", err)
					continue
				}

				_, err = storage.Client.LockPaymentOrder.
					UpdateOneID(order.ID).
					SetStatus(lockpaymentorder.StatusValidated).
					AddTransactions(transactionLog).
					Save(ctx)
				if err != nil {
					logger.Errorf("ReassignUnvalidatedLockOrders.UpdateOrderStatusValidated: %v", err)
					continue
				}
			}
		}
	}
}

// ReassignStaleOrderRequest reassigns expired order requests to providers
func ReassignStaleOrderRequest(ctx context.Context, orderRequestChan <-chan *redis.Message) {
	for msg := range orderRequestChan {
		key := strings.Split(msg.Payload, "_")
		orderID := key[len(key)-1]

		orderUUID, err := uuid.Parse(orderID)
		if err != nil {
			logger.Errorf("ReassignStaleOrderRequest: %v", err)
			continue
		}

		// Get the order from the database
		order, err := storage.Client.LockPaymentOrder.
			Query().
			Where(
				lockpaymentorder.IDEQ(orderUUID),
			).
			WithProvisionBucket().
			Only(ctx)
		if err != nil {
			logger.Errorf("ReassignStaleOrderRequest: %v", err)
			continue
		}

		orderFields := types.LockPaymentOrderFields{
			ID:                order.ID,
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

		// Assign the order to a provider
		err = services.NewPriorityQueueService().AssignLockPaymentOrder(ctx, orderFields)
		if err != nil {
			logger.Errorf("ReassignStaleOrderRequest.AssignLockPaymentOrder: %v", err)
		}
	}
}

// SubscribeToRedisKeyspaceEvents subscribes to redis keyspace events according to redis.conf settings

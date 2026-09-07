// The cron schedule, and the Redis keyspace subscription that drives stale
// order-request expiry.

package tasks

import (
	"context"
	"time"

	"github.com/go-co-op/gocron"
	"github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/utils/logger"
)

func SubscribeToRedisKeyspaceEvents() {
	ctx := context.Background()

	// Handle expired or deleted order request key events
	orderRequest := storage.RedisClient.PSubscribe(
		ctx,
		"__keyevent@0__:expired:order_request_*",
		"__keyevent@0__:del:order_request_*",
	)
	orderRequestChan := orderRequest.Channel()

	go ReassignStaleOrderRequest(ctx, orderRequestChan)
}

// supportedRateCurrencies is the set of fiats we compute a live market rate for.

func StartCronJobs() {
	scheduler := gocron.NewScheduler(time.UTC)
	priorityQueue := services.NewPriorityQueueService()

	// One-time bootstrap.
	if err := ComputeMarketRate(); err != nil {
		logger.Errorf("StartCronJobs: %v", err)
	}
	if err := priorityQueue.ProcessBucketQueues(); err != nil {
		logger.Errorf("StartCronJobs: %v", err)
	}

	// The Sui event indexer, the Sui deposit watcher, the Route A dispatcher
	// and the Base gas-balance alert all went with the chain they served.
	//
	// The indexer watched a Move package for order events; the watcher polled
	// one-time Sui addresses for deposits; the dispatcher advanced orders
	// through bridging to Base. Deposits land on Base directly now and are
	// read by internal/chain/base, and settlement is a ledger movement
	// followed by a bank transfer -- so there is no bridge to advance and no
	// events to index.

	// Reconcile in-flight Route B fiat payouts as a backstop to the webhook.
	if _, err := scheduler.Cron("*/2 * * * *").Do(ReconcileFiatPayouts); err != nil {
		logger.Errorf("StartCronJobs: %v", err)
	}

	scheduler.StartAsync()
}

// ReconcileFiatPayouts polls the BaaS rail for the outcome of in-flight Route B
// payouts (fiat_payout_status=pending with a session id) and converges each lock
// order to a terminal status. It is the backstop to the inbound webhook: if a
// callback is missed, this closes the loop. No-op when the rail is unconfigured.

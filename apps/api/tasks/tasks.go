// Package tasks holds the platform's background work: order reassignment,
// market rates, webhook retries and payout reconciliation.
//
// This file carries only the configuration they share. Each job lives in a
// sibling named for what it does, and cron.go is where the schedule is.
package tasks

import (
	"github.com/usezoracle/tapp/api/config"
)

var orderConf = config.OrderConfig()
var serverConf = config.ServerConfig()

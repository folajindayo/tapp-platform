// Package controllers holds the HTTP handlers for the public and
// sender-facing API.
//
// This file carries only the controller itself and the configuration every
// handler reads. The handlers live in siblings named for what they serve:
// reference.go, accounts.go, order_status.go, order_confirm.go, kyc.go.
package controllers

import (
	"github.com/usezoracle/tapp/api/config"
	svc "github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/types"
)

var cryptoConf = config.CryptoConfig()
var serverConf = config.ServerConfig()
var orderConf = config.OrderConfig()

// Controller is the default controller for other endpoints
type Controller struct {
	orderService          types.OrderService
	priorityQueueService  *svc.PriorityQueueService
	receiveAddressService *svc.ReceiveAddressService
}

// NewController creates a new instance of AuthController with injected services
func NewController() *Controller {
	return &Controller{
		priorityQueueService:  svc.NewPriorityQueueService(),
		receiveAddressService: svc.NewReceiveAddressService(),
	}
}

// Package provider is the liquidity-provider API: the queue of orders
// assigned to a provider, and everything they do with one.
//
// This file carries the controller and shared configuration; the handlers are
// in siblings named for what they serve.
package provider

import (
	"github.com/usezoracle/tapp/api/config"
)

var orderConf = config.OrderConfig()

// ProviderController is a controller type for provider endpoints
type ProviderController struct{}

// NewProviderController creates a new instance of ProviderController with injected services
func NewProviderController() *ProviderController {
	return &ProviderController{}
}

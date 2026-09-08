// Package accounts, profile half: the sender and provider profiles hanging
// off a user.
//
// This file carries the controller; the handlers are in profile_sender.go,
// profile_provider.go and profile_read.go.
package accounts

import (
	"github.com/usezoracle/tapp/api/config"
	svc "github.com/usezoracle/tapp/api/services"
)

var orderConf = config.OrderConfig()

// ProfileController is a controller type for profile settings
type ProfileController struct {
	apiKeyService        *svc.APIKeyService
	priorityQueueService *svc.PriorityQueueService
}

// NewProfileController creates a new instance of ProfileController
func NewProfileController() *ProfileController {
	return &ProfileController{
		apiKeyService:        svc.NewAPIKeyService(),
		priorityQueueService: svc.NewPriorityQueueService(),
	}
}

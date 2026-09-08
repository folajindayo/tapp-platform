// Package accounts is sign-up, sign-in, and everything that keeps a session
// alive or ends it.
//
// This file carries the controller and the configuration it reads; the
// handlers are in siblings named for what they do.
package accounts

import (
	"github.com/usezoracle/tapp/api/config"
	svc "github.com/usezoracle/tapp/api/services"
)

var authConf = config.AuthConfig()
var serverConf = config.ServerConfig()

type AuthController struct {
	apiKeyService *svc.APIKeyService
	emailService  *svc.EmailService
}

func NewAuthController() *AuthController {
	return &AuthController{
		apiKeyService: svc.NewAPIKeyService(),
		emailService:  svc.NewEmailService(svc.DefaultMailProvider()),
	}
}

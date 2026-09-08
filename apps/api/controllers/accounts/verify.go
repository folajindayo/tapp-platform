// Proving the email address is real.
//
//	POST /v1/auth/confirm-account
//	POST /v1/auth/resend-token

package accounts

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	userEnt "github.com/usezoracle/tapp/api/ent/user"
	"github.com/usezoracle/tapp/api/ent/verificationtoken"
	db "github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
	"github.com/usezoracle/tapp/api/utils/token"
)

// ConfirmEmail controller validates the payload and confirm the users email.
func (ctrl *AuthController) ConfirmEmail(ctx *gin.Context) {
	var payload types.ConfirmEmailPayload

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	scope := string(verificationtoken.ScopeEmailVerification)

	// Brute-force guard: a 6-digit code is only safe behind an attempt cap.
	if otpAttemptsExceeded(ctx, scope, payload.Email) {
		u.APIResponse(ctx, http.StatusTooManyRequests, "error",
			"Too many incorrect attempts — request a new code", nil)
		return
	}

	// Hash the submitted code and compare against the at-rest hash.
	// `verificationtoken.token` column holds SHA-256(raw), not raw.
	verificationToken, vtErr := db.Client.VerificationToken.
		Query().
		Where(
			verificationtoken.TokenEQ(token.HashToken(payload.Token)),
			verificationtoken.HasOwnerWith(userEnt.EmailEQ(payload.Email)),
		).
		WithOwner().
		Only(ctx)
	if vtErr != nil {
		recordOTPFailure(ctx, scope, payload.Email, authConf.EmailVerificationLifespan)
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid verification code", nil)
		return
	}

	if time.Now().After(verificationToken.ExpiryAt) {
		err := db.Client.VerificationToken.
			DeleteOneID(verificationToken.ID).Exec(ctx)
		if err != nil {
			logger.Errorf("ConfirmEmailError.VerificationToken.Delete: %v", err)
		}
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Token is expired", nil)
		return
	}

	// Update User IsEmailVerified to true
	_, setIfVerifiedErr := verificationToken.Edges.Owner.
		Update().
		SetIsEmailVerified(true).
		Save(ctx)
	if setIfVerifiedErr != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to verify user email", setIfVerifiedErr.Error())
		return
	}

	err := db.Client.VerificationToken.
		DeleteOneID(verificationToken.ID).Exec(ctx)
	if err != nil {
		logger.Errorf("ConfirmEmailError.VerificationToken.Delete: %v", err)
	}
	clearOTPAttempts(ctx, scope, payload.Email)

	// Return a success response
	u.APIResponse(ctx, http.StatusOK, "success", "User email verified successfully", nil)
}

// ResendVerificationToken controller resends the verification token to the users email.
func (ctrl *AuthController) ResendVerificationToken(ctx *gin.Context) {
	var payload types.ResendTokenPayload

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	// Fetch User account.
	user, userErr := db.Client.User.Query().Where(userEnt.EmailEQ(payload.Email)).Only(ctx)
	if userErr != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid credential", userErr.Error())
		return
	}

	// Generate a fresh OTP — store hash, email the code.
	rawToken, err := token.GenerateOTP()
	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to generate verification token", err.Error())
		return
	}
	// Verification tokens get a longer TTL (24h) than password-reset
	// tokens (15min) — different threat model. Verification can sit in
	// an inbox; reset is short-lived because the user should act now.
	ttl := authConf.EmailVerificationLifespan
	if verificationtoken.Scope(payload.Scope) == verificationtoken.ScopeResetPassword {
		ttl = authConf.PasswordResetLifespan
	}
	_, vtErr := db.Client.VerificationToken.
		Create().
		SetOwner(user).
		SetToken(token.HashToken(rawToken)).
		SetScope(verificationtoken.Scope(payload.Scope)).
		SetExpiryAt(time.Now().Add(ttl)).
		Save(ctx)
	if vtErr != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to generate verification token", vtErr.Error())
		return
	}

	// Fresh code → reset the attempt counter for this (scope,email).
	clearOTPAttempts(ctx, payload.Scope, user.Email)

	// Send the email that matches the scope — reset codes get the reset copy.
	var sendErr error
	if verificationtoken.Scope(payload.Scope) == verificationtoken.ScopeResetPassword {
		_, sendErr = ctrl.emailService.SendPasswordResetEmail(ctx, rawToken, user.Email, user.FirstName)
	} else {
		_, sendErr = ctrl.emailService.SendVerificationEmail(ctx, rawToken, user.Email, user.FirstName)
	}
	if sendErr != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to send verification email", sendErr.Error())
		return
	}

	// Return a success response
	u.APIResponse(ctx, http.StatusOK, "success", "Verification token has been sent to your email", nil)
}

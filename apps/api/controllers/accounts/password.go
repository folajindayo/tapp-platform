// Passwords: forgetting one, and changing one.
//
//	POST  /v1/auth/reset-password-token
//	PATCH /v1/auth/reset-password
//	PATCH /v1/auth/change-password

package accounts

import (
	"net/http"
	"time"

	authSvc "github.com/usezoracle/tapp/api/services/auth"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	userEnt "github.com/usezoracle/tapp/api/ent/user"
	"github.com/usezoracle/tapp/api/ent/verificationtoken"
	db "github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/crypto"
	"github.com/usezoracle/tapp/api/utils/logger"
	"github.com/usezoracle/tapp/api/utils/token"
)

// ResetPassword resets user's password. A valid token is required to set new password
func (ctrl *AuthController) ResetPassword(ctx *gin.Context) {
	var payload types.ResetPasswordPayload

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	scope := string(verificationtoken.ScopeResetPassword)

	// Brute-force guard: a 6-digit reset code grants account access, so the
	// attempt cap is the primary defense.
	if otpAttemptsExceeded(ctx, scope, payload.Email) {
		u.APIResponse(ctx, http.StatusTooManyRequests, "error",
			"Too many incorrect attempts — request a new code", nil)
		return
	}

	// Verify reset code — scoped to the owning email. A 6-digit OTP is not
	// globally unique, so without the email filter two users could share a code
	// (matching the wrong row, or erroring on .Only with multiple matches).
	resetTokenRow, err := db.Client.VerificationToken.
		Query().
		Where(
			verificationtoken.TokenEQ(token.HashToken(payload.ResetToken)),
			verificationtoken.ScopeEQ(verificationtoken.ScopeResetPassword),
			verificationtoken.HasOwnerWith(userEnt.EmailEQ(payload.Email)),
		).
		WithOwner().
		Only(ctx)
	if err != nil || resetTokenRow == nil || resetTokenRow.Edges.Owner == nil {
		recordOTPFailure(ctx, scope, payload.Email, authConf.PasswordResetLifespan)
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid password reset code", nil)
		return
	}

	if time.Now().After(resetTokenRow.ExpiryAt) {
		err := db.Client.VerificationToken.
			DeleteOneID(resetTokenRow.ID).Exec(ctx)
		if err != nil {
			logger.Errorf("ResetPasswordError.VerificationToken.Delete: %v", err)
		}
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Token is expired", nil)
		return
	}

	_, err = db.Client.User.
		UpdateOne(resetTokenRow.Edges.Owner).
		SetPassword(payload.Password).
		Save(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to reset password", nil)
		return
	}

	// Delete verification token — single-use.
	verificationErr := db.Client.VerificationToken.
		DeleteOneID(resetTokenRow.ID).Exec(ctx)
	if verificationErr != nil {
		logger.Errorf("ResetPasswordError.VerificationToken.Delete: %v", verificationErr)
	}
	clearOTPAttempts(ctx, scope, payload.Email)

	// Industry-standard hygiene: revoke EVERY active refresh-token
	// family for this user. If the original account was compromised,
	// the attacker's session is killed alongside the legitimate ones —
	// the user logs back in fresh on each device after the reset.
	if revokeErr := authSvc.RevokeAllForUser(ctx, resetTokenRow.Edges.Owner.ID); revokeErr != nil {
		logger.Errorf("ResetPasswordError.RevokeRefreshTokens: %v", revokeErr)
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Password reset was successful", nil)
}

// ResetPasswordToken sends a reset password token to user's email
func (ctrl *AuthController) ResetPasswordToken(ctx *gin.Context) {
	var payload types.ResetPasswordTokenPayload

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	// Get user account.
	user, userErr := db.Client.User.
		Query().
		Where(userEnt.EmailEQ(payload.Email)).
		Only(ctx)
	if userErr != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Email does not belong to any user", nil)
		return
	}

	// Generate a 6-digit reset OTP — store hash, email the code.
	rawResetToken, err := token.GenerateOTP()
	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to generate reset password token", nil)
		return
	}
	if _, rtErr := db.Client.VerificationToken.
		Create().
		SetOwner(user).
		SetToken(token.HashToken(rawResetToken)).
		SetScope(verificationtoken.ScopeResetPassword).
		SetExpiryAt(time.Now().Add(authConf.PasswordResetLifespan)).
		Save(ctx); rtErr != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to generate reset password token", nil)
		return
	}

	// Fresh code → reset the attempt counter for this email.
	clearOTPAttempts(ctx, string(verificationtoken.ScopeResetPassword), user.Email)

	if _, err := ctrl.emailService.SendPasswordResetEmail(ctx, rawResetToken, user.Email, user.FirstName); err != nil {
		logger.Warnf("[AUTH] Email sending failed: %v", err)
		logger.Infof("[DEV AUTH] Password reset OTP for %s: %s", user.Email, rawResetToken)
		// For local development or when mailer service is offline, succeed and provide devOtp
		u.APIResponse(ctx, http.StatusOK, "success", "A reset token has been sent to your email", gin.H{
			"devOtp": rawResetToken,
		})
		return
	}

	// Return a success response
	u.APIResponse(ctx, http.StatusOK, "success", "A reset token has been sent to your email", nil)
}

// ChangePassword changes user's password. An authorized user is required to change password
func (ctrl *AuthController) ChangePassword(ctx *gin.Context) {
	var payload types.ChangePasswordPayload

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	// get user id from context
	user_id := ctx.GetString("user_id")
	// parse user id to uuid
	userID, err := uuid.Parse(user_id)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid credential", nil)
		return
	}

	// Fetch user account.
	user, err := db.Client.User.
		Query().
		Where(userEnt.IDEQ(userID)).
		Only(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid credential", nil)
		return
	}

	// Check if the old password is correct
	passwordMatch := crypto.CheckPasswordHash(payload.OldPassword, user.Password)
	if !passwordMatch {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Old password is incorrect", nil)
		return
	}

	// Check if the new password is the same as the old password
	passwordMatch = crypto.CheckPasswordHash(payload.NewPassword, user.Password)
	if passwordMatch {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "New password cannot be the same as old password", nil)
		return
	}

	// Update user password
	_, err = db.Client.User.
		UpdateOne(user).
		SetPassword(payload.NewPassword).
		Save(ctx)

	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to change password", nil)
		return
	}

	// Return a success response
	u.APIResponse(ctx, http.StatusOK, "success", "Password changed successfully", nil)
}

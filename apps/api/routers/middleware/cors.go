package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// CORSMiddleware answers cross-origin requests from the browser apps that are
// allowed to call this API, and only those.
//
// allowed is the list of origins (scheme://host[:port]) that may read
// responses: in practice the PWA and the checkout site, from config. A
// request from any other origin gets no Access-Control-Allow-Origin header,
// so the browser refuses to hand the response to the page. Requests without
// an Origin header -- the merchant app, curl, server-to-server -- are not
// cross-origin requests and pass through untouched.
//
// The predecessor reflected whatever Origin arrived, with credentials
// allowed, which is the same as having no origin policy at all.
func CORSMiddleware(allowed []string) gin.HandlerFunc {
	set := make(map[string]bool, len(allowed))
	for _, o := range allowed {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			set[o] = true
		}
	}

	return func(ctx *gin.Context) {
		origin := ctx.Request.Header.Get("Origin")
		if origin == "" {
			ctx.Next()
			return
		}

		if set[origin] {
			h := ctx.Writer.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Max-Age", "86400")
			h.Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, PATCH, DELETE")
			h.Set("Access-Control-Allow-Headers", "Origin, Content-Type, api_key, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, Client-Type, X-Admin-Token, ngrok-skip-browser-warning, Idempotency-Key")
			h.Set("Access-Control-Expose-Headers", "Content-Length")
			h.Set("Cache-Control", "no-cache")
		}

		if ctx.Request.Method == "OPTIONS" {
			// A preflight from an unlisted origin is answered with no CORS
			// headers, which the browser treats as a refusal.
			ctx.AbortWithStatus(204)
			return
		}
		ctx.Next()
	}
}

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func corsRouter(allowed ...string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORSMiddleware(allowed))
	r.GET("/ping", func(c *gin.Context) { c.String(200, "pong") })
	return r
}

func do(r *gin.Engine, method, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/ping", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestListedOriginIsAllowed(t *testing.T) {
	w := do(corsRouter("https://tapp-pwa.vercel.app", "https://checkout.example.com/"), http.MethodGet, "https://checkout.example.com")
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://checkout.example.com" {
		t.Fatalf("Allow-Origin = %q, want the listed origin (trailing slash in config must not matter)", got)
	}
	if w.Header().Get("Vary") != "Origin" {
		t.Fatal("responses that depend on Origin must say so for caches")
	}
	if w.Code != 200 || w.Body.String() != "pong" {
		t.Fatalf("handler not reached: %d %q", w.Code, w.Body.String())
	}
}

func TestUnlistedOriginGetsNoCORSHeaders(t *testing.T) {
	w := do(corsRouter("https://tapp-pwa.vercel.app"), http.MethodGet, "https://evil.example")
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q for an unlisted origin; the old middleware reflected it", got)
	}
	if w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("credentials must never be allowed for an unlisted origin")
	}
}

func TestPreflightFromUnlistedOriginIsRefused(t *testing.T) {
	w := do(corsRouter("https://tapp-pwa.vercel.app"), http.MethodOptions, "https://evil.example")
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("preflight: code %d Allow-Origin %q; want 204 with no CORS headers", w.Code, w.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestPreflightFromListedOriginSucceeds(t *testing.T) {
	w := do(corsRouter("https://tapp-pwa.vercel.app"), http.MethodOptions, "https://tapp-pwa.vercel.app")
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("preflight: code %d methods %q", w.Code, w.Header().Get("Access-Control-Allow-Methods"))
	}
}

func TestNoOriginPassesThroughUntouched(t *testing.T) {
	w := do(corsRouter("https://tapp-pwa.vercel.app"), http.MethodGet, "")
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("same-origin/non-browser request: code %d Allow-Origin %q", w.Code, w.Header().Get("Access-Control-Allow-Origin"))
	}
}

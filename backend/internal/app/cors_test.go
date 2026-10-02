package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestCorsMiddlewareWildcard covers the "*.<domain>" entry corsMiddleware
// supports so that every business's own subdomain (see
// tenant.SubdomainLabel) can call this API without listing each one
// individually in FRONTEND_ORIGIN.
func TestCorsMiddlewareWildcard(t *testing.T) {
	gin.SetMode(gin.TestMode)

	allowed := "https://demo.cloudhousefinance.com,https://superadmin.cloudhousefinance.com,https://*.cloudhousefinance.com"

	newRouter := func() *gin.Engine {
		r := gin.New()
		r.Use(corsMiddleware(allowed))
		r.GET("/ping", func(c *gin.Context) { c.Status(http.StatusOK) })
		return r
	}

	cases := []struct {
		name        string
		origin      string
		wantAllowed bool
	}{
		{"exact match", "https://demo.cloudhousefinance.com", true},
		{"another exact match", "https://superadmin.cloudhousefinance.com", true},
		{"valid wildcard subdomain", "https://ambika.cloudhousefinance.com", true},
		{"another valid wildcard subdomain", "https://ctfi.cloudhousefinance.com", true},
		{
			// The dangerous case a plain strings.Contains would get wrong:
			// no separating dot before the base domain, so this is NOT a
			// subdomain of cloudhousefinance.com at all.
			"lookalike domain without separating dot",
			"https://evilcloudhousefinance.com",
			false,
		},
		{"unrelated domain", "https://evil.com", false},
		{"unrelated domain containing the base domain as a path-like suffix", "https://attacker.com/cloudhousefinance.com", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newRouter()
			req := httptest.NewRequest(http.MethodGet, "/ping", nil)
			req.Header.Set("Origin", tc.origin)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			got := rec.Header().Get("Access-Control-Allow-Origin")
			if tc.wantAllowed && got != tc.origin {
				t.Fatalf("origin %q: expected Access-Control-Allow-Origin=%q, got %q", tc.origin, tc.origin, got)
			}
			if !tc.wantAllowed && got != "" {
				t.Fatalf("origin %q: expected no Access-Control-Allow-Origin header, got %q", tc.origin, got)
			}
		})
	}
}

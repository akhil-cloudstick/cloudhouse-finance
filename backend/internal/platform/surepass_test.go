package platform

import (
	"net/http"
	"testing"
)

func TestPublicRedirectURL(t *testing.T) {
	for in, want := range map[string]string{
		"http://localhost:3000/esign-callback":             "",
		"https://127.0.0.1:3000/cb":                        "",
		"http://[::1]:3000/cb":                             "",
		"http://tenant.localhost:3000/cb":                  "",
		"https://app.cloudhousefinance.com/esign-callback": "https://app.cloudhousefinance.com/esign-callback",
	} {
		if got := publicRedirectURL(in); got != want {
			t.Errorf("publicRedirectURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSurepassErrorStatus(t *testing.T) {
	for code, want := range map[int]int{
		401: http.StatusServiceUnavailable,
		403: http.StatusServiceUnavailable,
		422: http.StatusBadRequest,
		500: http.StatusBadGateway,
	} {
		if got := (&SurepassError{StatusCode: code}).Status(); got != want {
			t.Errorf("status %d -> %d, want %d", code, got, want)
		}
	}
}

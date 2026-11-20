package main

import "testing"

func TestPageFor(t *testing.T) {
	cases := map[string]string{
		"/ctfi":                 "app.html",
		"/ctfi/login":           "login.html",
		"/ctfi/reset":           "reset.html",
		"/ctfi/dashboard":       "app.html",
		"/ctfi/loan/GL-1001":    "app.html",
		"/dashboard":            "app.html",
		"/loan/GL-1001":         "app.html",
		"/login":                "login.html",
		"/forgot-password":      "forgot-password.html",
		"/esign-callback":       "esign-callback.html",
		"/ctfi/nonsense":        "",
		"/ctfi/loan/GL-1001/x":  "",
		"/loan/GL-1001/extra":   "",
		"/superadmin":           "",
		"/ctfi/forgot-password": "",
		"/":                     "",
		"/Ctfi/login":           "",
	}
	for path, want := range cases {
		if got := pageFor(path); got != want {
			t.Errorf("pageFor(%q) = %q, want %q", path, got, want)
		}
	}
}

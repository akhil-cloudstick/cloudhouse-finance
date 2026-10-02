package tenant

import "testing"

// TestNormalizeHost pins the comparison both sides of the host check go
// through. A mismatch here does not fail loudly — it silently stops a
// business's own URL from being recognised, which would send borrowers back
// to typing a business code and, worse, make RequireHostMatchesTenant stop
// refusing replayed sessions.
func TestNormalizeHost(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"  ", ""},
		{"example.com", "example.com"},
		{"Example.COM", "example.com"},
		{"example.com:443", "example.com"},
		{"example.com.", "example.com"},
		{"https://example.com", "example.com"},
		{"https://Example.com/", "example.com"},
		{"http://example.com:8080/app", "example.com"},
		{"https://ambika.cloudhousefinance.com/login", "ambika.cloudhousefinance.com"},
		{"localhost:3000", "localhost"},
		// An AppURL stored with a path must still match a bare Host header.
		{"https://example.com/tenant/ambika", "example.com"},
	}
	for _, c := range cases {
		if got := NormalizeHost(c.in); got != c.want {
			t.Errorf("NormalizeHost(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestNormalizeHostMatchesAcrossStorageAndHeaderForms is the property that
// actually matters: however a business's AppURL was typed into the superadmin
// console, it must equal what arrives in the Host header.
func TestNormalizeHostMatchesAcrossStorageAndHeaderForms(t *testing.T) {
	stored := []string{
		"https://ambika.example.com",
		"https://ambika.example.com/",
		"http://ambika.example.com",
		"AMBIKA.example.com",
	}
	headers := []string{"ambika.example.com", "ambika.example.com:443", "Ambika.example.com"}
	for _, s := range stored {
		for _, h := range headers {
			if NormalizeHost(s) != NormalizeHost(h) {
				t.Errorf("stored %q and header %q do not match (%q vs %q)",
					s, h, NormalizeHost(s), NormalizeHost(h))
			}
		}
	}
}

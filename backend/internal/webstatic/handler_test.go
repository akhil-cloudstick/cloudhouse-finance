package webstatic

import (
	"os"
	"path/filepath"
	"testing"
)

// The per-business link fallback: /login/<slug> and /app/<slug> must resolve
// to the login and app pages, and nothing else may.
//
// This is tested rather than assumed because it is the PRODUCTION half of a
// two-sided arrangement. `next dev` handles slugged paths with a rewrite,
// which means the whole feature can look fine in development while 404ing for
// every real customer — the failure would appear only after deploy, on the
// sign-in link, which is the worst possible place to find it.
func TestSluggedPathsResolveToTheirPage(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"login.html", "app.html", "index.html"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(name), 0o600); err != nil {
			t.Fatalf("writing %s: %v", name, err)
		}
	}
	h := New(root)

	cases := []struct {
		path string
		want string
		why  string
	}{
		{"/login", "login.html", "the bare login page still resolves normally"},
		{"/app", "app.html", "the bare app shell still resolves normally"},
		{"/login/acme", "login.html", "a business's own sign-in link"},
		{"/app/acme", "app.html", "a business's own app link"},
		{"/login/acme-gold-2", "login.html", "dashes and digits are valid in a slug"},

		// Everything below must NOT resolve. A slugged fallback that is too
		// eager stops being a fallback and starts serving the app shell for
		// arbitrary URLs, which hides real 404s.
		{"/login/Acme", "", "slugs are lowercase; an uppercase segment is not a slug"},
		{"/login/acme/extra", "", "deeper paths are not part of the link design"},
		{"/app/acme/extra", "", "deeper paths are not part of the link design"},
		{"/nonsense/acme", "", "only /login and /app carry a slug"},
		{"/login/-acme", "", "a slug cannot start with a dash"},
		{"/login/acme_gold", "", "underscores are not valid in a slug"},

		// The slug is only ever compared, never joined onto a path — so it
		// cannot be turned into a way to reach a file. Asserted anyway: this
		// is a fallback that runs after the on-disk lookup fails, which is
		// exactly where a traversal would be tempting.
		{"/login/../../main.go", "", "a slug segment must not escape the web root"},

		// Not a traversal: "/app/.." normalises to "/", which is the site
		// root and inside the web root, so serving the homepage is the
		// correct answer rather than a leak. Pinned so that the difference
		// between "normalises to somewhere safe" and "escapes" stays visible
		// to whoever reads this next.
		{"/app/..", "index.html", "normalises to the site root, which is not an escape"},
	}

	for _, tc := range cases {
		got := h.resolve(tc.path)
		if tc.want == "" {
			if got != "" {
				t.Errorf("resolve(%q) = %q, want no match (%s)", tc.path, got, tc.why)
			}
			continue
		}
		if got != filepath.Join(root, tc.want) {
			t.Errorf("resolve(%q) = %q, want %q (%s)", tc.path, got, filepath.Join(root, tc.want), tc.why)
		}
	}
}

// TestSluggedFallbackNeverShadowsARealFile: a real file always wins.
//
// If a business were ever given a slug that collides with a genuine asset
// path, serving the login page instead of that asset would break the app in a
// way nobody would connect to tenancy.
func TestSluggedFallbackNeverShadowsARealFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "login.html"), []byte("login"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(root, "app", "settings.html")
	if err := os.WriteFile(real, []byte("real asset"), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := h(root).resolve("/app/settings"); got != real {
		t.Errorf("resolve(/app/settings) = %q, want the real file %q — the slug "+
			"fallback must never shadow something that exists on disk", got, real)
	}
}

func h(root string) *Handler { return New(root) }

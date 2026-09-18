package webstatic

import (
	"os"
	"path/filepath"
	"testing"
)

// The per-business link fallback: /<slug>/login, /<slug>/reset and
// /<slug>/<route> must resolve to the login page, the reset page and the app
// shell, and nothing else may.
//
// This is tested rather than assumed because it is the PRODUCTION half of a
// two-sided arrangement. `next dev` handles these paths with a rewrite, which
// means the whole feature can look fine in development while 404ing for every
// real customer — the failure would appear only after deploy, on the sign-in
// link, which is the worst possible place to find it.
func TestSluggedPathsResolveToTheirPage(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"login.html", "app.html", "reset.html", "index.html"} {
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
		// The single-business install, which names no business at all.
		{"/login", "login.html", "the bare login page still resolves normally"},
		{"/dashboard", "app.html", "a bare console route"},
		{"/loan/GL-1001", "app.html", "a bare console route with an argument"},

		// A business's own links: the code leads, the page follows.
		{"/acme/login", "login.html", "a business's own sign-in link"},
		{"/acme", "app.html", "the business's landing page"},
		{"/acme/dashboard", "app.html", "a console route under a business"},
		{"/acme/loan/GL-1001", "app.html", "a console route with an argument"},
		{"/acme/reset", "reset.html", "the operator reset tool, aimed at one named business"},
		{"/acme-gold-2/login", "login.html", "dashes and digits are valid in a slug"},

		// Everything below must NOT resolve. A slugged fallback that is too
		// eager stops being a fallback and starts serving the app shell for
		// arbitrary URLs, which hides real 404s.
		{"/Acme/login", "", "slugs are lowercase; an uppercase segment is not a slug"},
		{"/acme/nonsense", "", "an unknown page under a real business is still a 404"},
		{"/acme/loan/GL-1001/extra", "", "deeper paths are not part of the link design"},
		{"/acme/login/extra", "", "the standalone pages take no argument"},
		// NOT in the "must not resolve" group: a lone unknown segment is
		// exactly what a business code looks like, and this server has no list
		// of businesses to check it against (they are created at runtime). So
		// it serves the shell, which asks the API about the code and shows the
		// sign-in page when there is no such business. Refusing here instead
		// would 404 every real customer's landing link.
		{"/nonsense", "app.html", "a lone segment is a candidate business code, resolved by the app"},

		{"/-acme/login", "", "a slug cannot start with a dash"},
		{"/acme_gold/login", "", "underscores are not valid in a slug"},

		// The reserved words. A business may not be coded with one of these
		// (see RESERVED_ROOT_SEGMENTS on the frontend), so a path that starts
		// with one is read as a page, never as a business.
		{"/loans/login", "app.html", "\"loans\" is a reserved route, so this is the loans page — not business \"loans\""},
		{"/api/v1/loans", "", "the API prefix is never a business"},

		// The slug is only ever compared, never joined onto a path — so it
		// cannot be turned into a way to reach a file. Asserted anyway: this
		// is a fallback that runs after the on-disk lookup fails, which is
		// exactly where a traversal would be tempting.
		{"/acme/../../main.go", "", "a slug segment must not escape the web root"},

		// Not a traversal: "/acme/.." normalises to "/", which is the site
		// root and inside the web root, so serving the homepage is the
		// correct answer rather than a leak. Pinned so that the difference
		// between "normalises to somewhere safe" and "escapes" stays visible
		// to whoever reads this next.
		{"/acme/..", "index.html", "normalises to the site root, which is not an escape"},
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

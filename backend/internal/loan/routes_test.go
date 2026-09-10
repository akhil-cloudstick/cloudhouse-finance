package loan

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// TestRegisterRoutesNoConflict pins down that the whole loan route tree can
// actually be built. gin PANICS at registration time when a static segment
// collides with a wildcard at the same level, and this group deliberately
// mixes them heavily ("/drafts", "/requests", "/by-number/:loanNumber",
// "/auctions/concluded" all sitting beside "/:id"). A conflict here would
// take the entire API server down at boot, not fail one endpoint, so it is
// worth one cheap test rather than a manual smoke run.
func TestRegisterRoutesNoConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	pass := func(c *gin.Context) { c.Next() }
	perms := platform.CRUDMiddlewares{Create: pass, Read: pass, Update: pass, Delete: pass}

	defer func() {
		if rec := recover(); rec != nil {
			t.Fatalf("route registration panicked (gin tree conflict): %v", rec)
		}
	}()

	RegisterRoutes(r.Group("/api/v1/loans"), &Handler{}, perms, perms, pass)

	// Every draft route must be present and distinct from the "/:id" loan
	// routes — a silent mis-mount would otherwise show up only at runtime.
	want := map[string]string{
		http.MethodPost:   "/api/v1/loans/drafts",
		http.MethodGet:    "/api/v1/loans/drafts/:draftId",
		http.MethodPut:    "/api/v1/loans/drafts/:draftId",
		http.MethodDelete: "/api/v1/loans/drafts/:draftId",
	}
	got := map[string]map[string]bool{}
	for _, ri := range r.Routes() {
		if got[ri.Method] == nil {
			got[ri.Method] = map[string]bool{}
		}
		got[ri.Method][ri.Path] = true
	}
	for method, path := range want {
		if !got[method][path] {
			t.Errorf("missing route %s %s", method, path)
		}
	}
	if !got[http.MethodGet]["/api/v1/loans/drafts"] {
		t.Error("missing route GET /api/v1/loans/drafts")
	}
}

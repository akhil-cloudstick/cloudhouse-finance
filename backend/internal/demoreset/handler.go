// Package demoreset exposes the demo-data reset over HTTP.
//
// This package is glue and nothing else — every line of wipe and reseed logic
// lives in script/demoseed, which the CLI at script/demoreset also calls, so
// the terminal and the browser cannot diverge. Anything in here that starts
// to look like business logic belongs over there instead.
package demoreset

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync/atomic"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/script/demoseed"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// running serialises resets across the whole process.
//
// Two concurrent resets would interleave a wipe with the other's reseed and
// leave a dataset that is neither the client's nor the fixture's — customers
// deleted out from under half-created loans. Package-level rather than
// per-handler because there is one database behind however many handlers get
// constructed.
var running atomic.Bool

type Handler struct {
	deps *demoseed.Deps
}

// NewHandler builds the handler with its OWN service graph.
//
// It deliberately does not accept the services app.Build already assembled.
// Those are wired to the live WhatsApp sender, and the seeder drives roughly
// three hundred service calls that each would fire a message — see
// demoseed.Deps for the full reasoning. Constructing a second graph is the
// cheap way to make that impossible rather than merely unlikely.
//
// NewDeps issues no queries, so this is safe to call while building the
// router against a database that is never contacted (see
// internal/app/isolation_test.go).
func NewHandler(db *gorm.DB, cfg platform.Config) *Handler {
	return &Handler{deps: demoseed.NewDeps(db, cfg)}
}

/* THE RESPONSE IS A STREAM, NOT A SINGLE OBJECT.
 *
 * A reset takes several seconds and does a great deal of work. Answering with
 * one envelope at the end means the browser shows a spinner over a frozen
 * screen for that whole time, which every operator reads as "it has hung" —
 * and the one thing they must not do is close the tab.
 *
 * So this writes newline-delimited JSON: one object per completed phase, then
 * a final object carrying the report. NDJSON rather than SSE because the
 * client only has to split on newlines, with no event-framing to parse, and
 * rather than a poll-a-status-endpoint design because the progress is already
 * a callback on the seeder and inventing shared state to poll would be worse.
 *
 * Consequence worth knowing: the status code is committed with the first
 * chunk, so a failure part-way cannot be a 500. Everything that CAN be
 * checked up front — the lock, the session — is checked before the first
 * write and answered with an ordinary envelope. A failure after that is
 * reported as a terminal `error` object in the stream, which the client
 * surfaces the same way.
 */

// streamEvent is one line of the response.
//
// Exactly one of the three groups is populated: progress, error, or done +
// report. Encoded with omitempty so each line stays small and a client can
// tell them apart by which key is present.
type streamEvent struct {
	Step  string `json:"step,omitempty"`
	Index int    `json:"index,omitempty"`
	Total int    `json:"total,omitempty"`

	Error string `json:"error,omitempty"`

	Done   bool             `json:"done,omitempty"`
	Report *demoseed.Report `json:"report,omitempty"`
}

// Reset wipes the caller's own business, optionally restoring the demo
// dataset afterwards, streaming progress as it goes.
//
// POST, no request body. The business still comes from the authenticated
// session and cannot be forged, so the endpoint cannot be pointed at anyone
// else's data. The one input is ?seed=, a query param per the house standard:
//
//	?seed=true   (or omitted)  wipe, then restore the demo dataset
//	?seed=false                wipe only, leaving an empty business
//
// Omission means SEED, matching what this endpoint did before the flag
// existed. That default is chosen against the usual "safest default" instinct
// on purpose: both branches wipe, so neither is the safe one, and a caller
// that has not been updated should keep behaving exactly as it did rather
// than quietly start leaving the business empty.
func (h *Handler) Reset(c *gin.Context) {
	if !running.CompareAndSwap(false, true) {
		httpx.Fail(c, http.StatusConflict, "A reset is already in progress. Wait for it to finish before starting another.")
		return
	}
	defer running.Store(false)

	tenantID, ok := platform.TenantFromGin(c)
	if !ok || tenantID == 0 {
		httpx.Fail(c, http.StatusUnauthorized, "Not signed in.")
		return
	}

	// Parsed before the response is committed, so a malformed value is an
	// ordinary 400 rather than an error object buried in a 200 stream.
	// Anything other than an explicit "false" seeds — see the doc comment.
	seedDemo := true
	if raw := c.Query("seed"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "The seed parameter must be true or false.")
			return
		}
		seedDemo = parsed
	}

	// context.WithoutCancel because the reseed must outlive the request. A
	// browser that gives up, or an operator who closes the tab, would
	// otherwise cancel the context mid-run and leave the business wiped but
	// unseeded — the one state worse than either end of the operation.
	ctx := platform.WithTenant(context.WithoutCancel(c.Request.Context()), tenantID)

	// From here on the response is committed as a 200 stream.
	c.Header("Content-Type", "application/x-ndjson")
	// Tell any intermediary not to buffer: a proxy that holds the chunks back
	// until the body completes turns this into the frozen screen it exists to
	// avoid. Nginx honours X-Accel-Buffering specifically.
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	enc := json.NewEncoder(c.Writer)
	write := func(ev streamEvent) {
		// A write error here means the client is gone. There is nothing to
		// recover — the reset continues regardless, deliberately, because
		// stopping half way is worse than finishing unobserved.
		_ = enc.Encode(ev)
		c.Writer.Flush()
	}

	rep, err := demoseed.ResetWithOptions(ctx, h.deps, demoseed.Options{SeedDemo: seedDemo}, func(p demoseed.Progress) {
		write(streamEvent{Step: p.Step, Index: p.Index, Total: p.Total})
	})
	if err != nil {
		write(streamEvent{Error: err.Error()})
		return
	}

	write(streamEvent{Done: true, Report: rep})
}

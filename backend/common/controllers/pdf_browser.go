package controllers

import (
	"context"
	"sync"

	"github.com/chromedp/chromedp"
)

var (
	browserOnce   sync.Once
	browserCtx    context.Context
	browserCancel context.CancelFunc
)

// PDFBrowserContext returns a context tied to a single long-lived headless
// Chrome instance shared by all PDF renderers, instead of launching a new
// browser process per request. Callers should derive a per-request
// chromedp.NewContext (new tab) from this and apply their own timeout.
func PDFBrowserContext() context.Context {
	browserOnce.Do(func() {
		allocCtx, _ := chromedp.NewExecAllocator(context.Background(), chromedp.DefaultExecAllocatorOptions[:]...)
		ctx, cancel := chromedp.NewContext(allocCtx)
		if err := chromedp.Run(ctx); err != nil {
			cancel()
			browserCtx = allocCtx
			browserCancel = cancel
			return
		}
		browserCtx = ctx
		browserCancel = cancel
	})
	return browserCtx
}

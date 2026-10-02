package loan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"time"

	"cloudhouse/backend/internal/platform"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// Page geometry shared by every document this package renders (pledge
// agreements, FORM 7, partial release receipt), so they all come out as the
// same A4 sheet.
//
// The top/bottom margins are the reserved HEADER and FOOTER bands: Chrome
// draws headerTemplate/footerTemplate inside them on every page, and the
// document body never flows into them. The header band is deliberately left
// empty — branches print on their own letterhead, so it is blank space for
// the pre-printed head rather than a line of text.
//
// Paper size is set explicitly rather than via @page CSS: headless
// PrintToPDF defaults to US Letter and does not reliably honour a page's
// own @page rule.
const (
	a4WidthIn      = 8.27
	a4HeightIn     = 11.69
	pageHeaderIn   = 0.75 // header band
	pageFooterIn   = 0.55 // footer band
	pageSideMargin = 0.6
)

// pageHeaderTemplate is an empty element, not an empty string: Chrome
// substitutes its own default header (date + title) for an empty template.
const pageHeaderTemplate = `<div style="font-size:1px"></div>`

const pageFooterTemplate = `
<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,sans-serif;padding-bottom:6px">
Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>`

// renderA4PDF prints a complete HTML document to an A4 PDF via headless
// Chromium. label prefixes errors so the caller's document is named in logs.
//
// base64, not URL-escaping, for the data: URI — QueryEscape turns spaces into
// "+", which Chromium never decodes back inside a data: payload.
func renderA4PDF(htmlDoc, label string) ([]byte, error) {
	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	encoded := base64.StdEncoding.EncodeToString([]byte(htmlDoc))
	var pdfBytes []byte
	err := chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+encoded),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(false).
				WithPaperWidth(a4WidthIn).
				WithPaperHeight(a4HeightIn).
				WithMarginTop(pageHeaderIn).
				WithMarginBottom(pageFooterIn).
				WithMarginLeft(pageSideMargin).
				WithMarginRight(pageSideMargin).
				WithDisplayHeaderFooter(true).
				WithHeaderTemplate(pageHeaderTemplate).
				WithFooterTemplate(pageFooterTemplate).
				Do(ctx)
			if err != nil {
				return err
			}
			pdfBytes = buf
			return nil
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("%s: render PDF (is Chrome/Chromium installed and on PATH?): %w", label, err)
	}
	return pdfBytes, nil
}

// lenderSignature resolves the current business's uploaded lender signature
// as an inline <img> (see tenant.Tenant.SignatureImgHTML). Empty when none is
// set or the tenant cannot be resolved, which prints a blank line for a
// wet-ink signature.
func (s *Service) lenderSignature(ctx context.Context) template.HTML {
	if s.tenantRepo == nil {
		return ""
	}
	id, ok := platform.TenantFromContext(ctx)
	if !ok {
		return ""
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return ""
	}
	return t.SignatureImgHTML(s.uploadsDir)
}

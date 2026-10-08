package loan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"math"
	"strconv"
	"strings"
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
	pdfBytes, _, err := renderA4PDFWithSlots(htmlDoc, label)
	return pdfBytes, err
}

// esignSlotsJS measures every element a template tagged class="esign-slot"
// and returns the stamp's top-left corner in CSS px, plus whether the element
// sits inside a .deed-end block.
//
// The corner is the element's left/top plus data-esign-dx/dy when the template
// gives them; otherwise just right of the element (+6px) and level with its
// top, so the stamp never covers a "name" line above a signature line.
//
// Inside a .deed-end block (the GML deeds' Schedule + signing page, which
// always starts on a fresh sheet) y is measured from the block's top instead
// of the document's, because that block IS the last printed page; h is its
// height, so the caller can tell whether it really fits on one page.
const esignSlotsJS = `Array.from(document.querySelectorAll('.esign-slot')).map(function(e){
	var r=e.getBoundingClientRect(), b=e.closest('.deed-end'), br=b?b.getBoundingClientRect():null;
	var dx=e.getAttribute('data-esign-dx'), dy=e.getAttribute('data-esign-dy');
	return {x: dx!==null ? r.left+parseFloat(dx) : r.right+6,
		y: (br ? r.top-br.top : r.top+window.scrollY) + (dy!==null ? parseFloat(dy) : 0),
		last: !!b, h: br ? br.height : 0}})`

// printableHeightPx is one A4 sheet's printable height in CSS px.
const printableHeightPx = (a4HeightIn - pageHeaderIn - pageFooterIn) * 96

// renderA4PDFWithSlots is renderA4PDF plus the eSign stamp positions of any
// element the template tagged class="esign-slot", converted to PDF points
// from the top-left of the A4 sheet — the coordinates Surepass's initialize
// call expects. The slots are measured with the viewport set to the printable
// width, so line wrapping matches the printed page.
//
// Two layouts can be read reliably off the DOM: a one-page document (the KML
// letters), and a .deed-end block that fits on one sheet and starts the last
// page (the GML deeds). Anything else — a letter that spilled onto a second
// page, a deed block taller than a sheet — returns no slots, and callers fall
// back to the configured default position.
func renderA4PDFWithSlots(htmlDoc, label string) ([]byte, []platform.SignatureSlot, error) {
	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	encoded := base64.StdEncoding.EncodeToString([]byte(htmlDoc))
	var pdfBytes []byte
	var rawSlots []struct {
		X, Y, H float64
		Last    bool
	}
	wantSlots := strings.Contains(htmlDoc, "esign-slot")
	err := chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+encoded),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			if !wantSlots {
				return nil
			}
			printableWidthPx := int64(math.Round((a4WidthIn - 2*pageSideMargin) * 96))
			if err := chromedp.EmulateViewport(printableWidthPx, 1200).Do(ctx); err != nil {
				return err
			}
			return chromedp.Evaluate(esignSlotsJS, &rawSlots).Do(ctx)
		}),
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
		return nil, nil, fmt.Errorf("%s: render PDF (is Chrome/Chromium installed and on PATH?): %w", label, err)
	}

	var slots []platform.SignatureSlot
	pages := CountPDFPages(pdfBytes)
	for _, r := range rawSlots {
		page := 1
		if r.Last {
			page = pages
			if r.H > printableHeightPx {
				slots = nil
				break
			}
		} else if pages != 1 {
			slots = nil
			break
		}
		slots = append(slots, platform.SignatureSlot{
			Page: strconv.Itoa(page),
			X:    int(math.Round(pageSideMargin*72 + r.X*0.75)),
			Y:    int(math.Round(pageHeaderIn*72 + r.Y*0.75)),
		})
	}
	return pdfBytes, slots, nil
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

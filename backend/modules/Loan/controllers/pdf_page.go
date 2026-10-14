package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"context"
	"fmt"
	"html/template"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

const (
	pageSideMargin = 0.6
)

const printableHeightPx = (11.69 - 0.75 - 0.55) * 96

// pageMargins are the PDF margins in inches; the TML pledge-book sheet (marked by tmlSheetMarker)
// is laid out edge-to-edge like the printed original, so it gets tighter margins.
type pageMargins struct{ top, bottom, side float64 }

const tmlSheetMarker = `content="tml-bond"`

func marginsFor(htmlDoc string) pageMargins {
	if strings.Contains(htmlDoc, tmlSheetMarker) {
		return pageMargins{top: 0.25, bottom: 0.4, side: 0.3}
	}
	return pageMargins{top: 0.75, bottom: 0.55, side: pageSideMargin}
}

func renderA4PDF(htmlDoc, label string) ([]byte, error) {
	pdfBytes, _, err := renderA4PDFWithSlots(htmlDoc, label)
	return pdfBytes, err
}

func renderA4PDFWithSlots(htmlDoc, label string) ([]byte, []config.SignatureSlot, error) {
	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var pdfBytes []byte
	var rawSlots []struct {
		X, Y, H float64
		Last    bool
		Role    string
	}
	wantSlots := strings.Contains(htmlDoc, "esign-slot")
	m := marginsFor(htmlDoc)
	err := chromedp.Run(ctx,
		// Set the document directly: a data: URL fails to load once the page embeds
		// photos (Chrome caps navigable data URLs at about 2 MB).
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			tree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}
			return page.SetDocumentContent(tree.Frame.ID, htmlDoc).Do(ctx)
		}),
		chromedp.WaitReady("body"),
		chromedp.Evaluate(`Promise.all(Array.from(document.images).map(function(i){return i.complete?1:new Promise(function(r){i.onload=i.onerror=r})}))`, nil, func(p *runtime.EvaluateParams) *runtime.EvaluateParams { return p.WithAwaitPromise(true) }),
		chromedp.ActionFunc(func(ctx context.Context) error {
			if !wantSlots {
				return nil
			}
			printableWidthPx := int64(math.Round((8.27 - 2*m.side) * 96))
			if err := chromedp.EmulateViewport(printableWidthPx, 1200).Do(ctx); err != nil {
				return err
			}
			return chromedp.Evaluate(`Array.from(document.querySelectorAll('.esign-slot')).map(function(e){
	var r=e.getBoundingClientRect(), b=e.closest('.deed-end'), br=b?b.getBoundingClientRect():null;
	var dx=e.getAttribute('data-esign-dx'), dy=e.getAttribute('data-esign-dy');
	return {x: dx!==null ? r.left+parseFloat(dx) : r.right+6,
		y: (br ? r.top-br.top : r.top+window.scrollY) + (dy!==null ? parseFloat(dy) : 0),
		last: !!b, h: br ? br.height : 0, role: e.getAttribute('data-esign-role')||''}})`, &rawSlots).Do(ctx)
		}),
		chromedp.ActionFunc(func(ctx context.Context) error {
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(false).
				WithPaperWidth(8.27).
				WithPaperHeight(11.69).
				WithMarginTop(m.top).
				WithMarginBottom(m.bottom).
				WithMarginLeft(m.side).
				WithMarginRight(m.side).
				WithDisplayHeaderFooter(true).
				WithHeaderTemplate(`<div style="font-size:1px"></div>`).
				WithFooterTemplate(`
<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,sans-serif;padding-bottom:6px">
Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>`).
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
	var slots []config.SignatureSlot
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
		slots = append(slots, config.SignatureSlot{
			Page: strconv.Itoa(page),
			X:    int(math.Round(m.side*72 + r.X*0.75)),
			Y:    int(math.Round(m.top*72 + r.Y*0.75)),
			Role: r.Role,
		})
	}
	return pdfBytes, slots, nil
}

func lenderSignature(ctx context.Context) template.HTML {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return ""
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return ""
	}
	return common.TenantSignatureImgHTML(t, config.Env.UploadsDir)
}

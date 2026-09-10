package cash

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// tablePDFTemplate is a plain, print-friendly HTML table — same
// chromedp-driven "render HTML, then PrintToPDF" approach
// internal/loan/indemnitybond.go's RenderIndemnityBondPDF already
// established for the pledge agreement, reused here so a second PDF
// renderer (e.g. a native Go PDF library) isn't introduced just for a
// plain table export.
var tablePDFTemplate = template.Must(template.New("tablePDF").Parse(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#231f18;margin:0;padding:0}
  h1{font-size:16px;margin:0 0 4px}
  p.meta{font-size:10px;color:#666;margin:0 0 14px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top;word-break:break-word}
  th{background:#f3ede1;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em}
  tr:nth-child(even) td{background:#fafaf7}
</style></head>
<body>
  <h1>{{.Title}}</h1>
  <p class="meta">Generated {{.GeneratedAt}}{{if .FilterNote}} · {{.FilterNote}}{{end}} · {{.RowCount}} row{{if ne .RowCount 1}}s{{end}}</p>
  <table>
    <thead><tr>{{range .Headers}}<th>{{.}}</th>{{end}}</tr></thead>
    <tbody>
      {{range .Rows}}<tr>{{range .}}<td>{{.}}</td>{{end}}</tr>{{end}}
    </tbody>
  </table>
</body></html>`))

type tablePDFData struct {
	Title       string
	GeneratedAt string
	FilterNote  string
	RowCount    int
	Headers     []string
	Rows        [][]string
}

// renderTablePDF turns a plain header+rows table into a landscape A4 PDF via
// a headless Chromium tab (chromedp) — requires a Chrome/Chromium binary on
// the host, same requirement RenderIndemnityBondPDF already has.
func renderTablePDF(title, filterNote string, headers []string, rows [][]string) ([]byte, error) {
	var sb strings.Builder
	if err := tablePDFTemplate.Execute(&sb, tablePDFData{
		Title:       title,
		GeneratedAt: time.Now().Format("02 Jan 2006, 15:04"),
		FilterNote:  filterNote,
		RowCount:    len(rows),
		Headers:     headers,
		Rows:        rows,
	}); err != nil {
		return nil, err
	}

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	encoded := base64.StdEncoding.EncodeToString([]byte(sb.String()))
	var pdfBytes []byte
	err := chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+encoded),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			// Landscape A4 — a wide table (many columns) fits far better
			// landscape than the pledge agreement's portrait letter/A4.
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(false).
				WithLandscape(true).
				WithPaperWidth(11.69).
				WithPaperHeight(8.27).
				WithMarginTop(0.5).
				WithMarginBottom(0.5).
				WithMarginLeft(0.5).
				WithMarginRight(0.5).
				Do(ctx)
			if err != nil {
				return err
			}
			pdfBytes = buf
			return nil
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("export: render PDF (is Chrome/Chromium installed and on PATH?): %w", err)
	}
	return pdfBytes, nil
}

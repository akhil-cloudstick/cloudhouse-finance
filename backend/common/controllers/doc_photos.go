package controllers

import (
	"bytes"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"encoding/base64"
	"html/template"
	"image"
	_ "image/gif"  // DecodeConfig: size check of uploaded photos
	_ "image/jpeg" // ″
	_ "image/png"  // ″
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/chromedp/chromedp"
)

// "Images on documents" (module print_images): when a business has the module, its printed
// documents carry the customer photo and the ornament photos. Images are optional decoration —
// they may never add a page, so every renderer runs FitDocPhotos before printing.

// MaxDocPhotoBytes caps one inlined image so a single huge upload cannot bloat the PDF.
const MaxDocPhotoBytes = 3 << 20

// MinDocPhotoPx is the smallest width/height printed; anything smaller is a placeholder, not a photo.
const MinDocPhotoPx = 16

// UploadDataURL inlines a stored upload ("/uploads/<key>") as a data: URL so the
// headless-Chrome render needs no network or auth. Empty when missing, not an image or too big.
func UploadDataURL(tenantID uint, url string) template.URL {
	if config.Env.UploadsDir == "" || strings.TrimSpace(url) == "" {
		return ""
	}
	key := strings.TrimPrefix(url, "/uploads/")
	b, err := os.ReadFile(ResolvePath(config.Env.UploadsDir, tenantID, key))
	if err != nil || len(b) == 0 || len(b) > MaxDocPhotoBytes {
		return ""
	}
	ct := http.DetectContentType(b)
	if !strings.HasPrefix(ct, "image/") {
		return ""
	}
	// A placeholder (the demo data's 1x1 "photos") prints as an empty framed box: skip it.
	// Formats Go cannot read (e.g. WebP) are kept as they are.
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(b)); err == nil && (cfg.Width < MinDocPhotoPx || cfg.Height < MinDocPhotoPx) {
		return ""
	}
	return template.URL("data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(b)) //nolint:gosec // sniffed image MIME + base64 only
}

// PrintImagesOn reports whether the request's business prints images on its documents.
// Any lookup failure means "off", so documents fall back to today's layout.
func PrintImagesOn(ctx context.Context) bool {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return false
	}
	on, err := HasModule(ctx, id, commonModels.ModulePrintImages)
	return err == nil && on
}

// DocPhotosStyle is appended to every document's stylesheet. The photo block is a fixed-width side
// column next to an existing block (.doc-photo-row); its content is absolutely positioned and clipped,
// so it adds no height — it only fills the blank space beside that block. Photo cells in ornament
// tables are capped to a text row's height. The data-doc-photos attribute on <html> is set by
// FitDocPhotos: "small" narrows the column (less text re-wrap), "off" hides all images.
const DocPhotosStyle = `
.doc-photo-row{display:flex;gap:10px}
.doc-photo-row>.doc-photo-main{flex:1;min-width:0}
.doc-photos{--dps:1;flex:0 0 calc(116px*var(--dps));position:relative}
.doc-photos-in{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;display:flex;flex-wrap:wrap;gap:3px;align-content:flex-start;justify-content:flex-end}
.doc-photos img{object-fit:cover;border:1px solid #999;display:block;box-sizing:border-box}
.doc-photos .dp-customer{width:calc(80px*var(--dps));height:calc(96px*var(--dps));max-height:100%}
.doc-photos .dp-thumb{width:calc(36px*var(--dps));height:calc(36px*var(--dps))}
.doc-photo-cell img{height:18px;width:24px;object-fit:cover;display:inline-block;vertical-align:middle}
html[data-doc-photos=small] .doc-photos{--dps:.6}
html[data-doc-photos=off] .doc-photos,html[data-doc-photos=off] .doc-photo-cell img{display:none!important}
`

// DocPhotosHTML builds the side photo column: customer photo first, then the overall jewel photo
// and the ornament thumbnails. Empty when there is no image at all, so templates print nothing.
// Every src is a sniffed image data: URL from UploadDataURL.
func DocPhotosHTML(customer template.URL, thumbs ...template.URL) template.HTML {
	var b strings.Builder
	if customer != "" {
		b.WriteString(`<img class="dp-customer" src="` + string(customer) + `" alt="">`)
	}
	for _, t := range thumbs {
		if t != "" {
			b.WriteString(`<img class="dp-thumb" src="` + string(t) + `" alt="">`)
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return template.HTML(`<div class="doc-photos"><div class="doc-photos-in">` + b.String() + `</div></div>`) //nolint:gosec // srcs are base64 image data URLs only
}

var docPDFPagePattern = regexp.MustCompile(`(?s)/Type\s*/Page[^s]`)

func docPDFPages(pdf []byte) int {
	if n := len(docPDFPagePattern.FindAllIndex(pdf, -1)); n > 0 {
		return n
	}
	return 1
}

// FitDocPhotos runs inside a chromedp session after the document (and its images) has loaded and
// before slot measurement / the final print. It prints once without images to get the page count
// the document has today, then keeps the images only at the largest size that does not add a page:
// full size, then shrunk, else hidden. A document with no .doc-photos markup is left untouched.
func FitDocPhotos(ctx context.Context, print func(context.Context) ([]byte, error)) error {
	var has bool
	if err := chromedp.Evaluate(`!!document.querySelector('.doc-photos,.doc-photo-cell')`, &has).Do(ctx); err != nil || !has {
		return err
	}
	set := func(mode string) error {
		return chromedp.Evaluate(`document.documentElement.setAttribute('data-doc-photos',`+"'"+mode+"'"+`);1`, nil).Do(ctx)
	}
	pagesWith := func(mode string) (int, error) {
		if err := set(mode); err != nil {
			return 0, err
		}
		pdf, err := print(ctx)
		if err != nil {
			return 0, err
		}
		return docPDFPages(pdf), nil
	}
	base, err := pagesWith("off")
	if err != nil {
		return err
	}
	for _, mode := range []string{"on", "small"} {
		n, err := pagesWith(mode)
		if err != nil {
			return err
		}
		if n <= base {
			return nil
		}
	}
	return set("off")
}

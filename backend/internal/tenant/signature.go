package tenant

import (
	"encoding/base64"
	"html/template"
	"net/http"
	"os"
	"strings"

	"cloudhouse/backend/internal/upload"
)

// SignatureImage reads this business's uploaded lender signature from disk
// and returns its bytes and sniffed content type. ok is false when no
// signature has been uploaded or the file cannot be read.
//
// The key comes from the tenant row, never from a caller, so the only file
// this can return is the one the vendor nominated for this business.
// upload.ResolvePath handles both the per-tenant and the legacy flat layout,
// same as the logo route.
func (t *Tenant) SignatureImage(uploadsRoot string) (data []byte, contentType string, ok bool) {
	if t == nil || t.SignatureStorageKey == "" || uploadsRoot == "" {
		return nil, "", false
	}
	b, err := os.ReadFile(upload.ResolvePath(uploadsRoot, t.ID, t.SignatureStorageKey))
	if err != nil || len(b) == 0 {
		return nil, "", false
	}
	ct := http.DetectContentType(b)
	if !strings.HasPrefix(ct, "image/") {
		return nil, "", false
	}
	return b, ct, true
}

// SignatureImgHTML returns the lender signature as an inline <img> carrying
// a data: URI, ready to drop into a chromedp-rendered document. Inlined
// rather than linked because headless Chrome renders from a data: URL with
// no session, so it could not fetch an authenticated upload anyway.
//
// Returns "" when no signature is set, which leaves the signature line blank
// for a wet-ink signature — never another business's or a demo signature.
func (t *Tenant) SignatureImgHTML(uploadsRoot string) template.HTML {
	data, ct, ok := t.SignatureImage(uploadsRoot)
	if !ok {
		return ""
	}
	// ct is from http.DetectContentType and the payload is base64, so
	// neither can break out of the attribute.
	return template.HTML(`<img class="sig-img" alt="" src="data:` + ct + `;base64,` + //nolint:gosec // sniffed MIME + base64 only
		base64.StdEncoding.EncodeToString(data) + `">`)
}

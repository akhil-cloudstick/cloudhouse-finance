package upload

import (
	"bytes"
	"net/http"
	"strings"

	"cloudhouse/backend/internal/platform/httpx"
)

// MaxUploadBytes caps a single file. Customer photos, KYC scans and ornament
// images all sit comfortably below this; the cap exists so one business
// cannot fill the disk shared by all of them.
const MaxUploadBytes = 10 << 20 // 10 MB

var (
	ErrFileTooLarge = httpx.NewBadRequest("file is too large (maximum 10 MB)")
	ErrFileType     = httpx.NewBadRequest("unsupported file type — upload a JPEG, PNG, WebP or PDF")
	ErrFileEmpty    = httpx.NewBadRequest("file is empty")
)

// allowedTypes is what may be stored, decided by SNIFFED content.
//
// SVG is deliberately absent, and it is the important omission. An SVG is
// not an image in the sense the word implies — it is a document that can
// carry <script>, and browsers execute it when the file is opened directly
// or embedded. Serving one from this origin means running attacker-supplied
// script with the viewer's session, so an uploaded "logo" becomes a way to
// act as whoever opens it. There is no safe way to serve arbitrary SVG from
// the same origin as the app, so it is refused rather than sanitised.
var allowedTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/webp":      true,
	"application/pdf": true,
}

// DetectContentType identifies a file from its first bytes.
//
// The upload's own Content-Type header and its extension are both supplied
// by the caller: a file named photo.jpg, declared image/jpeg, containing
// HTML, is trivially produced. Only the bytes are evidence, so only the
// bytes are consulted.
func DetectContentType(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	ct := http.DetectContentType(data)
	// DetectContentType returns e.g. "text/plain; charset=utf-8".
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	return strings.TrimSpace(ct)
}

// ValidateBytes enforces size and type. Returns the sniffed content type on
// success, which is what gets recorded and later served — so the type a file
// is served as always matches what it actually contained at upload.
func ValidateBytes(data []byte) (string, error) {
	if len(data) == 0 {
		return "", ErrFileEmpty
	}
	if len(data) > MaxUploadBytes {
		return "", ErrFileTooLarge
	}

	ct := DetectContentType(data)

	// Explicitly catch SVG before the allow-list, so the rejection is
	// deliberate and greppable rather than incidental. http.DetectContentType
	// reports SVG as "text/xml" or "text/plain" depending on the prolog, and
	// both would be refused anyway — but a future widening of the allow-list
	// must not quietly let it back in.
	if isSVG(data) {
		return "", ErrFileType
	}

	if !allowedTypes[ct] {
		return "", ErrFileType
	}
	return ct, nil
}

// isSVG looks for an <svg root element within the leading bytes, past any
// XML prolog, comments or whitespace.
func isSVG(data []byte) bool {
	head := data
	if len(head) > 1024 {
		head = head[:1024]
	}
	lower := bytes.ToLower(head)
	return bytes.Contains(lower, []byte("<svg"))
}

// Package qr is a small, stateless QR-code-image endpoint. It exists so
// mobile (which has no QR-generation library — see the packet-label print
// feature in mobile/src/utils/loanPrint.ts) can get the same PNG the web
// app builds client-side (via the "qrcode" npm package's toDataURL) from
// the backend instead: no model/service/repository, just bytes in, PNG out.
package qr

import (
	"net/http"

	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"

	"cloudhouse/backend/internal/platform/httpx"
)

// maxDataLen bounds the "data" query param — QR codes have a hard capacity
// ceiling per their version/error-correction level anyway (skip2/go-qrcode
// errors past ~2900 bytes at Medium), but reject an absurdly long value
// before even attempting encoding rather than surfacing that library error.
const maxDataLen = 2048

// defaultSize/maxSize bound the "size" query param (PNG side length in
// pixels) — 256 matches what the web app's packet-label print already
// requests (toDataURL({width:256}) in LoanDetail.tsx/NewLoan.tsx), maxSize
// is just a sanity ceiling against an accidental/malicious huge render.
const (
	defaultSize = 256
	maxSize     = 1024
)

type Handler struct{}

func NewHandler() *Handler { return &Handler{} }

// Generate handles GET /qr?data=<text>&size=<px>, returning a PNG image
// (Medium error-correction, matching the web app's errorCorrectionLevel:
// "M"). `data` is required; `size` optional (defaults to 256px square).
func (h *Handler) Generate(c *gin.Context) {
	data := c.Query("data")
	if data == "" {
		httpx.Fail(c, http.StatusBadRequest, "missing required \"data\" query param")
		return
	}
	if len(data) > maxDataLen {
		httpx.Fail(c, http.StatusBadRequest, "\"data\" is too long to encode as a QR code")
		return
	}

	size := defaultSize
	if s := c.Query("size"); s != "" {
		if n, err := parsePositiveInt(s); err == nil && n > 0 && n <= maxSize {
			size = n
		}
		// An invalid/out-of-range size silently falls back to the default
		// rather than erroring — this is a display parameter, not user
		// input that needs strict validation.
	}

	png, err := qrcode.Encode(data, qrcode.Medium, size)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	// Long cache: the same (data,size) pair always encodes to the exact
	// same PNG bytes, so the client (or a CDN in front of this) can cache
	// it indefinitely rather than re-requesting/re-encoding every print.
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Data(http.StatusOK, "image/png", png)
}

func parsePositiveInt(s string) (int, error) {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, httpx.NewBadRequest("not a number")
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}

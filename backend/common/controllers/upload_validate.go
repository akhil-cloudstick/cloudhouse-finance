package controllers

import (
	"bytes"
	"net/http"
	"strings"
)

const MaxUploadBytes = 10 << 20

var allowedTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/webp":      true,
	"application/pdf": true,
}

func DetectContentType(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	ct := http.DetectContentType(data)
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	return strings.TrimSpace(ct)
}

func ValidateBytes(data []byte) (string, error) {
	if len(data) == 0 {
		return "", NewBadRequest("file is empty")
	}
	if len(data) > MaxUploadBytes {
		return "", NewBadRequest("file is too large (maximum 10 MB)")
	}
	ct := DetectContentType(data)
	if isSVG(data) {
		return "", NewBadRequest("unsupported file type — upload a JPEG, PNG, WebP or PDF")
	}
	if !allowedTypes[ct] {
		return "", NewBadRequest("unsupported file type — upload a JPEG, PNG, WebP or PDF")
	}
	return ct, nil
}

func isSVG(data []byte) bool {
	head := data
	if len(head) > 1024 {
		head = head[:1024]
	}
	lower := bytes.ToLower(head)
	return bytes.Contains(lower, []byte("<svg"))
}

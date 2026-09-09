// Package upload implements a small, shared file-upload endpoint used by
// Customer's photo/KYC-document fields and (going forward) the ornament
// photo fix in NewLoan.tsx. Files are written to local disk under
// platform.Config.UploadsDir and served back via a static route registered
// in main.go — see architecture.md's File Uploads note. This is deliberately
// storage-only (no model/service/repository): swapping to real object
// storage (S3/GCS) later only means changing this one file.
package upload

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler saves uploaded files under Dir and reports back a URL path
// (relative to the server root) they can be fetched from again.
type Handler struct {
	Dir  string
	repo *Repository
}

func NewHandler(dir string, repo *Repository) *Handler {
	return &Handler{Dir: dir, repo: repo}
}

var unsafeNameChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func randomID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Upload accepts one multipart file under the "file" field and returns
// {"url": "/uploads/<id>-<sanitized-filename>"}.
//
// The bytes are read into memory and validated BEFORE anything touches
// disk: a rejected file is never written, so a hostile upload leaves
// nothing behind even briefly. MaxUploadBytes bounds what is read.
func (h *Handler) Upload(c *gin.Context) {
	ctx := platform.RequestContext(c)

	fileHeader, err := c.FormFile("file")
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "no file provided (expected multipart field \"file\")")
		return
	}
	if fileHeader.Size > MaxUploadBytes {
		httpx.FailErr(c, ErrFileTooLarge)
		return
	}

	src, err := fileHeader.Open()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	defer src.Close()

	// Read one byte past the cap so a file exactly at the limit still
	// passes while anything larger is caught, even if the declared Size lied.
	data, err := io.ReadAll(io.LimitReader(src, MaxUploadBytes+1))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	contentType, err := ValidateBytes(data)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	id, err := randomID()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	safeName := unsafeNameChars.ReplaceAllString(filepath.Base(fileHeader.Filename), "_")
	if safeName == "" || safeName == "." {
		safeName = "file"
	}
	filename := fmt.Sprintf("%s-%s", id, safeName)

	if err := os.MkdirAll(h.Dir, 0o755); err != nil {
		httpx.FailErr(c, err)
		return
	}

	dest := filepath.Join(h.Dir, filename)
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		httpx.FailErr(c, err)
		return
	}

	// The record is what makes the file readable again: ServeHandler resolves
	// /uploads/<key> through it and refuses anything with no matching row in
	// the caller's business. Written after the bytes land, so a row never
	// points at a file that is not there.
	if h.repo != nil {
		actorID, _, _ := platform.ActorFromContext(c)
		var uploadedBy *uint
		if actorID != 0 {
			uploadedBy = &actorID
		}
		rec := &File{
			StorageKey:           filename,
			OriginalName:         fileHeader.Filename,
			ContentType:          contentType,
			SizeBytes:            int64(len(data)),
			UploadedByEmployeeID: uploadedBy,
		}
		if err := h.repo.Create(ctx, rec); err != nil {
			// The row is the authorization record; without it the file is
			// unreachable anyway. Remove the orphan rather than leaving
			// bytes on disk nothing accounts for.
			_ = os.Remove(dest)
			httpx.FailErr(c, err)
			return
		}
	}

	httpx.Success(c, http.StatusCreated, gin.H{"url": "/uploads/" + strings.TrimPrefix(filename, "/")})
}

// SaveBytes writes data to dir under a random-id-prefixed, sanitized name
// (same naming convention Upload uses) and returns its "/uploads/..."-style
// URL. Unlike Upload, this isn't a gin.HandlerFunc — it's a plain function
// other services (e.g. internal/loan's indemnity-bond eSign flow) call
// directly to store a file they generated or fetched server-side, without
// going through an HTTP multipart request.
func SaveBytes(dir, name string, data []byte) (string, error) {
	id, err := randomID()
	if err != nil {
		return "", fmt.Errorf("failed to generate file id: %w", err)
	}

	safeName := unsafeNameChars.ReplaceAllString(filepath.Base(name), "_")
	if safeName == "" || safeName == "." {
		safeName = "file"
	}
	filename := fmt.Sprintf("%s-%s", id, safeName)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("failed to prepare uploads directory: %w", err)
	}

	dest := filepath.Join(dir, filename)
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return "", fmt.Errorf("failed to save file: %w", err)
	}

	return "/uploads/" + strings.TrimPrefix(filename, "/"), nil
}

// SaveBytesRecorded is SaveBytes plus the database record that makes the
// file readable again.
//
// Server-generated files (the signed indemnity bond) go through here rather
// than SaveBytes. Without a record, ServeHandler cannot resolve the file and
// it is silently unreachable — the bond would be written, linked from the
// loan, and 404 on every attempt to open it.
//
// The tenant is taken from ctx and stamped by the create callback, so a
// generated file lands in the same business as the loan that produced it.
func SaveBytesRecorded(ctx context.Context, repo *Repository, dir, name string, data []byte) (string, error) {
	contentType, err := ValidateBytes(data)
	if err != nil {
		return "", err
	}

	url, err := SaveBytes(dir, name, data)
	if err != nil {
		return "", err
	}
	if repo == nil {
		return url, nil
	}

	key := strings.TrimPrefix(url, "/uploads/")
	rec := &File{
		StorageKey:   key,
		OriginalName: name,
		ContentType:  contentType,
		SizeBytes:    int64(len(data)),
	}
	if err := repo.Create(ctx, rec); err != nil {
		_ = os.Remove(filepath.Join(dir, key))
		return "", err
	}
	return url, nil
}

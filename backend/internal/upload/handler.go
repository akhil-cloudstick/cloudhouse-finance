// Package upload implements a small, shared file-upload endpoint used by
// Customer's photo/KYC-document fields and (going forward) the ornament
// photo fix in NewLoan.tsx. Files are written to local disk under
// platform.Config.UploadsDir and served back via a static route registered
// in main.go — see architecture.md's File Uploads note. This is deliberately
// storage-only (no model/service/repository): swapping to real object
// storage (S3/GCS) later only means changing this one file.
package upload

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler saves uploaded files under Dir and reports back a URL path
// (relative to the server root) they can be fetched from again.
type Handler struct {
	Dir string
}

func NewHandler(dir string) *Handler {
	return &Handler{Dir: dir}
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
func (h *Handler) Upload(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided (expected multipart field \"file\")"})
		return
	}

	id, err := randomID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate file id"})
		return
	}

	safeName := unsafeNameChars.ReplaceAllString(filepath.Base(fileHeader.Filename), "_")
	if safeName == "" || safeName == "." {
		safeName = "file"
	}
	filename := fmt.Sprintf("%s-%s", id, safeName)

	if err := os.MkdirAll(h.Dir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to prepare uploads directory"})
		return
	}

	dest := filepath.Join(h.Dir, filename)
	if err := c.SaveUploadedFile(fileHeader, dest); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"url": "/uploads/" + strings.TrimPrefix(filename, "/")})
}

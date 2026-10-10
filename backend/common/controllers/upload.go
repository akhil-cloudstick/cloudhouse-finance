package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
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

	"github.com/labstack/echo/v4"
)

var unsafeNameChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func randomID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

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

func SaveBytesRecorded(ctx context.Context, dir, name string, data []byte) (string, error) {
	contentType, err := ValidateBytes(data)
	if err != nil {
		return "", err
	}
	tenantDir, err := tenantDirFromContext(ctx, dir)
	if err != nil {
		return "", err
	}
	url, err := SaveBytes(tenantDir, name, data)
	if err != nil {
		return "", err
	}
	key := strings.TrimPrefix(url, "/uploads/")
	rec := &commonModels.File{
		StorageKey:   key,
		OriginalName: name,
		ContentType:  contentType,
		SizeBytes:    int64(len(data)),
	}
	if err := insertUpload(ctx, rec); err != nil {
		_ = os.Remove(filepath.Join(tenantDir, key))
		return "", err
	}
	return url, nil
}

func insertUpload(ctx context.Context, f *commonModels.File) error {
	return config.DB.
		WithContext(ctx).Create(f).Error
}

func findByStorageKey(ctx context.Context, key string) (*commonModels.File, error) {
	var f commonModels.File
	if err := config.DB.
		WithContext(ctx).Where("storage_key = ?", key).First(&f).Error; err != nil {
		return nil, err
	}
	return &f, nil
}

func UploadFile(c echo.Context) error {
	ctx := auth.RequestContext(c)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "no file provided (expected multipart field \"file\")"})
	}
	if fileHeader.Size > MaxUploadBytes {
		return FailErr(c, NewBadRequest("file is too large (maximum 10 MB)"))
	}
	src, err := fileHeader.Open()
	if err != nil {
		return FailErr(c, err)
	}
	defer src.Close()
	data, err := io.ReadAll(io.LimitReader(src, MaxUploadBytes+1))
	if err != nil {
		return FailErr(c, err)
	}
	contentType, err := ValidateBytes(data)
	if err != nil {
		return FailErr(c, err)
	}
	id, err := randomID()
	if err != nil {
		return FailErr(c, err)
	}
	safeName := unsafeNameChars.ReplaceAllString(filepath.Base(fileHeader.Filename), "_")
	if safeName == "" || safeName == "." {
		safeName = "file"
	}
	filename := fmt.Sprintf("%s-%s", id, safeName)
	dir, err := tenantDirFromContext(ctx, config.Env.UploadsDir)
	if err != nil {
		return FailErr(c, err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return FailErr(c, err)
	}
	dest := filepath.Join(dir, filename)
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return FailErr(c, err)
	}
	{
		actorID, _, _ := auth.ActorFromContext(c)
		var uploadedBy *uint
		if actorID != 0 {
			uploadedBy = &actorID
		}
		rec := &commonModels.File{
			StorageKey:           filename,
			OriginalName:         fileHeader.Filename,
			ContentType:          contentType,
			SizeBytes:            int64(len(data)),
			UploadedByEmployeeID: uploadedBy,
		}
		if err := insertUpload(ctx, rec); err != nil {
			_ = os.Remove(dest)
			return FailErr(c, err)
		}
	}
	return Success(c, http.StatusOK, echo.Map{"url": "/uploads/" + strings.TrimPrefix(filename, "/")})
}

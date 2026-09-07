package upload

import (
	"time"

	"ambikagold/backend/internal/platform"
)

// File is the record behind every uploaded file: customer photos, KYC
// documents, ornament images, expense receipts, signed indemnity bonds.
//
// Before this existed, files were served straight off disk by
// router.Static("/uploads") with NO authentication of any kind — anyone
// holding or guessing a URL could read another business's customer identity
// documents, logged out entirely. The record is what makes an authorization
// decision possible at all: without a row saying who owns a file, there is
// nothing to check a request against.
//
// # Why the record, and not a folder per business
//
// Serving from /uploads/<business>/<file> looks like isolation but is not:
// the path comes from the request, so it invites traversal ("../"), and any
// bug in path handling becomes a cross-business read. Here the path is never
// trusted — StorageKey is looked up as an exact value in this table, and the
// answer to "may you read this" comes from the row's TenantID, not from the
// URL. That removes the entire class of path attacks rather than defending
// against it.
type File struct {
	platform.TenantScoped
	ID uint `json:"id" gorm:"primaryKey"`

	// StorageKey is the on-disk filename, and the value the public URL
	// (/uploads/<key>) resolves against. Unique so a lookup can never be
	// ambiguous.
	StorageKey string `json:"storageKey" gorm:"not null;size:255;index"`

	// OriginalName is what the uploader called it, kept for display and
	// download only. Never used to build a path.
	OriginalName string `json:"originalName" gorm:"size:255"`

	// ContentType is detected by SNIFFING THE BYTES, not taken from the
	// upload's Content-Type header or the file extension — both are supplied
	// by the caller and neither is evidence of anything.
	ContentType string `json:"contentType" gorm:"size:120"`
	SizeBytes   int64  `json:"sizeBytes"`

	// UploadedByEmployeeID is nil for files a borrower uploaded through the
	// customer app, which has no employee actor.
	UploadedByEmployeeID *uint `json:"uploadedByEmployeeId,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
}

func (File) TableName() string { return "uploaded_files" }

package models

import (
	"cloudhouse/backend/config"
	"time"
)

type File struct {
	config.TenantScoped
	ID                   uint      `json:"id" gorm:"primaryKey"`
	StorageKey           string    `json:"storage_key" gorm:"not null;size:255;index"`
	OriginalName         string    `json:"original_name" gorm:"size:255"`
	ContentType          string    `json:"content_type" gorm:"size:120"`
	SizeBytes            int64     `json:"size_bytes"`
	UploadedByEmployeeID *uint     `json:"uploaded_by_employee_id,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
}

func (File) TableName() string { return "uploaded_files" }

package models

import (
	"time"
)

const (
	CategoryNotification Category = "notification"
	CategorySMS          Category = "sms"
	CategoryWhatsApp     Category = "whatsapp"
	CategoryKYC          Category = "kyc_verification"
	CategoryAadhaar      Category = "aadhaar_verification"
	CategoryPAN          Category = "pan_verification"
)

var AllCategories = []Category{
	CategoryNotification,
	CategorySMS,
	CategoryWhatsApp,
	CategoryKYC,
	CategoryAadhaar,
	CategoryPAN,
}

type Category string

type ApiKeySetting struct {
	ID             uint      `json:"-" gorm:"primaryKey"`
	Category       string    `json:"category" gorm:"uniqueIndex;not null;size:40"`
	Name           string    `json:"name" gorm:"size:120"`
	EncryptedValue string    `json:"-" gorm:"type:text"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

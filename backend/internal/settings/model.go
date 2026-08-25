// Package settings implements the admin-only Settings page
// (frontend/components/Settings.tsx): storage for third-party integration
// API keys (Notifications, SMS, WhatsApp, KYC/Aadhaar/PAN verification).
// Values are encrypted at rest (see internal/platform.Cipher) and are not
// wired to any actual provider yet — this is storage only.
package settings

import "time"

// Category enumerates the fixed set of integrations the Settings page
// manages. Unlike Branch or Employee, this is a closed list, not an
// admin-extensible one.
type Category string

const (
	CategoryNotification Category = "notification"
	CategorySMS          Category = "sms"
	CategoryWhatsApp     Category = "whatsapp"
	CategoryKYC          Category = "kyc_verification"
	CategoryAadhaar      Category = "aadhaar_verification"
	CategoryPAN          Category = "pan_verification"
)

// AllCategories lists every supported category, in the order the Settings
// page should display them.
var AllCategories = []Category{
	CategoryNotification,
	CategorySMS,
	CategoryWhatsApp,
	CategoryKYC,
	CategoryAadhaar,
	CategoryPAN,
}

func (c Category) Valid() bool {
	for _, known := range AllCategories {
		if c == known {
			return true
		}
	}
	return false
}

// ApiKeySetting is one row per Category, upserted as the admin sets/updates
// it. Value is stored encrypted (EncryptedValue); Name is the admin's own
// label for the key (e.g. "Twilio prod key"), not encrypted.
type ApiKeySetting struct {
	ID             uint      `json:"-" gorm:"primaryKey"`
	Category       string    `json:"category" gorm:"uniqueIndex;not null;size:40"`
	Name           string    `json:"name" gorm:"size:120"`
	EncryptedValue string    `json:"-" gorm:"type:text"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (ApiKeySetting) TableName() string {
	return "api_key_settings"
}

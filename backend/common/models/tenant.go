package models

import (
	"time"

	"gorm.io/gorm"
)

const (
	StatusActive    = "active"
	StatusSuspended = "suspended"
)

const UnlimitedBranches uint = 0

type Tier struct {
	ID             uint      `json:"id" gorm:"primaryKey"`
	Name           string    `json:"name" gorm:"uniqueIndex;not null;size:60"`
	BranchQuota    uint      `json:"branch_quota" gorm:"not null;default:1"`
	PriceInPaise   int64     `json:"price_in_paise" gorm:"not null;default:0"`
	RazorpayPlanID string    `json:"-" gorm:"size:64"`
	IsActive       bool      `json:"is_active" gorm:"not null;default:true"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type Tenant struct {
	ID                     uint           `json:"id" gorm:"primaryKey"`
	Name                   string         `json:"name" gorm:"not null;size:160"`
	Code                   string         `json:"code" gorm:"uniqueIndex;not null;size:32"`
	TierID                 uint           `json:"tier_id" gorm:"not null;index"`
	Tier                   Tier           `json:"tier,omitempty" gorm:"foreignKey:TierID"`
	Status                 string         `json:"status" gorm:"not null;size:20;default:'active';index"`
	SubscriptionExpiresAt  *time.Time     `json:"subscription_expires_at,omitempty"`
	GracePeriodEndsAt      *time.Time     `json:"grace_period_ends_at,omitempty"`
	RazorpaySubscriptionID string         `json:"-" gorm:"size:64;index"`
	SubscriptionNotifiedAt *time.Time     `json:"-"`
	LegalName              string         `json:"legal_name" gorm:"size:200"`
	ShortName              string         `json:"short_name" gorm:"size:40"`
	LockupTagline          string         `json:"lockup_tagline" gorm:"size:120"`
	AddressLine            string         `json:"address_line" gorm:"size:300"`
	KMLRegNo               string         `json:"kml_reg_no" gorm:"size:60"`
	ContactPhone           string         `json:"contact_phone" gorm:"size:120"`
	LenderAge              string         `json:"lender_age" gorm:"size:3"`
	LenderPAN              string         `json:"lender_pan" gorm:"size:10"`
	LenderAadhaar          string         `json:"lender_aadhaar" gorm:"size:12"`
	Policy                 string         `json:"policy" gorm:"size:20"`
	AppURL                 string         `json:"app_url" gorm:"size:200"`
	BrandColor             string         `json:"brand_color" gorm:"size:9"`
	SecondaryColor         string         `json:"secondary_color" gorm:"size:9"`
	AccentColor            string         `json:"accent_color" gorm:"size:9"`
	SidebarColor           string         `json:"sidebar_color" gorm:"size:9"`
	FontFamily             string         `json:"font_family" gorm:"size:40"`
	FontScale              string         `json:"font_scale" gorm:"size:20"`
	LogoScale              string         `json:"logo_scale" gorm:"size:20"`
	LogoDisplay            string         `json:"logo_display" gorm:"size:20"`
	NavTextColor           string         `json:"nav_text_color" gorm:"size:9"`
	OnBrandTextColor       string         `json:"on_brand_text_color" gorm:"size:9"`
	HeaderLayout           string         `json:"header_layout" gorm:"type:text"`
	LogoStorageKey         string         `json:"-" gorm:"size:120"`
	SignatureStorageKey    string         `json:"-" gorm:"size:120"`
	HasSignature           bool           `json:"has_signature" gorm:"-"`
	EnabledModules         string         `json:"-" gorm:"size:200"`
	SingleBranch           bool           `json:"single_branch" gorm:"not null;default:false"`
	DocumentLanguages      string         `json:"-" gorm:"size:60"`
	Modules                []string       `json:"modules" gorm:"-"`
	LogoURL                string         `json:"logo_url" gorm:"-"`
	Languages              []string       `json:"languages" gorm:"-"`
	CreatedAt              time.Time      `json:"created_at"`
	UpdatedAt              time.Time      `json:"updated_at"`
	DeletedAt              gorm.DeletedAt `json:"-" gorm:"index"`
}

package models

import (
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

const (
	ServiceChargeTypeNone    = "None"
	ServiceChargeTypeFlat    = "Flat"
	ServiceChargeTypePercent = "Percent"
)

const (
	ServiceChargeModeWithheldFromPayout = "WithheldFromPayout"
	ServiceChargeModeAddedToPrincipal   = "AddedToPrincipal"
)

type RateTier struct {
	Days int     `json:"days"`
	Rate float64 `json:"rate"`
}

type Scheme struct {
	config.TenantScoped
	ID                 uint           `json:"id" gorm:"primaryKey"`
	BranchID           uint           `json:"branch_id" gorm:"not null"`
	Branch             Branch         `json:"branch" gorm:"foreignKey:BranchID"`
	Code               string         `json:"code" gorm:"index;size:20"`
	Name               string         `json:"name" gorm:"not null;size:120"`
	InterestRate       float64        `json:"interest_rate" gorm:"not null"`
	DurationMonths     int            `json:"duration_months" gorm:"not null"`
	LTVPercent         float64        `json:"ltv_percent" gorm:"not null"`
	InterestMethod     string         `json:"interest_method" gorm:"size:80"`
	PenalRate          float64        `json:"penal_rate"`
	RateTiers          []RateTier     `json:"rate_tiers" gorm:"serializer:json;type:text"`
	MinimumDays        int            `json:"minimum_days" gorm:"not null;default:0"`
	Conditions         string         `json:"conditions"`
	IsActive           bool           `json:"is_active" gorm:"default:false"`
	ServiceChargeType  string         `json:"service_charge_type" gorm:"size:10;not null;default:'None'"`
	ServiceChargeValue float64        `json:"service_charge_value" gorm:"type:numeric(16,2);default:0"`
	ServiceChargeMode  string         `json:"service_charge_mode" gorm:"size:20"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	DeletedAt          gorm.DeletedAt `json:"-" gorm:"index"`
}

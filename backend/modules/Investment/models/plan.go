package models

import (
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

const (
	InterestRateTypeSimple   = "Simple"
	InterestRateTypeCompound = "Compound"
)

const (
	PayoutFrequencyDaily     = "Daily"
	PayoutFrequencyWeekly    = "Weekly"
	PayoutFrequencyMonthly   = "Monthly"
	PayoutFrequencyQuarterly = "Quarterly"
	PayoutFrequencyYearly    = "Yearly"
)

const (
	EngineSchedule = "Schedule"
	EngineLive     = "Live"
)

type InvestmentPlan struct {
	config.TenantScoped
	ID                  uint           `json:"id" gorm:"primaryKey"`
	Name                string         `json:"name" gorm:"not null;size:120"`
	InterestRateType    string         `json:"interest_rate_type" gorm:"not null;size:10"`
	InterestRatePercent float64        `json:"interest_rate_percent" gorm:"not null;type:numeric(6,3)"`
	PayoutFrequency     string         `json:"payout_frequency" gorm:"not null;size:10"`
	TenureMonths        int            `json:"tenure_months" gorm:"not null"`
	Engine              string         `json:"engine" gorm:"not null;size:10;default:'Schedule'"`
	ProductType         string         `json:"product_type" gorm:"not null;size:10;default:'Deposit'"`
	MinPrincipal        float64        `json:"min_principal" gorm:"not null;type:numeric(16,2);default:0"`
	IsActive            bool           `json:"is_active" gorm:"not null;default:true"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
	DeletedAt           gorm.DeletedAt `json:"-" gorm:"index"`
}

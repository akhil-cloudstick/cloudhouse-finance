package scheme

import (
	"time"

	"gorm.io/gorm"
)

// Scheme represents a loan scheme/plan that administrators define. Each
// scheme carries the terms (interest rate, LTV, method, conditions) used to
// compute loan eligibility for any loan opened under it, and a validity
// window (StartDate/EndDate) during which the scheme program is offered.
type Scheme struct {
	ID             uint           `json:"id" gorm:"primaryKey"`
	Code           string         `json:"code" gorm:"uniqueIndex;size:20"`
	Name           string         `json:"name" gorm:"not null;size:120"`
	InterestRate   float64        `json:"interestRate" gorm:"not null"`
	StartDate      time.Time      `json:"startDate" gorm:"not null"`
	EndDate        time.Time      `json:"endDate" gorm:"not null"`
	LTVPercent     float64        `json:"ltvPercent" gorm:"not null"`
	InterestMethod string         `json:"interestMethod" gorm:"size:80"`
	PenalRate      float64        `json:"penalRate"`
	Conditions     string         `json:"conditions"`
	IsActive       bool           `json:"isActive" gorm:"default:false"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	DeletedAt      gorm.DeletedAt `json:"-" gorm:"index"`
}

// TableName pins the GORM table name explicitly.
func (Scheme) TableName() string {
	return "schemes"
}

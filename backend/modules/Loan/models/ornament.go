package models

import (
	"cloudhouse/backend/config"
	"time"
)

type Ornament struct {
	config.TenantScoped
	ID              uint                `json:"id" gorm:"primaryKey"`
	LoanID          uint                `json:"loan_id" gorm:"not null;index"`
	Name            string              `json:"name" gorm:"not null;size:80"`
	Purity          string              `json:"purity" gorm:"not null;size:10"`
	GrossWeight     float64             `json:"gross_weight" gorm:"not null"`
	DeductionWeight float64             `json:"deduction_weight"`
	NetWeight       float64             `json:"net_weight"`
	Quantity        int                 `json:"quantity" gorm:"not null;default:1"`
	GoldValue       float64             `json:"gold_value" gorm:"type:numeric(16,2);default:0"`
	Remarks         string              `json:"remarks" gorm:"size:255"`
	PurityTest      *OrnamentPurityTest `json:"purity_test,omitempty" gorm:"foreignKey:OrnamentID"`
	Images          []OrnamentImage     `json:"images,omitempty" gorm:"foreignKey:OrnamentID"`
	ReleasedAt      *time.Time          `json:"released_at,omitempty"`
	CreatedAt       time.Time           `json:"created_at"`
	UpdatedAt       time.Time           `json:"updated_at"`
}

type OrnamentPurityTest struct {
	config.TenantScoped
	ID                    uint      `json:"id" gorm:"primaryKey"`
	OrnamentID            uint      `json:"ornament_id" gorm:"uniqueIndex;not null"`
	TestedPurity          string    `json:"tested_purity" gorm:"not null;size:10"`
	TestedGrossWeight     float64   `json:"tested_gross_weight" gorm:"not null"`
	TestedDeductionWeight float64   `json:"tested_deduction_weight"`
	TestedNetWeight       float64   `json:"tested_net_weight"`
	TestingRemarks        string    `json:"testing_remarks" gorm:"size:255"`
	TestedBy              string    `json:"tested_by" gorm:"not null;size:120"`
	TestedAt              time.Time `json:"tested_at" gorm:"not null"`
	CreatedAt             time.Time `json:"created_at"`
}

type OrnamentImage struct {
	config.TenantScoped
	ID         uint      `json:"id" gorm:"primaryKey"`
	OrnamentID uint      `json:"ornament_id" gorm:"not null;index"`
	ImageURL   string    `json:"image_url" gorm:"not null;size:255"`
	CreatedAt  time.Time `json:"created_at"`
}

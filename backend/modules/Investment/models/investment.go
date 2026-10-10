package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

const (
	StatusActive  = "Active"
	StatusMatured = "Matured"
)

type Investment struct {
	config.TenantScoped
	ID                      uint                    `json:"id" gorm:"primaryKey"`
	InvestmentNumber        string                  `json:"investment_number" gorm:"index;size:20"`
	BranchID                uint                    `json:"branch_id" gorm:"not null"`
	Branch                  commonModels.Branch     `json:"branch" gorm:"foreignKey:BranchID"`
	CustomerID              uint                    `json:"customer_id" gorm:"not null"`
	Customer                commonModels.Customer   `json:"customer" gorm:"foreignKey:CustomerID"`
	PlanID                  uint                    `json:"plan_id" gorm:"not null"`
	Plan                    InvestmentPlan          `json:"plan" gorm:"foreignKey:PlanID"`
	CreatedByEmployeeID     uint                    `json:"created_by_employee_id"`
	PrincipalAmount         float64                 `json:"principal_amount" gorm:"not null;type:numeric(16,2)"`
	InterestRateType        string                  `json:"interest_rate_type" gorm:"not null;size:10"`
	InterestRatePercent     float64                 `json:"interest_rate_percent" gorm:"not null;type:numeric(6,3)"`
	PayoutFrequency         string                  `json:"payout_frequency" gorm:"not null;size:10"`
	TenureMonths            int                     `json:"tenure_months" gorm:"not null"`
	Engine                  string                  `json:"engine" gorm:"not null;size:10;default:'Schedule'"`
	OutstandingPrincipal    float64                 `json:"outstanding_principal" gorm:"not null;type:numeric(16,2);default:0"`
	AccruedInterest         float64                 `json:"accrued_interest" gorm:"not null;type:numeric(16,2);default:0"`
	InterestWithdrawn       float64                 `json:"interest_withdrawn" gorm:"not null;type:numeric(16,2);default:0"`
	LastAccrualDate         time.Time               `json:"last_accrual_date"`
	OutstandingInterest     float64                 `json:"outstanding_interest" gorm:"-"`
	StartDate               time.Time               `json:"start_date" gorm:"not null"`
	MaturityDate            time.Time               `json:"maturity_date" gorm:"not null"`
	Status                  string                  `json:"status" gorm:"not null;size:20"`
	TotalInterestPaid       float64                 `json:"total_interest_paid" gorm:"not null;type:numeric(16,2);default:0"`
	ClosedAt                *time.Time              `json:"closed_at"`
	RenewedFromInvestmentID *uint                   `json:"renewed_from_investment_id"`
	RenewedToInvestmentID   *uint                   `json:"renewed_to_investment_id"`
	Payouts                 []InvestmentPayout      `json:"payouts,omitempty" gorm:"foreignKey:InvestmentID"`
	Transactions            []InvestmentTransaction `json:"transactions,omitempty" gorm:"foreignKey:InvestmentID"`
	CreatedAt               time.Time               `json:"created_at"`
	UpdatedAt               time.Time               `json:"updated_at"`
	DeletedAt               gorm.DeletedAt          `json:"-" gorm:"index"`
}

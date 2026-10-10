package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

type Reminder struct {
	config.TenantScoped
	ID                  uint                  `json:"id" gorm:"primaryKey"`
	CustomerID          uint                  `json:"customer_id" gorm:"not null;index"`
	Customer            commonModels.Customer `json:"customer" gorm:"foreignKey:CustomerID"`
	LoanID              *uint                 `json:"loan_id,omitempty" gorm:"index"`
	Type                string                `json:"type" gorm:"not null;size:20"`
	DueDate             time.Time             `json:"due_date" gorm:"not null;index"`
	Note                string                `json:"note" gorm:"size:255"`
	Status              string                `json:"status" gorm:"not null;size:20;default:'Pending'"`
	CreatedByEmployeeID uint                  `json:"created_by_employee_id" gorm:"not null"`
	CreatedAt           time.Time             `json:"created_at"`
	UpdatedAt           time.Time             `json:"updated_at"`
	DeletedAt           gorm.DeletedAt        `json:"-" gorm:"index"`
}

type CalendarEvent struct {
	Date           string `json:"date"`
	Type           string `json:"type"`
	Title          string `json:"title"`
	Detail         string `json:"detail"`
	LoanID         *uint  `json:"loan_id,omitempty"`
	LoanNumber     string `json:"loan_number,omitempty"`
	PersonalLoanID *uint  `json:"personal_loan_id,omitempty"`
	CustomerID     *uint  `json:"customer_id,omitempty"`
	CustomerName   string `json:"customer_name,omitempty"`
	CustomerCode   string `json:"customer_code,omitempty"`
	ReminderID     *uint  `json:"reminder_id,omitempty"`
	Status         string `json:"status,omitempty"`
}

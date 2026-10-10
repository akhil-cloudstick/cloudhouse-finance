package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"
)

type LoanDraft struct {
	config.TenantScoped
	ID                  uint                   `json:"id" gorm:"primaryKey"`
	CreatedByEmployeeID uint                   `json:"created_by_employee_id" gorm:"not null;index"`
	BranchID            uint                   `json:"branch_id" gorm:"not null;index"`
	Branch              commonModels.Branch    `json:"branch" gorm:"foreignKey:BranchID"`
	CustomerID          *uint                  `json:"customer_id,omitempty"`
	Customer            *commonModels.Customer `json:"customer,omitempty" gorm:"foreignKey:CustomerID"`
	SchemeID            *uint                  `json:"scheme_id,omitempty"`
	Scheme              *commonModels.Scheme   `json:"scheme,omitempty" gorm:"foreignKey:SchemeID"`
	LockerID            *uint                  `json:"locker_id,omitempty"`
	PrincipalOverride   *float64               `json:"principal_override,omitempty" gorm:"type:numeric(16,2)"`
	Ornaments           []LoanDraftOrnament    `json:"ornaments" gorm:"foreignKey:DraftID"`
	CreatedAt           time.Time              `json:"created_at"`
	UpdatedAt           time.Time              `json:"updated_at"`
}

type LoanDraftOrnament struct {
	config.TenantScoped
	ID          uint    `json:"id" gorm:"primaryKey"`
	DraftID     uint    `json:"draft_id" gorm:"not null;index"`
	Name        string  `json:"name" gorm:"size:80"`
	Purity      string  `json:"purity" gorm:"size:10"`
	GrossWeight float64 `json:"gross_weight"`
	Quantity    int     `json:"quantity"`
	ImageURL    string  `json:"image_url" gorm:"size:512"`
	ImageName   string  `json:"image_name" gorm:"size:255"`
	Position    int     `json:"position" gorm:"not null;default:0"`
}

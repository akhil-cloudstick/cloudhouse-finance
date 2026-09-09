package loan

import (
	"cloudhouse/backend/internal/platform"
	"time"
)

// LoanApproval is the audit trail for the loan's 4-step sanction chain —
// one row per decision (approve/reject) taken at a stage. ActorEmployeeID/
// ActorRole are passed explicitly by the caller (no auth/session exists
// yet); ActorRole records which role actually acted (relevant now that
// "Administrator" may act on behalf of any pending stage).
type LoanApproval struct {
	platform.TenantScoped
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Stage           string `json:"stage" gorm:"not null;size:30"`  // one of SanctionStage*
	Action          string `json:"action" gorm:"not null;size:20"` // "Approved" | "Rejected" | "Verified" (LoanOperator stage only, see ApprovalActionVerified)
	ActorEmployeeID uint   `json:"actorEmployeeId" gorm:"not null"`
	ActorRole       string `json:"actorRole" gorm:"size:40"`
	Remarks         string `json:"remarks" gorm:"size:255"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanApproval) TableName() string { return "loan_approvals" }

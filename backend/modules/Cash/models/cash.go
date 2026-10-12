package models

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"fmt"
	"time"

	"gorm.io/gorm"
)

const (
	CashModeCash         = "Cash"
	CashModeUPI          = "UPI"
	CashModeBankTransfer = "Bank Transfer"
	// CashModeCheque is retired: the application has three payment modes only (Cash, UPI, Bank Transfer).
	// The constant stays so the legacy split parameters still compile; any amount sent against it is rejected.
	CashModeCheque = "Cheque"
)

const (
	CategoryCashIn  = "cash_in"
	CategoryExpense = "expense"
)

type CashMovement struct {
	config.TenantScoped
	ID                 uint                   `json:"id" gorm:"primaryKey"`
	Type               string                 `json:"type" gorm:"not null;size:10"`
	Source             string                 `json:"source" gorm:"size:60"`
	Purpose            string                 `json:"purpose" gorm:"size:120"`
	Mode               string                 `json:"mode" gorm:"size:20"`
	Bank               string                 `json:"bank" gorm:"size:120"`
	Amount             float64                `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Status             string                 `json:"status" gorm:"size:20"`
	BranchID           *uint                  `json:"branch_id" gorm:"not null"`
	Branch             *commonModels.Branch   `json:"branch,omitempty" gorm:"foreignKey:BranchID"`
	OccurredOn         time.Time              `json:"occurred_on" gorm:"not null"`
	TransactionGroupID string                 `json:"transaction_group_id" gorm:"size:40;index"`
	BankID             *uint                  `json:"bank_id"`
	BankRef            *commonModels.Bank     `json:"bank_ref,omitempty" gorm:"foreignKey:BankID"`
	ToBankID           *uint                  `json:"to_bank_id"`
	ToBankRef          *commonModels.Bank     `json:"to_bank_ref,omitempty" gorm:"foreignKey:ToBankID"`
	CounterBankID      *uint                  `json:"counter_bank_id"`
	CounterBankRef     *commonModels.Bank     `json:"counter_bank_ref,omitempty" gorm:"foreignKey:CounterBankID"`
	PartyCustomerID    *uint                  `json:"party_customer_id"`
	PartyCustomer      *commonModels.Customer `json:"party_customer,omitempty" gorm:"foreignKey:PartyCustomerID"`
	ExpenseID          *uint                  `json:"expense_id"`
	ReceiptImage       string                 `json:"receipt_image,omitempty" gorm:"type:text"`
	SourceType         string                 `json:"source_type,omitempty" gorm:"size:40;index:idx_cash_movements_source,priority:1"`
	SourceID           *uint                  `json:"source_id,omitempty" gorm:"index:idx_cash_movements_source,priority:2"`
	CreatedAt          time.Time              `json:"created_at"`
}

type Expense struct {
	config.TenantScoped
	ID             uint                `json:"id" gorm:"primaryKey"`
	OccurredOn     time.Time           `json:"occurred_on" gorm:"not null"`
	Category       string              `json:"category" gorm:"not null;size:80"`
	Amount         float64             `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Mode           string              `json:"mode" gorm:"not null;size:20"`
	Payee          string              `json:"payee" gorm:"not null;size:120"`
	FromBankID     *uint               `json:"from_bank_id"`
	FromBank       *commonModels.Bank  `json:"from_bank,omitempty" gorm:"foreignKey:FromBankID"`
	ToBankID       *uint               `json:"to_bank_id"`
	ToBank         *commonModels.Bank  `json:"to_bank,omitempty" gorm:"foreignKey:ToBankID"`
	BranchID       uint                `json:"branch_id" gorm:"not null"`
	Branch         commonModels.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	Status         string              `json:"status" gorm:"not null;size:20;default:Pending"`
	ApprovalStage  string              `json:"approval_stage" gorm:"size:40"`
	Remarks        string              `json:"remarks" gorm:"size:500"`
	ApprovedBy     *string             `json:"approved_by,omitempty" gorm:"size:120"`
	ApprovedAt     *time.Time          `json:"approved_at,omitempty"`
	ReceiptImage   string              `json:"receipt_image,omitempty" gorm:"type:text"`
	CashMovementID *uint               `json:"cash_movement_id,omitempty"`
	CreatedAt      time.Time           `json:"created_at"`
}

type OpeningCashBalance struct {
	config.TenantScoped
	ID          uint                `json:"id" gorm:"primaryKey"`
	BranchID    uint                `json:"branch_id" gorm:"not null;index"`
	Branch      commonModels.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	BalanceDate time.Time           `json:"balance_date" gorm:"not null;index"`
	Mode        string              `json:"mode" gorm:"not null;size:20;default:Cash"`
	BankID      *uint               `json:"bank_id"`
	Bank        *commonModels.Bank  `json:"bank,omitempty" gorm:"foreignKey:BankID"`
	FromBankID  *uint               `json:"from_bank_id"`
	FromBank    *commonModels.Bank  `json:"from_bank,omitempty" gorm:"foreignKey:FromBankID"`
	Amount      float64             `json:"amount" gorm:"not null;type:numeric(16,2)"`
	CreatedAt   time.Time           `json:"created_at"`
	IsSet       bool                `json:"is_set" gorm:"-"`
}

type GoldSale struct {
	config.TenantScoped
	ID                 uint                `json:"id" gorm:"primaryKey"`
	OrnamentType       string              `json:"ornament_type" gorm:"not null;size:80"`
	SoldAmount         float64             `json:"sold_amount" gorm:"not null;type:numeric(16,2)"`
	CostAmount         float64             `json:"cost_amount" gorm:"not null;type:numeric(16,2)"`
	Profit             float64             `json:"profit" gorm:"not null;type:numeric(16,2)"`
	SoldOn             time.Time           `json:"sold_on" gorm:"not null"`
	BranchID           uint                `json:"branch_id" gorm:"not null"`
	Branch             commonModels.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	CashMovementID     *uint               `json:"cash_movement_id"`
	CashMovement       *CashMovement       `json:"-" gorm:"foreignKey:CashMovementID"`
	CostCashMovementID *uint               `json:"cost_cash_movement_id"`
	CostCashMovement   *CashMovement       `json:"-" gorm:"foreignKey:CostCashMovementID"`
	Mode               string              `json:"mode" gorm:"not null;size:20;default:Cash"`
	BankID             *uint               `json:"bank_id"`
	BankRef            *commonModels.Bank  `json:"bank_ref,omitempty" gorm:"foreignKey:BankID"`
	Remarks            string              `json:"remarks" gorm:"size:500"`
	ReceiptImage       string              `json:"receipt_image,omitempty" gorm:"type:text"`
	CreatedAt          time.Time           `json:"created_at"`
}

type Category struct {
	config.TenantScoped
	ID              uint               `json:"id" gorm:"primaryKey"`
	Type            string             `json:"type" gorm:"not null;size:20;index;default:cash_in"`
	Name            string             `json:"name" gorm:"index;not null;size:80"`
	IsCommon        bool               `json:"is_common" gorm:"not null;default:false"`
	BankID          *uint              `json:"bank_id,omitempty"`
	Bank            *commonModels.Bank `json:"bank,omitempty" gorm:"foreignKey:BankID"`
	LoanNumber      string             `json:"loan_number,omitempty" gorm:"size:60"`
	PrincipalAmount *float64           `json:"principal_amount,omitempty" gorm:"type:numeric(16,2)"`
	LoanOpenedAt    *time.Time         `json:"loan_opened_at,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
}

type (
	CashSource      = Category
	ExpenseCategory = Category
)

type LoanCashSource struct {
	config.TenantScoped
	ID              uint               `json:"id" gorm:"primaryKey"`
	CashMovementID  uint               `json:"cash_movement_id" gorm:"not null;index"`
	BankID          uint               `json:"bank_id" gorm:"not null"`
	Bank            *commonModels.Bank `json:"bank,omitempty" gorm:"foreignKey:BankID"`
	LoanNumber      string             `json:"loan_number" gorm:"not null;size:60"`
	PrincipalAmount float64            `json:"principal_amount" gorm:"not null;type:numeric(16,2)"`
	InterestRate    *float64           `json:"interest_rate" gorm:"type:numeric(6,2)"`
	DurationMonths  *int               `json:"duration_months"`
	CreatedAt       time.Time          `json:"created_at"`
}

func (m *CashMovement) BeforeCreate(tx *gorm.DB) error {
	if m.BranchID == nil || *m.BranchID == 0 {
		return common.NewBadRequest("branch is required")
	}
	if m.BankID == nil || !isBankMode(m.Mode) {
		return nil
	}
	var bk struct {
		Name     string
		BranchID uint
	}
	if err := tx.Session(&gorm.Session{NewDB: true}).Table("banks").Select("name, branch_id").
		Where("id = ?", *m.BankID).Scan(&bk).Error; err != nil {
		return err
	}
	if bk.BranchID != 0 && bk.BranchID != *m.BranchID {
		return common.NewBadRequest(fmt.Sprintf("%s belongs to another branch — pick a bank account of this entry's branch", bk.Name))
	}
	return nil
}

func isBankMode(mode string) bool {
	return mode == CashModeUPI || mode == CashModeBankTransfer
}

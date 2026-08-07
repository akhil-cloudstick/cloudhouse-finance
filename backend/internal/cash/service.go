package cash

import (
	"errors"
	"time"
)

var (
	ErrMovementNotFound = errors.New("cash movement not found")
	ErrExpenseNotFound  = errors.New("expense not found")
	ErrInvalidAmount    = errors.New("amount must be greater than zero")
	ErrInvalidType      = errors.New("type must be \"in\" or \"out\"")
	ErrSourceRequired   = errors.New("source is required for cash-in movements")
	ErrBankRequired     = errors.New("bank is required when source is Loan")
	ErrPurposeRequired  = errors.New("purpose is required for cash-out movements")
	ErrInvalidStatus    = errors.New("status must be \"Open\" or \"Closed\"")
	ErrCategoryRequired = errors.New("category is required")
	ErrModeRequired     = errors.New("mode is required")
	ErrPayeeRequired    = errors.New("payee is required")
	ErrBranchRequired   = errors.New("branch is required")
)

// RecordMovementInput mirrors the fields supplied by AddCashModal.tsx /
// CashOutModal.tsx.
type RecordMovementInput struct {
	Type       string // "in" | "out"
	Source     string // "Savings" | "Loan" — required when Type == "in"
	Purpose    string // required when Type == "out"
	Bank       string
	Amount     float64
	OccurredOn time.Time
}

// RecordExpenseInput mirrors the fields supplied by ExpenseModal.tsx.
type RecordExpenseInput struct {
	OccurredOn   time.Time
	Category     string
	Amount       float64
	Mode         string
	Payee        string
	Branch       string
	ReceiptImage string
}

// MovementService implements cash-movement business rules.
type MovementService struct {
	repo *MovementRepository
}

func NewMovementService(repo *MovementRepository) *MovementService {
	return &MovementService{repo: repo}
}

func (s *MovementService) Record(in RecordMovementInput) (*CashMovement, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.Type != "in" && in.Type != "out" {
		return nil, ErrInvalidType
	}

	rec := &CashMovement{
		Type:   in.Type,
		Amount: in.Amount,
		Bank:   in.Bank,
	}
	if in.OccurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = in.OccurredOn
	}

	if in.Type == "in" {
		if in.Source == "" {
			return nil, ErrSourceRequired
		}
		if in.Source == "Loan" && in.Bank == "" {
			return nil, ErrBankRequired
		}
		rec.Source = in.Source
		if in.Source == "Loan" {
			rec.Status = "Open"
		}
	} else {
		if in.Purpose == "" {
			return nil, ErrPurposeRequired
		}
		rec.Purpose = in.Purpose
	}

	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *MovementService) List() ([]CashMovement, error) {
	return s.repo.FindAll()
}

func (s *MovementService) Get(id uint) (*CashMovement, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrMovementNotFound
	}
	return rec, nil
}

// SetLoanStatus updates the Open/Closed status of a loan-sourced cash-in
// movement, mirroring legacy's setCashLoanStatus/toggleCashLoan.
func (s *MovementService) SetLoanStatus(id uint, status string) (*CashMovement, error) {
	if status != "Open" && status != "Closed" {
		return nil, ErrInvalidStatus
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrMovementNotFound
	}
	rec.Status = status
	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// ExpenseService implements expense-register business rules.
type ExpenseService struct {
	repo *ExpenseRepository
}

func NewExpenseService(repo *ExpenseRepository) *ExpenseService {
	return &ExpenseService{repo: repo}
}

func (s *ExpenseService) Record(in RecordExpenseInput) (*Expense, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.Category == "" {
		return nil, ErrCategoryRequired
	}
	if in.Mode == "" {
		return nil, ErrModeRequired
	}
	if in.Payee == "" {
		return nil, ErrPayeeRequired
	}
	if in.Branch == "" {
		return nil, ErrBranchRequired
	}

	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}
	rec := &Expense{
		OccurredOn:   occurredOn,
		Category:     in.Category,
		Amount:       in.Amount,
		Mode:         in.Mode,
		Payee:        in.Payee,
		Branch:       in.Branch,
		Status:       "Pending",
		ReceiptImage: in.ReceiptImage,
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *ExpenseService) List() ([]Expense, error) {
	return s.repo.FindAll()
}

func (s *ExpenseService) Get(id uint) (*Expense, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrExpenseNotFound
	}
	return rec, nil
}

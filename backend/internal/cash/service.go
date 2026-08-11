package cash

import (
	"errors"
	"fmt"
	"time"

	"ambikagold/backend/internal/branch"
)

var (
	ErrMovementNotFound  = errors.New("cash movement not found")
	ErrExpenseNotFound   = errors.New("expense not found")
	ErrInvalidAmount     = errors.New("amount must be greater than zero")
	ErrInvalidType       = errors.New("type must be \"in\" or \"out\"")
	ErrSourceRequired    = errors.New("source is required for cash-in movements")
	ErrBankRequired      = errors.New("bank is required when source is Loan")
	ErrPurposeRequired   = errors.New("purpose is required for cash-out movements")
	ErrInvalidStatus     = errors.New("status must be \"Open\" or \"Closed\"")
	ErrCategoryRequired  = errors.New("category is required")
	ErrModeRequired      = errors.New("mode is required")
	ErrPayeeRequired     = errors.New("payee is required")
	ErrBranchRequired    = errors.New("branch is required")
	ErrBranchInvalid     = errors.New("branch does not exist")
	ErrExpenseNotPending = errors.New("expense has already been approved or rejected")
	ErrRemarksRequired   = errors.New("remarks are required when rejecting an expense")
	ErrInvalidBalance    = errors.New("amount must be zero or greater")
)

// RecordMovementInput mirrors the fields supplied by AddCashModal.tsx /
// CashOutModal.tsx.
type RecordMovementInput struct {
	Type       string // "in" | "out"
	Source     string // "Savings" | "Loan" — required when Type == "in"
	Purpose    string // required when Type == "out"
	Bank       string
	Amount     float64
	BranchID   *uint // optional — not every cash movement is tied to a till yet
	OccurredOn time.Time
}

// RecordExpenseInput mirrors the fields supplied by ExpenseModal.tsx.
type RecordExpenseInput struct {
	OccurredOn   time.Time
	Category     string
	Amount       float64
	Mode         string
	Payee        string
	BranchID     uint
	Remarks      string
	ReceiptImage string
}

// MovementService implements cash-movement business rules.
type MovementService struct {
	repo       *MovementRepository
	branchRepo *branch.Repository
}

func NewMovementService(repo *MovementRepository, branchRepo *branch.Repository) *MovementService {
	return &MovementService{repo: repo, branchRepo: branchRepo}
}

func (s *MovementService) Record(in RecordMovementInput) (*CashMovement, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.Type != "in" && in.Type != "out" {
		return nil, ErrInvalidType
	}

	if in.BranchID != nil {
		ok, err := s.branchRepo.Exists(*in.BranchID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrBranchInvalid
		}
	}

	rec := &CashMovement{
		Type:     in.Type,
		Amount:   in.Amount,
		Bank:     in.Bank,
		BranchID: in.BranchID,
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
	return s.repo.FindByID(rec.ID)
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

// RecordBankPledgeCashIn creates the cash-in movement for a loan's gold
// being pledged to a bank (loan.CashRecorder, called from
// loan.Service.RecordBankPledge). Source "Bank" mirrors the existing
// "Savings"/"Loan" sources so it renders in the same Cash Movements table
// without special-casing on the frontend. Returns the new movement's ID so
// the caller can store it on the pledge record and reverse it later.
func (s *MovementService) RecordBankPledgeCashIn(loanID uint, bankName string, amount float64, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:   "in",
		Source: "Bank",
		Bank:   bankName,
		Amount: amount,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordLoanDisbursementCashOut creates the cash-out movement for a loan's
// principal being handed to the customer (loan.CashRecorder, called from
// loan.Service.Approve once a loan clears its final approval stage).
// Purpose carries the loan number so it reads sensibly in the Cash
// Movements table without a dedicated column.
func (s *MovementService) RecordLoanDisbursementCashOut(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "out",
		Purpose:  "Loan disbursement — " + loanNumber,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordLoanPaymentCashIn creates the cash-in movement for a customer's loan
// repayment (loan.CashRecorder, called from loan.Service.RecordPayment).
// Source is "Collection" — distinct from the "Savings"/"Loan" sources
// AddCashModal.tsx offers for manually topping up the till (that "Loan"
// source means the branch itself borrowed cash from a bank, unrelated to a
// customer repaying their gold loan).
func (s *MovementService) RecordLoanPaymentCashIn(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time, paymentType string) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "Collection",
		Purpose:  fmt.Sprintf("%s — %s", paymentType, loanNumber),
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// DeleteCashMovement removes a cash movement outright (loan.CashRecorder,
// called from loan.Service.ReleaseBankPledge to undo the cash-in recorded
// when the gold was pledged) — unlike a reversing "out" entry, this keeps
// Cash Movements showing only money that's still actually in/out.
func (s *MovementService) DeleteCashMovement(id uint) error {
	return s.repo.Delete(id)
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
	repo       *ExpenseRepository
	branchRepo *branch.Repository
}

func NewExpenseService(repo *ExpenseRepository, branchRepo *branch.Repository) *ExpenseService {
	return &ExpenseService{repo: repo, branchRepo: branchRepo}
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
	if in.BranchID == 0 {
		return nil, ErrBranchRequired
	}
	if ok, err := s.branchRepo.Exists(in.BranchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrBranchInvalid
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
		BranchID:     in.BranchID,
		Status:       "Pending",
		Remarks:      in.Remarks,
		ReceiptImage: in.ReceiptImage,
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
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

// Approve marks a Pending expense as Approved. Only Pending expenses can be
// approved — an already-decided expense must be re-recorded, not amended.
func (s *ExpenseService) Approve(id uint, approvedBy string) (*Expense, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrExpenseNotFound
	}
	if rec.Status != "Pending" {
		return nil, ErrExpenseNotPending
	}
	now := time.Now()
	rec.Status = "Approved"
	if approvedBy != "" {
		rec.ApprovedBy = &approvedBy
	}
	rec.ApprovedAt = &now
	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Reject marks a Pending expense as Rejected. Remarks are required so a
// rejection always carries a reason.
func (s *ExpenseService) Reject(id uint, approvedBy, remarks string) (*Expense, error) {
	if remarks == "" {
		return nil, ErrRemarksRequired
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrExpenseNotFound
	}
	if rec.Status != "Pending" {
		return nil, ErrExpenseNotPending
	}
	now := time.Now()
	rec.Status = "Rejected"
	rec.Remarks = remarks
	if approvedBy != "" {
		rec.ApprovedBy = &approvedBy
	}
	rec.ApprovedAt = &now
	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// OpeningBalanceService implements the opening-cash-balance business rules:
// one entry per branch per day, entered by authorized staff at day start.
type OpeningBalanceService struct {
	repo       *OpeningBalanceRepository
	branchRepo *branch.Repository
}

func NewOpeningBalanceService(repo *OpeningBalanceRepository, branchRepo *branch.Repository) *OpeningBalanceService {
	return &OpeningBalanceService{repo: repo, branchRepo: branchRepo}
}

func (s *OpeningBalanceService) Set(branchID uint, date time.Time, amount float64) (*OpeningCashBalance, error) {
	if amount < 0 {
		return nil, ErrInvalidBalance
	}
	if branchID == 0 {
		return nil, ErrBranchRequired
	}
	if ok, err := s.branchRepo.Exists(branchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrBranchInvalid
	}
	if date.IsZero() {
		date = time.Now()
	}
	rec := &OpeningCashBalance{BranchID: branchID, BalanceDate: date, Amount: amount}
	if err := s.repo.Upsert(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Get returns the opening balance for a branch/date, or a zero-amount
// record if none has been entered yet — the frontend always gets a number.
func (s *OpeningBalanceService) Get(branchID uint, date time.Time) (*OpeningCashBalance, error) {
	if date.IsZero() {
		date = time.Now()
	}
	rec, err := s.repo.FindByBranchAndDate(branchID, date)
	if err != nil {
		return &OpeningCashBalance{BranchID: branchID, BalanceDate: date, Amount: 0}, nil
	}
	return rec, nil
}

// Summary is the computed Expected Cash in Hand breakdown:
// Opening + Collections − Disbursements − Cash Expenses = Expected.
type Summary struct {
	OpeningCash   float64 `json:"openingCash"`
	Collections   float64 `json:"collections"`
	Disbursements float64 `json:"disbursements"`
	CashExpenses  float64 `json:"cashExpenses"`
	ExpectedCash  float64 `json:"expectedCash"`
}

// SummaryService computes Summary from the movement, expense, and opening
// balance repositories for a given day/branch.
type SummaryService struct {
	movementRepo *MovementRepository
	expenseRepo  *ExpenseRepository
	openingSvc   *OpeningBalanceService
}

func NewSummaryService(movementRepo *MovementRepository, expenseRepo *ExpenseRepository, openingSvc *OpeningBalanceService) *SummaryService {
	return &SummaryService{movementRepo: movementRepo, expenseRepo: expenseRepo, openingSvc: openingSvc}
}

func (s *SummaryService) GetExpectedCash(branchID *uint, date time.Time) (Summary, error) {
	if date.IsZero() {
		date = time.Now()
	}
	var opening float64
	if branchID != nil {
		ob, err := s.openingSvc.Get(*branchID, date)
		if err != nil {
			return Summary{}, err
		}
		opening = ob.Amount
	}
	in, out, err := s.movementRepo.SumByTypeAndDate(branchID, date)
	if err != nil {
		return Summary{}, err
	}
	cashExpenses, err := s.expenseRepo.SumCashByDate(branchID, date)
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		OpeningCash:   opening,
		Collections:   in,
		Disbursements: out,
		CashExpenses:  cashExpenses,
		ExpectedCash:  opening + in - out - cashExpenses,
	}, nil
}

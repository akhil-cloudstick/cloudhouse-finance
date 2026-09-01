package personalloan

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
)

var (
	ErrInvalidPrincipal    = httpx.NewBadRequest("principal amount must be greater than zero")
	ErrInvalidTenureCount  = httpx.NewBadRequest("tenure count must be greater than zero")
	ErrInvalidFrequency    = httpx.NewBadRequest("frequency must be Daily, Weekly or Monthly")
	ErrInvalidInterestType = httpx.NewBadRequest("interest type must be Flat or Percentage")
	ErrInvalidInterestValue = httpx.NewBadRequest("interest value must not be negative")
	ErrInterestTooHigh     = httpx.NewBadRequest("interest amount must be less than the principal amount")
	ErrInvalidPaymentAmount = httpx.NewBadRequest("payment amount must be greater than zero")
	ErrOverpayment         = httpx.NewBadRequest("payment amount exceeds the outstanding balance")
	ErrLoanNotActive       = httpx.NewConflict("loan is not active")
	ErrLoanNotFound        = httpx.NewNotFound("personal loan not found")
	ErrRenewalShortfall    = httpx.NewBadRequest("new principal is not enough to cover the outstanding balance and interest")
)

const epsilon = 0.01

// Service implements personal-loan business rules on top of the Repository.
type Service struct {
	repo         *Repository
	customerRepo *customer.Repository
}

func NewService(repo *Repository, customerRepo *customer.Repository) *Service {
	return &Service{repo: repo, customerRepo: customerRepo}
}

// CreateInput mirrors the "New Personal Loan" form.
type CreateInput struct {
	BranchID      uint
	CustomerID    uint
	PrincipalAmount float64
	InterestType  string
	InterestValue float64
	Frequency     string
	TenureCount   int
	CreatedByEmployeeID uint
}

func validateFrequency(freq string) bool {
	switch freq {
	case FrequencyDaily, FrequencyWeekly, FrequencyMonthly:
		return true
	}
	return false
}

func validateInterestType(t string) bool {
	switch t {
	case InterestTypeFlat, InterestTypePercentage:
		return true
	}
	return false
}

// computeInterest returns the rupee interest amount for a given principal,
// interest type and value: Flat is the value itself, Percentage is
// RoundMoney(principal * value / 100).
func computeInterest(principal float64, interestType string, interestValue float64) float64 {
	if interestType == InterestTypePercentage {
		return platform.RoundMoney(principal * interestValue / 100)
	}
	return platform.RoundMoney(interestValue)
}

// CreateLoan validates the input, computes interest/disbursement, generates
// the full repayment schedule, and persists the loan — a single step that
// leaves the loan Active and disbursed (no separate approval stage; see
// package doc comment).
func (s *Service) CreateLoan(in CreateInput) (*PersonalLoan, error) {
	if in.PrincipalAmount <= 0 {
		return nil, ErrInvalidPrincipal
	}
	if in.TenureCount <= 0 {
		return nil, ErrInvalidTenureCount
	}
	if !validateFrequency(in.Frequency) {
		return nil, ErrInvalidFrequency
	}
	if !validateInterestType(in.InterestType) {
		return nil, ErrInvalidInterestType
	}
	if in.InterestValue < 0 {
		return nil, ErrInvalidInterestValue
	}
	if _, err := s.customerRepo.FindByID(in.CustomerID); err != nil {
		return nil, err
	}

	principal := platform.RoundMoney(in.PrincipalAmount)
	interestAmount := computeInterest(principal, in.InterestType, in.InterestValue)
	if interestAmount >= principal {
		return nil, ErrInterestTooHigh
	}
	disbursed := platform.RoundMoney(principal - interestAmount)
	installmentAmount := platform.RoundMoney(principal / float64(in.TenureCount))

	now := time.Now()
	rec := &PersonalLoan{
		BranchID:            in.BranchID,
		CustomerID:          in.CustomerID,
		CreatedByEmployeeID: in.CreatedByEmployeeID,
		PrincipalAmount:     principal,
		InterestType:        in.InterestType,
		InterestValue:       platform.RoundMoney(in.InterestValue),
		InterestAmount:      interestAmount,
		DisbursedAmount:     disbursed,
		Frequency:           in.Frequency,
		TenureCount:         in.TenureCount,
		InstallmentAmount:   installmentAmount,
		OutstandingAmount:   principal,
		TotalPaid:           0,
		Status:              StatusActive,
		OpenedDate:          now,
		DisbursedAt:         now,
	}

	err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		count, err := s.repo.CountAll()
		if err != nil {
			return err
		}
		rec.LoanNumber = fmt.Sprintf("PL-%05d", count+1)

		if err := s.repo.Create(tx, rec); err != nil {
			return err
		}

		installments := generateSchedule(rec)
		if err := s.repo.CreateInstallments(tx, installments); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rec, nil
}

// generateSchedule builds loan.TenureCount installment rows starting the
// first period after OpenedDate, stepping by Frequency (daily +1 day,
// weekly +7 days, monthly +1 calendar month). Every row is
// InstallmentAmount except the last, which is set to whatever principal
// remains so the schedule sums to exactly PrincipalAmount regardless of
// rounding drift from the Principal/TenureCount division.
func generateSchedule(loan *PersonalLoan) []PersonalLoanInstallment {
	recs := make([]PersonalLoanInstallment, 0, loan.TenureCount)
	due := loan.OpenedDate
	var runningTotal float64
	for i := 1; i <= loan.TenureCount; i++ {
		due = stepDueDate(due, loan.Frequency)
		amount := loan.InstallmentAmount
		if i == loan.TenureCount {
			amount = platform.RoundMoney(loan.PrincipalAmount - runningTotal)
		}
		runningTotal = platform.RoundMoney(runningTotal + amount)
		recs = append(recs, PersonalLoanInstallment{
			PersonalLoanID: loan.ID,
			SequenceNo:     i,
			DueDate:        due,
			Amount:         amount,
			Status:         InstallmentStatusPending,
		})
	}
	return recs
}

func stepDueDate(from time.Time, frequency string) time.Time {
	switch frequency {
	case FrequencyDaily:
		return from.AddDate(0, 0, 1)
	case FrequencyWeekly:
		return from.AddDate(0, 0, 7)
	case FrequencyMonthly:
		return from.AddDate(0, 1, 0)
	default:
		return from.AddDate(0, 0, 1)
	}
}

// Get returns a single loan, branch-scoped.
func (s *Service) Get(id uint, branchID *uint) (*PersonalLoan, error) {
	rec, err := s.repo.FindByID(id, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLoanNotFound
		}
		return nil, err
	}
	return rec, nil
}

// List returns loans, branch/customer/status filtered.
func (s *Service) List(branchID *uint, customerID *uint, status string) ([]PersonalLoan, error) {
	return s.repo.FindAll(branchID, customerID, status)
}

// GetSchedule returns a loan's installment schedule, ordered.
func (s *Service) GetSchedule(loanID uint, branchID *uint) ([]PersonalLoanInstallment, error) {
	if _, err := s.Get(loanID, branchID); err != nil {
		return nil, err
	}
	return s.repo.FindInstallments(loanID)
}

// ListPayments returns a loan's payment ledger, ordered oldest first.
func (s *Service) ListPayments(loanID uint, branchID *uint) ([]PersonalLoanPayment, error) {
	if _, err := s.Get(loanID, branchID); err != nil {
		return nil, err
	}
	return s.repo.FindPayments(loanID)
}

// PaymentInput mirrors the "Collect Payment" form.
type PaymentInput struct {
	Amount               float64
	Method               string
	Reference            string
	Description          string
	ReceivedByEmployeeID *uint
}

// RecordPayment collects a payment against a loan: validates the amount is
// positive and does not exceed the outstanding balance (overpayment is
// rejected, not clamped — see package doc), decrements OutstandingAmount,
// closes the loan once it reaches zero, and best-effort allocates the
// payment across pending installments for display. Runs inside a
// transaction with a row lock on the loan to serialize concurrent
// collections against the same loan.
func (s *Service) RecordPayment(loanID uint, branchID *uint, in PaymentInput) (*PersonalLoan, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidPaymentAmount
	}

	var result *PersonalLoan
	err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		rec, err := s.repo.LockByID(tx, loanID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLoanNotFound
			}
			return err
		}
		if rec.Status != StatusActive {
			return ErrLoanNotActive
		}
		amount := platform.RoundMoney(in.Amount)
		if amount > rec.OutstandingAmount+epsilon {
			return ErrOverpayment
		}

		newOutstanding := platform.RoundMoney(rec.OutstandingAmount - amount)
		if newOutstanding < 0 {
			newOutstanding = 0
		}

		payment := &PersonalLoanPayment{
			PersonalLoanID:       rec.ID,
			Amount:               amount,
			PaidOn:               time.Now(),
			ReceivedByEmployeeID: in.ReceivedByEmployeeID,
			Method:               in.Method,
			Reference:            in.Reference,
			Description:          in.Description,
			RunningBalance:       newOutstanding,
		}
		if err := s.repo.CreatePayment(tx, payment); err != nil {
			return err
		}

		rec.OutstandingAmount = newOutstanding
		rec.TotalPaid = platform.RoundMoney(rec.TotalPaid + amount)
		if newOutstanding <= epsilon {
			rec.OutstandingAmount = 0
			rec.Status = StatusClosed
			now := time.Now()
			rec.ClosedAt = &now
		}
		if err := s.repo.Update(tx, rec); err != nil {
			return err
		}

		if err := s.allocatePaymentToInstallments(tx, rec.ID, amount); err != nil {
			return err
		}

		result = rec
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// allocatePaymentToInstallments is a best-effort, display-only pass: it
// walks pending/partially-paid installments in due-date order, crediting
// PaidAmount up to each row's Amount until the payment is exhausted. It
// never blocks or constrains the payment itself — see package doc comment
// on installment status being non-authoritative.
func (s *Service) allocatePaymentToInstallments(tx *gorm.DB, loanID uint, amount float64) error {
	var installments []PersonalLoanInstallment
	if err := tx.Where("personal_loan_id = ? AND status <> ?", loanID, InstallmentStatusPaid).
		Order("sequence_no asc").Find(&installments).Error; err != nil {
		return err
	}
	remaining := amount
	for i := range installments {
		if remaining <= epsilon {
			break
		}
		inst := &installments[i]
		room := platform.RoundMoney(inst.Amount - inst.PaidAmount)
		if room <= epsilon {
			continue
		}
		credit := remaining
		if credit > room {
			credit = room
		}
		inst.PaidAmount = platform.RoundMoney(inst.PaidAmount + credit)
		if inst.PaidAmount >= inst.Amount-epsilon {
			inst.Status = InstallmentStatusPaid
		} else {
			inst.Status = InstallmentStatusPartiallyPaid
		}
		remaining = platform.RoundMoney(remaining - credit)
		if err := s.repo.UpdateInstallment(tx, inst); err != nil {
			return err
		}
	}
	return nil
}

// RenewInput mirrors the "Renew Loan" form.
type RenewInput struct {
	PrincipalAmount     float64
	InterestType        string
	InterestValue       float64
	Frequency           string
	TenureCount         int
	CreatedByEmployeeID uint
}

// RenewResult carries both loans back to the handler so the frontend can
// show/link either side of the renewal.
type RenewResult struct {
	OldLoan *PersonalLoan `json:"oldLoan"`
	NewLoan *PersonalLoan `json:"newLoan"`
}

// PreviewRenewal computes what RenewLoan would do, without writing
// anything, so the UI can show the payout (or a shortfall warning) before
// the staff member commits.
type RenewalPreview struct {
	Rollover        float64 `json:"rollover"`
	InterestAmount  float64 `json:"interestAmount"`
	DisbursedAmount float64 `json:"disbursedAmount"`
	Shortfall       bool    `json:"shortfall"`
}

func (s *Service) PreviewRenewal(loanID uint, branchID *uint, in RenewInput) (*RenewalPreview, error) {
	old, err := s.Get(loanID, branchID)
	if err != nil {
		return nil, err
	}
	if old.Status != StatusActive {
		return nil, ErrLoanNotActive
	}
	if in.PrincipalAmount <= 0 {
		return nil, ErrInvalidPrincipal
	}
	if !validateInterestType(in.InterestType) {
		return nil, ErrInvalidInterestType
	}

	principal := platform.RoundMoney(in.PrincipalAmount)
	interestAmount := computeInterest(principal, in.InterestType, in.InterestValue)
	rollover := old.OutstandingAmount
	disbursed := platform.RoundMoney(principal - rollover - interestAmount)

	return &RenewalPreview{
		Rollover:        rollover,
		InterestAmount:  interestAmount,
		DisbursedAmount: disbursed,
		Shortfall:       disbursed < 0,
	}, nil
}

// RenewLoan closes an Active loan and opens a new one in its place: the old
// loan's outstanding balance ("rollover") plus the new loan's own interest
// are deducted from the new principal before any cash changes hands, but
// the new loan's repayment obligation is the FULL new principal (never
// reduced by the rollover). Both loans are linked via
// RenewedFromLoanID/RenewedToLoanID. Runs inside one transaction with a row
// lock on the old loan.
func (s *Service) RenewLoan(loanID uint, branchID *uint, in RenewInput) (*RenewResult, error) {
	if in.PrincipalAmount <= 0 {
		return nil, ErrInvalidPrincipal
	}
	if in.TenureCount <= 0 {
		return nil, ErrInvalidTenureCount
	}
	if !validateFrequency(in.Frequency) {
		return nil, ErrInvalidFrequency
	}
	if !validateInterestType(in.InterestType) {
		return nil, ErrInvalidInterestType
	}
	if in.InterestValue < 0 {
		return nil, ErrInvalidInterestValue
	}

	var result RenewResult
	err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		old, err := s.repo.LockByID(tx, loanID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLoanNotFound
			}
			return err
		}
		if old.Status != StatusActive || old.RenewedToLoanID != nil {
			return ErrLoanNotActive
		}

		principal := platform.RoundMoney(in.PrincipalAmount)
		interestAmount := computeInterest(principal, in.InterestType, in.InterestValue)
		rollover := old.OutstandingAmount
		disbursed := platform.RoundMoney(principal - rollover - interestAmount)
		if disbursed < 0 {
			return ErrRenewalShortfall
		}
		if interestAmount >= principal {
			return ErrInterestTooHigh
		}

		now := time.Now()
		newLoan := &PersonalLoan{
			BranchID:            old.BranchID,
			CustomerID:          old.CustomerID,
			CreatedByEmployeeID: in.CreatedByEmployeeID,
			PrincipalAmount:     principal,
			InterestType:        in.InterestType,
			InterestValue:       platform.RoundMoney(in.InterestValue),
			InterestAmount:      interestAmount,
			DisbursedAmount:     disbursed,
			Frequency:           in.Frequency,
			TenureCount:         in.TenureCount,
			InstallmentAmount:   platform.RoundMoney(principal / float64(in.TenureCount)),
			OutstandingAmount:   principal,
			Status:              StatusActive,
			OpenedDate:          now,
			DisbursedAt:         now,
			RenewedFromLoanID:   &old.ID,
		}
		count, err := s.repo.CountAll()
		if err != nil {
			return err
		}
		newLoan.LoanNumber = fmt.Sprintf("PL-%05d", count+1)
		if err := s.repo.Create(tx, newLoan); err != nil {
			return err
		}
		installments := generateSchedule(newLoan)
		if err := s.repo.CreateInstallments(tx, installments); err != nil {
			return err
		}

		// Record the rollover as a ledger entry on the OLD loan so its
		// balance visibly reaches zero, then close it.
		if rollover > epsilon {
			payment := &PersonalLoanPayment{
				PersonalLoanID: old.ID,
				Amount:         rollover,
				PaidOn:         now,
				Method:         PaymentMethodRenewalRollover,
				Description:    fmt.Sprintf("Settled via renewal into loan %s", newLoan.LoanNumber),
				RunningBalance: 0,
			}
			if err := s.repo.CreatePayment(tx, payment); err != nil {
				return err
			}
		}
		old.OutstandingAmount = 0
		old.TotalPaid = platform.RoundMoney(old.TotalPaid + rollover)
		old.Status = StatusRenewed
		old.ClosedAt = &now
		old.RenewedToLoanID = &newLoan.ID
		if err := s.repo.Update(tx, old); err != nil {
			return err
		}

		result = RenewResult{OldLoan: old, NewLoan: newLoan}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

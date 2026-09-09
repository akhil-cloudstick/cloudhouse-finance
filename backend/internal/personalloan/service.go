package personalloan

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
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

// CashRecorder reflects a personal loan's real cash flow into Cash-in-Hand &
// Expenses (frontend's Cash & Expenses page), mirroring internal/loan's
// CashRecorder pattern so this package doesn't import internal/cash
// directly. Disbursing a loan hands cash to the customer (cash out);
// collecting a repayment brings cash in. Only the two methods this package
// actually needs are declared here — both are already implemented by
// cash.MovementService (it also backs internal/loan's disbursement/payment
// cash flow), so no new cash-side code is needed, just this narrower view
// of the same interface.
type CashRecorder interface {
	RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time, paymentType string) (movementID uint, err error)
}

// Service implements personal-loan business rules on top of the Repository.
type Service struct {
	repo         *Repository
	customerRepo *customer.Repository
	cashRecorder CashRecorder

	// aadhaarCipher decrypts a customer's full Aadhaar number (same
	// key/cipher as customer.Service's own aadhaarCipher) so
	// GenerateBond can prefill it on the printable borrower-only bond,
	// mirroring internal/loan.Service's identical field/rationale for its
	// pledge agreement. Optional: nil (e.g. not configured) just leaves
	// the bond's Aadhaar line blank rather than failing the download.
	aadhaarCipher *platform.Cipher
}

func NewService(repo *Repository, customerRepo *customer.Repository, cashRecorder CashRecorder, aadhaarCipher *platform.Cipher) *Service {
	return &Service{repo: repo, customerRepo: customerRepo, cashRecorder: cashRecorder, aadhaarCipher: aadhaarCipher}
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
func (s *Service) CreateLoan(ctx context.Context, in CreateInput) (*PersonalLoan, error) {
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
	if _, err := s.customerRepo.FindByID(ctx, in.CustomerID); err != nil {
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

	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		count, err := s.repo.CountAll(ctx)
		if err != nil {
			return err
		}
		rec.LoanNumber = fmt.Sprintf("PL-%05d", count+1)

		if err := s.repo.Create(ctx, tx, rec); err != nil {
			return err
		}

		installments := generateSchedule(rec)
		// GORM's tenant-stamp Create hook (platform.stampCallback) reliably
		// sets TenantID when the create target is a single struct — which is
		// how `rec` above just got stamped — but does NOT propagate to every
		// element of a []PersonalLoanInstallment batch insert, only some of
		// them. The rest silently persist with TenantID 0: not rejected (no
		// NOT NULL constraint), just invisible forever afterwards to any
		// normally tenant-scoped query, which is why a loan created with a
		// 20-installment schedule could show only 1 row back on the Schedule
		// tab. Stamping explicitly here — copying the already-correct
		// rec.TenantID onto every row before insert — sidesteps the hook
		// entirely instead of depending on it for a slice.
		for i := range installments {
			installments[i].TenantID = rec.TenantID
		}
		if err := s.repo.CreateInstallments(ctx, tx, installments); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// The cash actually leaves the till only once the loan (and its
	// schedule) is durably persisted — best-effort and outside the
	// transaction, same as internal/loan's disbursement/payment cash
	// recording: a failure here is logged, not fatal to loan creation.
	if s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordLoanDisbursementCashOut(ctx, rec.ID, rec.LoanNumber, rec.DisbursedAmount, rec.BranchID, now); err != nil {
			log.Printf("cash-out movement (personal loan disbursement) failed for loan %d: %v", rec.ID, err)
		}
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
func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*PersonalLoan, error) {
	rec, err := s.repo.FindByID(ctx, id, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLoanNotFound
		}
		return nil, err
	}
	return rec, nil
}

// ListPendingInstallmentsForCalendar returns every unpaid installment of an
// Active loan, optionally branch-scoped — feeds the reminder calendar's
// personal-loan due/overdue events (see reminder.Service.GetCalendarEvents).
func (s *Service) ListPendingInstallmentsForCalendar(ctx context.Context, branchID *uint) ([]CalendarInstallment, error) {
	return s.repo.FindPendingInstallmentsForCalendar(ctx, branchID)
}

// ListInput mirrors the list page's filters/search/pagination.
type ListInput struct {
	BranchID   *uint
	CustomerID *uint
	Status     string
	Frequency  string
	Query      string
	Limit      int
	Offset     int
}

// List returns one page of loans matching in (limit/offset, page size
// defaults to defaultPageSize when Limit <= 0), plus whether another page
// exists and the TOTAL row count matching in's filters (0 when Limit <= 0)
// — the total is what lets the list page show a real "Page N of M" instead
// of just enabling/disabling Next.
func (s *Service) List(ctx context.Context, in ListInput) ([]PersonalLoan, bool, int64, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = defaultPageSize
	}
	recs, total, err := s.repo.FindAll(ctx, ListFilter{
		BranchID:   in.BranchID,
		CustomerID: in.CustomerID,
		Status:     in.Status,
		Frequency:  in.Frequency,
		Query:      in.Query,
		Limit:      limit,
		Offset:     in.Offset,
	})
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, total, nil
}

const defaultPageSize = 10

// GetSchedule returns one page of a loan's installment schedule
// (limit/offset, page size defaults to defaultPageSize when limit <= 0),
// plus whether another page exists.
func (s *Service) GetSchedule(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]PersonalLoanInstallment, bool, error) {
	if _, err := s.Get(ctx, loanID, branchID); err != nil {
		return nil, false, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	recs, err := s.repo.FindInstallments(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, nil
}

// ListPayments returns one page of a loan's payment ledger (limit/offset,
// page size defaults to defaultPageSize when limit <= 0), newest first,
// plus whether another page exists.
func (s *Service) ListPayments(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]PersonalLoanPayment, bool, error) {
	if _, err := s.Get(ctx, loanID, branchID); err != nil {
		return nil, false, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	recs, err := s.repo.FindPayments(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, nil
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
func (s *Service) RecordPayment(ctx context.Context, loanID uint, branchID *uint, in PaymentInput) (*PersonalLoan, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidPaymentAmount
	}

	var result *PersonalLoan
	var paidAmount float64
	var paidOn time.Time
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rec, err := s.repo.LockByID(ctx, tx, loanID, branchID)
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

		paidAmount = amount
		paidOn = time.Now()
		payment := &PersonalLoanPayment{
			PersonalLoanID:       rec.ID,
			Amount:               amount,
			PaidOn:               paidOn,
			ReceivedByEmployeeID: in.ReceivedByEmployeeID,
			Method:               in.Method,
			Reference:            in.Reference,
			Description:          in.Description,
			RunningBalance:       newOutstanding,
		}
		if err := s.repo.CreatePayment(ctx, tx, payment); err != nil {
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
		if err := s.repo.Update(ctx, tx, rec); err != nil {
			return err
		}

		if err := s.allocatePaymentToInstallments(ctx, tx, rec.ID, amount); err != nil {
			return err
		}

		result = rec
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Best-effort and outside the transaction, same rationale as CreateLoan's
	// disbursement recording above.
	if s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordLoanPaymentCashIn(ctx, result.ID, result.LoanNumber, paidAmount, result.BranchID, paidOn, "Personal Loan Payment"); err != nil {
			log.Printf("cash-in movement (personal loan payment) failed for loan %d: %v", result.ID, err)
		}
	}
	return result, nil
}

// allocatePaymentToInstallments is a best-effort, display-only pass: it
// walks pending/partially-paid installments in due-date order, crediting
// PaidAmount up to each row's Amount until the payment is exhausted. It
// never blocks or constrains the payment itself — see package doc comment
// on installment status being non-authoritative.
func (s *Service) allocatePaymentToInstallments(ctx context.Context, tx *gorm.DB, loanID uint, amount float64) error {
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
		if err := s.repo.UpdateInstallment(ctx, tx, inst); err != nil {
			return err
		}
	}
	return nil
}

// markAllInstallmentsPaid marks every not-yet-Paid installment of a loan as
// fully Paid — used by RenewLoan, where the rollover ledger entry settles
// the whole loan at once rather than crediting specific installments the
// way a real collection does (see allocatePaymentToInstallments).
func (s *Service) markAllInstallmentsPaid(ctx context.Context, tx *gorm.DB, loanID uint) error {
	var installments []PersonalLoanInstallment
	if err := tx.Where("personal_loan_id = ? AND status <> ?", loanID, InstallmentStatusPaid).
		Find(&installments).Error; err != nil {
		return err
	}
	for i := range installments {
		inst := &installments[i]
		inst.PaidAmount = inst.Amount
		inst.Status = InstallmentStatusPaid
		if err := s.repo.UpdateInstallment(ctx, tx, inst); err != nil {
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

func (s *Service) PreviewRenewal(ctx context.Context, loanID uint, branchID *uint, in RenewInput) (*RenewalPreview, error) {
	old, err := s.Get(ctx, loanID, branchID)
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
func (s *Service) RenewLoan(ctx context.Context, loanID uint, branchID *uint, in RenewInput) (*RenewResult, error) {
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
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		old, err := s.repo.LockByID(ctx, tx, loanID, branchID)
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
		count, err := s.repo.CountAll(ctx)
		if err != nil {
			return err
		}
		newLoan.LoanNumber = fmt.Sprintf("PL-%05d", count+1)
		if err := s.repo.Create(ctx, tx, newLoan); err != nil {
			return err
		}
		installments := generateSchedule(newLoan)
		// See CreateLoan's identical stamping loop for why this is needed —
		// the batch-insert tenant stamp otherwise silently drops every
		// installment but a handful, invisible-but-present with TenantID 0.
		for i := range installments {
			installments[i].TenantID = newLoan.TenantID
		}
		if err := s.repo.CreateInstallments(ctx, tx, installments); err != nil {
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
			if err := s.repo.CreatePayment(ctx, tx, payment); err != nil {
				return err
			}
		}

		// The rollover settles the old loan in full — its schedule should
		// read as fully paid, not leave every remaining installment sitting
		// at "Pending" once the loan is Closed/Renewed (RecordPayment's
		// allocatePaymentToInstallments only ever credits a real cash
		// collection against specific installments; a renewal never calls
		// it, so without this every not-yet-due row would otherwise stay
		// Pending forever on a loan that's actually settled).
		if err := s.markAllInstallmentsPaid(ctx, tx, old.ID); err != nil {
			return err
		}
		old.OutstandingAmount = 0
		old.TotalPaid = platform.RoundMoney(old.TotalPaid + rollover)
		old.Status = StatusRenewed
		old.ClosedAt = &now
		old.RenewedToLoanID = &newLoan.ID
		if err := s.repo.Update(ctx, tx, old); err != nil {
			return err
		}

		result = RenewResult{OldLoan: old, NewLoan: newLoan}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Only the new loan's net DisbursedAmount is real cash leaving the till
	// — the rollover portion is a wash (the old loan's outstanding balance
	// simply moves onto the new loan's books, see the PersonalLoanPayment
	// rollover entry above) and must not also be recorded as a cash
	// movement. Best-effort and outside the transaction, same rationale as
	// CreateLoan's disbursement recording.
	if s.cashRecorder != nil && result.NewLoan.DisbursedAmount > epsilon {
		if _, err := s.cashRecorder.RecordLoanDisbursementCashOut(ctx, result.NewLoan.ID, result.NewLoan.LoanNumber, result.NewLoan.DisbursedAmount, result.NewLoan.BranchID, result.NewLoan.DisbursedAt); err != nil {
			log.Printf("cash-out movement (personal loan renewal disbursement) failed for loan %d: %v", result.NewLoan.ID, err)
		}
	}
	return &result, nil
}

// GenerateBond loads the loan + its customer (branch-scoped, same access
// check as every other read on this loan), best-effort decrypts the
// customer's Aadhaar number, and renders the borrower-only bond PDF (see
// bond.go). Mirrors internal/loan.Service's bondDataForLoan decrypt
// rationale: a customer with no Aadhaar on file, or a decrypt failure, just
// leaves the bond's Aadhaar line blank rather than blocking the download.
func (s *Service) GenerateBond(ctx context.Context, loanID uint, branchID *uint) ([]byte, *PersonalLoan, error) {
	loan, err := s.Get(ctx, loanID, branchID)
	if err != nil {
		return nil, nil, err
	}
	cust, err := s.customerRepo.FindByID(ctx, loan.CustomerID)
	if err != nil {
		return nil, nil, err
	}

	var aadhaar string
	if cust.AadhaarEncrypted != "" && s.aadhaarCipher != nil {
		if plain, err := s.aadhaarCipher.Decrypt(cust.AadhaarEncrypted); err == nil {
			aadhaar = plain
		} else {
			log.Printf("personal loan bond: decrypt Aadhaar for customer %d failed: %v", cust.ID, err)
		}
	}

	pdf, err := GenerateBondPDF(ctx, loan, cust, aadhaar)
	if err != nil {
		return nil, nil, err
	}
	return pdf, loan, nil
}

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
	"cloudhouse/backend/internal/workflow"
)

var (
	ErrInvalidPrincipal     = httpx.NewBadRequest("principal amount must be greater than zero")
	ErrInvalidTenureCount   = httpx.NewBadRequest("tenure count must be greater than zero")
	ErrInvalidFrequency     = httpx.NewBadRequest("frequency must be Daily, Weekly or Monthly")
	ErrInvalidInterestType  = httpx.NewBadRequest("interest type must be Flat or Percentage")
	ErrInvalidInterestValue = httpx.NewBadRequest("interest value must not be negative")
	ErrInvalidPenalInterestRate = httpx.NewBadRequest("penal interest rate must not be negative")
	ErrInvalidGracePeriodDays   = httpx.NewBadRequest("grace period days must not be negative")
	ErrInterestTooHigh      = httpx.NewBadRequest("interest amount must be less than the principal amount")
	ErrInvalidPaymentAmount = httpx.NewBadRequest("payment amount must be greater than zero")
	ErrOverpayment          = httpx.NewBadRequest("payment amount exceeds the outstanding balance")
	ErrLoanNotActive        = httpx.NewConflict("loan is not active")
	ErrLoanNotFound         = httpx.NewNotFound("personal loan not found")
	ErrRenewalShortfall     = httpx.NewBadRequest("new principal is not enough to cover the outstanding balance and interest")
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
	// cashAmount/upiAmount/bankTransferAmount/chequeAmount split amount
	// across the mode CashMovement rows actually written (see
	// cash.MovementService.recordSplitCashMovement) — amount stays the
	// authoritative total. customerID (0 = none) populates CashMovement.
	// PartyCustomerID for the Party Transactions ledger.
	RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
	RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, paymentType string, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
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

	// cashGuard blocks a disbursement larger than the branch's Balance in
	// Hand — see SetCashBalanceGuard. nil skips the check.
	cashGuard CashBalanceGuard

	// workflowSvc says whether this tenant has personal-loan approval
	// stages switched on (see SetWorkflow). nil = catalogue default (off).
	workflowSvc *workflow.Service
}

// SetWorkflow wires the per-tenant approval-workflow configuration.
func (s *Service) SetWorkflow(w *workflow.Service) {
	s.workflowSvc = w
}

// CashBalanceGuard is satisfied by *cash.SummaryService (same no-import
// rationale as CashRecorder). EnsureCashInHand returns a Conflict error when
// amount exceeds the branch's Balance in Hand.
type CashBalanceGuard interface {
	EnsureCashInHand(ctx context.Context, branchID uint, amount float64) error
}

func NewService(repo *Repository, customerRepo *customer.Repository, cashRecorder CashRecorder, aadhaarCipher *platform.Cipher) *Service {
	return &Service{repo: repo, customerRepo: customerRepo, cashRecorder: cashRecorder, aadhaarCipher: aadhaarCipher}
}

// SetCashBalanceGuard wires the Balance-in-Hand limit on create and renewal.
func (s *Service) SetCashBalanceGuard(g CashBalanceGuard) {
	s.cashGuard = g
}

func (s *Service) ensureCashInHand(ctx context.Context, branchID uint, amount float64) error {
	if s.cashGuard == nil {
		return nil
	}
	return s.cashGuard.EnsureCashInHand(ctx, branchID, amount)
}

// CreateInput mirrors the "New Personal Loan" form.
type CreateInput struct {
	BranchID            uint
	CustomerID          uint
	PrincipalAmount     float64
	InterestType        string
	InterestValue       float64
	Frequency           string
	TenureCount         int
	CreatedByEmployeeID uint

	// FullDisbursement, when true, disburses the full principal now with no
	// interest withheld upfront — the customer's repayment obligation
	// becomes Principal + InterestAmount instead of the default Principal
	// only. See PersonalLoan.FullDisbursement's doc comment.
	FullDisbursement bool

	// PenalInterestRate/GracePeriodDays feed PersonalLoan's identically named
	// fields — see that struct's doc comment. PenalInterestRate <= 0 means
	// "not supplied": CreateLoan fills in the loan's own effective annual
	// interest rate instead of leaving penal interest disabled, since a
	// personal loan with no explicit penal rate is not meant to have no
	// penalty, just no CUSTOM one.
	PenalInterestRate float64
	GracePeriodDays   int
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

// defaultPenalTerms derives the (PenalInterestRate, PenalFlatAmount) pair to
// use when the caller didn't supply an explicit PenalInterestRate at
// creation — a personal loan with no explicit penal rate still gets a
// penalty, matching its own interest terms rather than 0/disabled.
// Percentage-type loans have a real annual rate to default to (their own
// InterestValue) and use it directly, at full value, per penal cycle — no
// annualizing or proration. Flat-type loans only have a rupee amount for the
// whole tenure, with no percentage to derive from, so they get
// PenalFlatAmount = InterestAmount instead: each missed cycle re-charges the
// same flat interest amount rather than a percentage of the (changing)
// outstanding balance. See PersonalLoan.PenalInterestRate/PenalFlatAmount's
// doc comment and evaluateAndApplyPenal, which picks between the two.
func defaultPenalTerms(interestType string, interestValue, interestAmount float64) (rate, flatAmount float64) {
	if interestType == InterestTypePercentage {
		return interestValue, 0
	}
	return 0, interestAmount
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
	if in.PenalInterestRate < 0 {
		return nil, ErrInvalidPenalInterestRate
	}
	if in.GracePeriodDays < 0 {
		return nil, ErrInvalidGracePeriodDays
	}
	if _, err := s.customerRepo.FindByID(ctx, in.CustomerID); err != nil {
		return nil, err
	}

	principal := platform.RoundMoney(in.PrincipalAmount)
	interestAmount := computeInterest(principal, in.InterestType, in.InterestValue)
	if interestAmount >= principal {
		return nil, ErrInterestTooHigh
	}

	// Default: interest withheld upfront, customer receives Principal-
	// Interest in cash but owes Principal back (obligation = principal).
	// FullDisbursement: the customer receives the full Principal in cash and
	// owes Principal+Interest back instead — the obligation total (not just
	// Principal) is what feeds the schedule/OutstandingAmount below, exactly
	// like the default path already feeds its own obligation (Principal)
	// into the same fields.
	disbursed := platform.RoundMoney(principal - interestAmount)
	obligation := principal
	if in.FullDisbursement {
		disbursed = principal
		obligation = platform.RoundMoney(principal + interestAmount)
	}
	// With the tenant's personal-loan approval chain switched on, the loan
	// is only saved here — its schedule, history and cash-out (and so the
	// Balance-in-Hand check) all wait for the final approval (ApproveLoan).
	chain, err := s.workflowSvc.Chain(ctx, workflow.FlowPersonalLoan)
	if err != nil {
		return nil, err
	}
	firstStage, needsApproval := chain.First()
	if !needsApproval {
		if err := s.ensureCashInHand(ctx, in.BranchID, disbursed); err != nil {
			return nil, err
		}
	}
	installmentAmount := platform.RoundMoney(obligation / float64(in.TenureCount))

	penalRate := in.PenalInterestRate
	var penalFlatAmount float64
	if penalRate <= 0 {
		penalRate, penalFlatAmount = defaultPenalTerms(in.InterestType, in.InterestValue, interestAmount)
	}

	now := time.Now()
	rec := &PersonalLoan{
		BranchID:            in.BranchID,
		CustomerID:          in.CustomerID,
		CreatedByEmployeeID: in.CreatedByEmployeeID,
		PrincipalAmount:     obligation,
		InterestType:        in.InterestType,
		InterestValue:       platform.RoundMoney(in.InterestValue),
		InterestAmount:      interestAmount,
		DisbursedAmount:     disbursed,
		FullDisbursement:    in.FullDisbursement,
		Frequency:           in.Frequency,
		TenureCount:         in.TenureCount,
		InstallmentAmount:   installmentAmount,
		OutstandingAmount:   obligation,
		TotalPaid:           0,
		Status:              StatusActive,
		OpenedDate:          now,
		DisbursedAt:         now,
		PenalInterestRate:   penalRate,
		PenalFlatAmount:     penalFlatAmount,
		GracePeriodDays:     in.GracePeriodDays,
	}
	if needsApproval {
		rec.Status = StatusPendingApproval
		rec.ApprovalStage = firstStage.Pending
	}

	err = s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		count, err := s.repo.CountAll(ctx)
		if err != nil {
			return err
		}
		rec.LoanNumber = fmt.Sprintf("PL-%05d", count+1)

		if err := s.repo.Create(ctx, tx, rec); err != nil {
			return err
		}
		if needsApproval {
			return nil
		}
		return s.activateTx(ctx, tx, rec, now)
	})
	if err != nil {
		return nil, err
	}
	if !needsApproval {
		s.recordDisbursement(ctx, rec, now)
	}
	return rec, nil
}

// activateTx creates a disbursed loan's repayment schedule and its
// "loan opened" history row — the part of creation that only happens once
// the money goes out (at creation, or at an approval chain's final stage).
func (s *Service) activateTx(ctx context.Context, tx *gorm.DB, rec *PersonalLoan, now time.Time) error {
	{
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
		return s.logHistory(ctx, tx, rec.ID, rec.TenantID, EventLoanCreated,
			fmt.Sprintf("Loan opened for ₹%.2f", rec.PrincipalAmount), rec.PrincipalAmount, nil, now)
	}
}

// recordDisbursement books the disbursement cash-out. The cash actually
// leaves the till only once the loan (and its schedule) is durably
// persisted — best-effort and outside the transaction, same as
// internal/loan's disbursement/payment cash recording: a failure here is
// logged, not fatal to loan creation.
func (s *Service) recordDisbursement(ctx context.Context, rec *PersonalLoan, now time.Time) {
	if s.cashRecorder != nil {
		// No split-mode UI on loan creation (Phase 2's split-payment work
		// covers repayments/disbursement-with-a-breakdown for gold loans,
		// not personal-loan disbursement) — all-zero split amounts fall back
		// to one legacy-style unmoded row (see cash.MovementService.
		// recordSplitCashMovement).
		if _, _, err := s.cashRecorder.RecordLoanDisbursementCashOut(ctx, rec.ID, rec.LoanNumber, rec.DisbursedAmount, 0, 0, 0, 0, rec.BranchID, now, rec.CustomerID, nil); err != nil {
			log.Printf("cash-out movement (personal loan disbursement) failed for loan %d: %v", rec.ID, err)
		}
	}
}

// ApprovalInput mirrors the body of POST /personal-loans/:id/approve.
type ApprovalInput struct {
	Stage           string // workflow.FlowPersonalLoan stage key — must match the loan's current stage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRole       string
	ActorRoleID     uint
	Remarks         string
}

var (
	ErrNotPendingApproval = httpx.NewConflict("this personal loan is not waiting for approval")
	ErrWrongApprovalStage = httpx.NewForbidden("this loan is not at a stage your role can act on")
	ErrInvalidAction      = httpx.NewBadRequest("action must be Approved or Rejected")
)

// ApproveLoan advances (or rejects) a StatusPendingApproval loan through the
// tenant's personal-loan approval chain. The final enabled stage disburses
// it: Balance-in-Hand check, schedule from today, history, cash-out.
func (s *Service) ApproveLoan(ctx context.Context, id uint, branchID *uint, in ApprovalInput) (*PersonalLoan, error) {
	rec, err := s.repo.FindByID(ctx, id, branchID)
	if err != nil {
		return nil, ErrLoanNotFound
	}
	if rec.Status != StatusPendingApproval {
		return nil, ErrNotPendingApproval
	}
	if in.Action != workflow.ActionApproved && in.Action != workflow.ActionRejected {
		return nil, ErrInvalidAction
	}
	chain, err := s.workflowSvc.Chain(ctx, workflow.FlowPersonalLoan)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(rec.ApprovalStage)
	if !ok || in.Stage != step.Key {
		return nil, ErrWrongApprovalStage
	}
	if !s.workflowSvc.CanAct(ctx, in.ActorRoleID, workflow.FlowPersonalLoan, step.Key) {
		return nil, ErrWrongApprovalStage
	}

	next, hasNext := chain.Next(step.Key)
	disbursing := false
	now := time.Now()
	switch {
	case in.Action == workflow.ActionRejected:
		rec.Status = StatusRejected
		rec.ApprovalStage = workflow.ActionRejected
	case hasNext:
		rec.ApprovalStage = next.Pending
	default:
		if err := s.ensureCashInHand(ctx, rec.BranchID, rec.DisbursedAmount); err != nil {
			return nil, err
		}
		disbursing = true
		rec.Status = StatusActive
		rec.ApprovalStage = workflow.ActionApproved
		// The schedule runs from the day the money actually goes out.
		rec.OpenedDate = now
		rec.DisbursedAt = now
	}

	err = s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.repo.Update(ctx, tx, rec); err != nil {
			return err
		}
		if disbursing {
			return s.activateTx(ctx, tx, rec, now)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if disbursing {
		s.recordDisbursement(ctx, rec, now)
	}
	s.workflowSvc.RecordAction(ctx, &workflow.ApprovalAction{
		Flow: workflow.FlowPersonalLoan, EntityID: rec.ID, Stage: step.Key, Action: in.Action,
		ActorEmployeeID: in.ActorEmployeeID, ActorRole: in.ActorRole, Remarks: in.Remarks,
	})
	return s.repo.FindByID(ctx, rec.ID, branchID)
}

// ListApprovals returns a loan's approval-decision history.
func (s *Service) ListApprovals(ctx context.Context, id uint, branchID *uint) ([]workflow.ApprovalAction, error) {
	if _, err := s.repo.FindByID(ctx, id, branchID); err != nil {
		return nil, ErrLoanNotFound
	}
	return s.workflowSvc.ListActions(ctx, workflow.FlowPersonalLoan, id)
}

// generateSchedule builds loan.TenureCount installment rows starting the
// first period after OpenedDate, stepping by Frequency (daily +1 day,
// weekly +7 days, monthly +1 calendar month). Every row is
// InstallmentAmount except the last, which is set to whatever principal
// remains so the schedule sums to exactly PrincipalAmount regardless of
// rounding drift from the Principal/TenureCount division.
func generateSchedule(loan *PersonalLoan) []PersonalLoanInstallment {
	return generateScheduleFrom(loan, loan.OpenedDate)
}

// generateScheduleFrom is generateSchedule with an explicit anchor instead of
// always OpenedDate — used by penal.go to regenerate a fresh schedule
// starting from the moment a penal charge fires, without disturbing the
// loan's original OpenedDate (kept as the loan's true origination date for
// display/reporting).
func generateScheduleFrom(loan *PersonalLoan, anchor time.Time) []PersonalLoanInstallment {
	recs := make([]PersonalLoanInstallment, 0, loan.TenureCount)
	due := anchor
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

// logHistory writes one PersonalLoanHistory row inside tx — called from
// CreateLoan/RenewLoan/applyPenalIfDue right alongside the mutation each
// describes so the change-history timeline stays consistent with the loan
// row it documents.
func (s *Service) logHistory(ctx context.Context, tx *gorm.DB, loanID uint, tenantID uint, event, detail string, amount float64, relatedLoanID *uint, occurredAt time.Time) error {
	rec := &PersonalLoanHistory{
		PersonalLoanID: loanID,
		Event:          event,
		Detail:         detail,
		Amount:         amount,
		RelatedLoanID:  relatedLoanID,
		OccurredAt:     occurredAt,
	}
	rec.TenantID = tenantID
	return s.repo.CreateHistory(ctx, tx, rec)
}

// GetHistory returns one page of a loan's change-history timeline
// (limit/offset, page size defaults to defaultPageSize when limit <= 0),
// plus whether another page exists and the TOTAL row count — backs the
// Personal Loan detail page's History table (switchable with Schedule).
func (s *Service) GetHistory(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]PersonalLoanHistory, bool, int64, error) {
	if _, err := s.Get(ctx, loanID, branchID); err != nil {
		return nil, false, 0, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	total, err := s.repo.CountHistory(ctx, loanID)
	if err != nil {
		return nil, false, 0, err
	}
	recs, err := s.repo.FindHistory(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, total, nil
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
// plus whether another page exists and the TOTAL row count — the total is
// what lets the Schedule table show a real "Page N of M" instead of just
// enabling/disabling Next (see Service.List's identical reasoning).
func (s *Service) GetSchedule(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]PersonalLoanInstallment, bool, int64, error) {
	if _, err := s.Get(ctx, loanID, branchID); err != nil {
		return nil, false, 0, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	total, err := s.repo.CountInstallments(ctx, loanID)
	if err != nil {
		return nil, false, 0, err
	}
	recs, err := s.repo.FindInstallments(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, total, nil
}

// ListPayments returns one page of a loan's payment ledger (limit/offset,
// page size defaults to defaultPageSize when limit <= 0), newest first,
// plus whether another page exists and the TOTAL row count.
func (s *Service) ListPayments(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]PersonalLoanPayment, bool, int64, error) {
	if _, err := s.Get(ctx, loanID, branchID); err != nil {
		return nil, false, 0, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	total, err := s.repo.CountPayments(ctx, loanID)
	if err != nil {
		return nil, false, 0, err
	}
	recs, err := s.repo.FindPayments(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, total, nil
}

// PaymentInput mirrors the "Collect Payment" form. Method is no longer
// accepted as free-text input — CashAmount/UpiAmount/BankTransferAmount/
// ChequeAmount (NOT NULL DEFAULT 0, must sum to Amount within
// platform.RoundMoney's tolerance — see platform.ValidateSplit) are now the
// source of truth, and the stored PersonalLoanPayment.Method is derived
// from them (platform.DeriveMethod) for old readers.
type PaymentInput struct {
	Amount               float64
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	Reference            string
	Description          string
	ReceivedByEmployeeID *uint
	// BankID is which bank the UPI/Bank Transfer/Cheque portion of this
	// payment landed in — required by validation when any of those three
	// split amounts is non-zero (see ErrBankRequiredForSplitMode). Nil for
	// a Cash-only payment.
	BankID *uint
}

// ErrBankRequiredForSplitMode is returned when any of UpiAmount/
// BankTransferAmount/ChequeAmount is non-zero but PaymentInput.BankID is
// nil — mirrors loan.ErrBankRequiredForSplitMode's rationale.
var ErrBankRequiredForSplitMode = httpx.NewBadRequest("bank is required when the payment breakdown includes UPI, Bank Transfer, or Cheque")

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
		switch rec.Status {
		case StatusActive, StatusPending:
		default:
			return ErrLoanNotActive
		}
		amount := platform.RoundMoney(in.Amount)
		if amount > rec.OutstandingAmount+epsilon {
			return ErrOverpayment
		}
		if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, amount); err != nil {
			return err
		}
		if (in.UpiAmount > 0 || in.BankTransferAmount > 0 || in.ChequeAmount > 0) && in.BankID == nil {
			return ErrBankRequiredForSplitMode
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
			Method:               platform.DeriveMethod(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount),
			CashAmount:           in.CashAmount,
			UpiAmount:            in.UpiAmount,
			BankTransferAmount:   in.BankTransferAmount,
			ChequeAmount:         in.ChequeAmount,
			BankID:               in.BankID,
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
		} else if rec.Status == StatusPending {
			// A Pending loan reverts to Active as soon as its CURRENT
			// schedule is no longer past its own grace period — Pending is
			// a live "currently past grace with a balance owed" indicator,
			// not a one-way flag, and this payment may be exactly what took
			// it current again. If it's still overdue (e.g. a partial
			// payment that doesn't clear the arrears in time), it stays
			// Pending until the next penal sweep evaluates it again.
			var currentInstallments []PersonalLoanInstallment
			if err := tx.Where("personal_loan_id = ?", rec.ID).Find(&currentInstallments).Error; err != nil {
				return err
			}
			if !isPastGracePeriod(rec, currentInstallments, time.Now()) {
				rec.Status = StatusActive
			}
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
		if _, _, err := s.cashRecorder.RecordLoanPaymentCashIn(ctx, result.ID, result.LoanNumber, paidAmount, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, result.BranchID, paidOn, "Personal Loan Payment", result.CustomerID, in.BankID); err != nil {
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
	// A Pending loan (past its schedule + grace period, already carrying a
	// penal charge in OutstandingAmount — see penal.go) can still be
	// renewed, same as an Active one: renewal always rolls over whatever
	// OutstandingAmount currently is, penal-adjusted or not, with no special
	// case needed for either status.
	switch old.Status {
	case StatusActive, StatusPending:
	default:
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
		switch old.Status {
		case StatusActive, StatusPending:
		default:
			return ErrLoanNotActive
		}
		if old.RenewedToLoanID != nil {
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
		if err := s.ensureCashInHand(ctx, old.BranchID, disbursed); err != nil {
			return err
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
		// Closed, not the old StatusRenewed — a renewed loan really is
		// finished (fully settled via the rollover above, gold/repayment
		// obligation moved to the new loan); RenewedToLoanID already
		// records that it was closed BY a renewal specifically, so nothing
		// is lost by not having a separate status for it, and every
		// "closed loans" list/filter now correctly includes it.
		old.Status = StatusClosed
		old.ClosedAt = &now
		old.RenewedToLoanID = &newLoan.ID
		if err := s.repo.Update(ctx, tx, old); err != nil {
			return err
		}

		if err := s.logHistory(ctx, tx, old.ID, old.TenantID, EventLoanRenewed,
			fmt.Sprintf("Renewed into loan %s", newLoan.LoanNumber), newLoan.PrincipalAmount, &newLoan.ID, now); err != nil {
			return err
		}
		if err := s.logHistory(ctx, tx, newLoan.ID, newLoan.TenantID, EventLoanCreated,
			fmt.Sprintf("Loan opened for ₹%.2f (renewed from loan %s)", newLoan.PrincipalAmount, old.LoanNumber), newLoan.PrincipalAmount, &old.ID, now); err != nil {
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
		// No split-mode UI on renewal either — see CreateLoan's identical
		// all-zero rationale above.
		if _, _, err := s.cashRecorder.RecordLoanDisbursementCashOut(ctx, result.NewLoan.ID, result.NewLoan.LoanNumber, result.NewLoan.DisbursedAmount, 0, 0, 0, 0, result.NewLoan.BranchID, result.NewLoan.DisbursedAt, result.NewLoan.CustomerID, nil); err != nil {
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

// ErrCustomerNotFound is the refusal for a customer id that does not resolve
// inside the caller's own business.
var ErrCustomerNotFound = httpx.NewNotFound("customer not found")

// EnsureCustomerExists resolves a customer id under the CALLER's tenant, and
// is the ownership check behind GET /customers/:id/personal-loans.
//
// Same fix, same reasoning as investment.Service.EnsureCustomerExists and
// loan.Service.ListLoansForCustomer: the tenant-scoped lookup IS the check,
// and 404 is the right refusal because 403 would confirm the customer exists
// and belongs to someone else. Before this the endpoint answered 200 with an
// empty list for any customer id at all, disagreeing with every sibling
// route under /customers/:id/*.
func (s *Service) EnsureCustomerExists(ctx context.Context, customerID uint) error {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return ErrCustomerNotFound
	}
	return nil
}

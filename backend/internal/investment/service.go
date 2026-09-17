package investment

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

var (
	ErrInvalidPrincipal       = httpx.NewBadRequest("principal amount must be greater than zero")
	ErrPrincipalBelowMin      = httpx.NewBadRequest("principal amount is below the plan's minimum")
	ErrInvalidTenure          = httpx.NewBadRequest("tenure months must be greater than zero")
	ErrInvalidFrequency       = httpx.NewBadRequest("payout frequency must be Monthly or Yearly")
	ErrInvalidRateType        = httpx.NewBadRequest("interest rate type must be Simple or Compound")
	ErrInvalidRatePercent     = httpx.NewBadRequest("interest rate percent must not be negative")
	ErrTenureNotDivisible     = httpx.NewBadRequest("tenure months must divide evenly by the payout frequency")
	ErrPlanNotFound           = httpx.NewNotFound("investment plan not found")
	ErrPlanInactive           = httpx.NewBadRequest("investment plan is not active")
	ErrInvestmentNotFound     = httpx.NewNotFound("investment not found")
	ErrInvestmentNotActive    = httpx.NewConflict("investment is not active")
	ErrInvestmentNotMatured   = httpx.NewConflict("investment has not matured yet")
	ErrPayoutNotFound         = httpx.NewNotFound("payout not found")
	ErrPayoutAlreadyPaid      = httpx.NewConflict("payout has already been paid")
	ErrPayoutBelongsElsewhere = httpx.NewNotFound("payout not found")
	ErrInvalidMaturityAction  = httpx.NewBadRequest("maturity decision must be Close or Renew")
	ErrInvalidEngine          = httpx.NewBadRequest("engine must be Schedule or Live")

	// --- Live-engine (Add Cash / Withdraw) errors ---
	ErrInvalidAmount                  = httpx.NewBadRequest("amount must be greater than zero")
	ErrNotLiveEngine                  = httpx.NewBadRequest("this action is only available for investments using the live accrual engine")
	ErrInsufficientPrincipal          = httpx.NewConflict("withdrawal exceeds the outstanding principal")
	ErrInsufficientInterest           = httpx.NewConflict("withdrawal exceeds the outstanding interest")
	ErrLiveEngineMaturityNotSupported = httpx.NewBadRequest("maturity decisions for live-engine investments are not yet supported — withdraw the outstanding balance instead")
)

const epsilon = 0.01

// CashRecorder reflects an investment's real cash flow into Cash-in-Hand —
// a deposit is cash IN (the investor hands the system money), an interest
// or principal-return payout is cash OUT — the exact inverse of
// personalloan.CashRecorder's direction, mirroring its narrow-interface
// pattern so this package doesn't import internal/cash directly.
type CashRecorder interface {
	RecordInvestmentDepositCashIn(ctx context.Context, investmentID uint, investmentNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)

	// cashAmount/upiAmount/bankTransferAmount/chequeAmount split amount
	// across the mode CashMovement rows actually written (see
	// cash.MovementService.recordSplitCashMovement) — amount stays the
	// authoritative total. customerID (0 = none) populates CashMovement.
	// PartyCustomerID for the Party Transactions ledger.
	RecordInvestmentPayoutCashOut(ctx context.Context, investmentID uint, investmentNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, payoutType string, customerID uint) (movementID uint, err error)
}

// CommsRecorder logs a notification/comms-history entry for an investment
// event (interest paid, matured) — kept as a narrow interface so this
// package doesn't need to import internal/notification or internal/commlog
// directly; nil is a valid, no-op value (best-effort, like CashRecorder is
// treated in personalloan.Service.CreateLoan).
type CommsRecorder interface {
	NotifyInterestPayout(ctx context.Context, customerID uint, investmentNumber string, amount float64) error
	NotifyInvestmentMatured(ctx context.Context, customerID uint, investmentNumber string) error
}

// Service implements investment business rules on top of the Repository.
type Service struct {
	repo         *Repository
	customerRepo *customer.Repository
	cashRecorder CashRecorder
	comms        CommsRecorder
}

func NewService(repo *Repository, customerRepo *customer.Repository, cashRecorder CashRecorder, comms CommsRecorder) *Service {
	return &Service{repo: repo, customerRepo: customerRepo, cashRecorder: cashRecorder, comms: comms}
}

// --- Plans ---

// PlanInput mirrors the "New Investment Plan" form.
type PlanInput struct {
	Name                string
	InterestRateType    string
	InterestRatePercent float64
	PayoutFrequency     string
	TenureMonths        int
	MinPrincipal        float64
	IsActive            bool
	Engine              string
}

// validateFrequency reports whether freq is a legal PayoutFrequency for the
// given engine — EngineSchedule accepts Monthly/Quarterly/Yearly (its
// generatePayoutSchedule stepping is month-based, and Quarterly is just a
// 3-month step; Daily/Weekly need day-based stepping the schedule engine
// doesn't have), while EngineLive's accrual engine (accrual.go) accepts all
// five.
func validateFrequency(engine, freq string) bool {
	if engine == EngineLive {
		switch freq {
		case PayoutFrequencyDaily, PayoutFrequencyWeekly, PayoutFrequencyMonthly, PayoutFrequencyQuarterly, PayoutFrequencyYearly:
			return true
		}
		return false
	}
	switch freq {
	case PayoutFrequencyMonthly, PayoutFrequencyQuarterly, PayoutFrequencyYearly:
		return true
	}
	return false
}

func validateRateType(t string) bool {
	switch t {
	case InterestRateTypeSimple, InterestRateTypeCompound:
		return true
	}
	return false
}

func validateEngine(e string) bool {
	switch e {
	case EngineSchedule, EngineLive:
		return true
	}
	return false
}

// monthsPerPeriod returns how many months elapse between payouts for a
// given EngineSchedule frequency — 1 for Monthly, 3 for Quarterly, 12 for
// Yearly. Only ever called for EngineSchedule plans/investments (Daily/
// Weekly are not legal for that engine — see validateFrequency).
func monthsPerPeriod(frequency string) int {
	switch frequency {
	case PayoutFrequencyYearly:
		return 12
	case PayoutFrequencyQuarterly:
		return 3
	default:
		return 1
	}
}

// engineOrDefault returns e, or EngineSchedule when e is empty — lets
// existing callers/tests that never set PlanInput.Engine keep getting the
// original product without having to be updated.
func engineOrDefault(e string) string {
	if e == "" {
		return EngineSchedule
	}
	return e
}

func (s *Service) CreatePlan(ctx context.Context, in PlanInput) (*InvestmentPlan, error) {
	engine := engineOrDefault(in.Engine)
	if !validateEngine(engine) {
		return nil, ErrInvalidEngine
	}
	if in.TenureMonths <= 0 {
		return nil, ErrInvalidTenure
	}
	if !validateFrequency(engine, in.PayoutFrequency) {
		return nil, ErrInvalidFrequency
	}
	if !validateRateType(in.InterestRateType) {
		return nil, ErrInvalidRateType
	}
	if in.InterestRatePercent < 0 {
		return nil, ErrInvalidRatePercent
	}
	// The tenure/frequency divisibility rule only applies to EngineSchedule,
	// whose generatePayoutSchedule steps in whole calendar-month periods —
	// EngineLive accrues continuously and has no fixed schedule to divide
	// evenly.
	if engine == EngineSchedule && in.TenureMonths%monthsPerPeriod(in.PayoutFrequency) != 0 {
		return nil, ErrTenureNotDivisible
	}
	rec := &InvestmentPlan{
		Name:                in.Name,
		InterestRateType:    in.InterestRateType,
		InterestRatePercent: platform.RoundMoney(in.InterestRatePercent),
		PayoutFrequency:     in.PayoutFrequency,
		TenureMonths:        in.TenureMonths,
		MinPrincipal:        platform.RoundMoney(in.MinPrincipal),
		IsActive:            in.IsActive,
		Engine:              engine,
	}
	if err := s.repo.CreatePlan(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) UpdatePlan(ctx context.Context, id uint, in PlanInput) (*InvestmentPlan, error) {
	rec, err := s.repo.FindPlanByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlanNotFound
		}
		return nil, err
	}
	engine := engineOrDefault(in.Engine)
	if !validateEngine(engine) {
		return nil, ErrInvalidEngine
	}
	if in.TenureMonths <= 0 {
		return nil, ErrInvalidTenure
	}
	if !validateFrequency(engine, in.PayoutFrequency) {
		return nil, ErrInvalidFrequency
	}
	if !validateRateType(in.InterestRateType) {
		return nil, ErrInvalidRateType
	}
	if in.InterestRatePercent < 0 {
		return nil, ErrInvalidRatePercent
	}
	if engine == EngineSchedule && in.TenureMonths%monthsPerPeriod(in.PayoutFrequency) != 0 {
		return nil, ErrTenureNotDivisible
	}
	rec.Engine = engine
	rec.Name = in.Name
	rec.InterestRateType = in.InterestRateType
	rec.InterestRatePercent = platform.RoundMoney(in.InterestRatePercent)
	rec.PayoutFrequency = in.PayoutFrequency
	rec.TenureMonths = in.TenureMonths
	rec.MinPrincipal = platform.RoundMoney(in.MinPrincipal)
	rec.IsActive = in.IsActive
	if err := s.repo.UpdatePlan(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) ListPlans(ctx context.Context, activeOnly bool) ([]InvestmentPlan, error) {
	return s.repo.FindAllPlans(ctx, activeOnly)
}

func (s *Service) GetPlan(ctx context.Context, id uint) (*InvestmentPlan, error) {
	rec, err := s.repo.FindPlanByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlanNotFound
		}
		return nil, err
	}
	return rec, nil
}

// --- Investments ---

// CreateInput mirrors the "New Investment" form.
type CreateInput struct {
	BranchID            uint
	CustomerID          uint
	PlanID              uint
	PrincipalAmount     float64
	StartDate           time.Time // zero = today
	CreatedByEmployeeID uint
}

// CreateInvestment validates the input against the chosen plan, snapshots
// the plan's terms onto the Investment, generates the full interest-payout
// schedule, records the deposit as cash in, and persists everything in one
// transaction — mirrors personalloan.Service.CreateLoan.
func (s *Service) CreateInvestment(ctx context.Context, in CreateInput) (*Investment, error) {
	if in.PrincipalAmount <= 0 {
		return nil, ErrInvalidPrincipal
	}
	if _, err := s.customerRepo.FindByID(ctx, in.CustomerID); err != nil {
		return nil, err
	}
	plan, err := s.repo.FindPlanByID(ctx, in.PlanID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlanNotFound
		}
		return nil, err
	}
	if !plan.IsActive {
		return nil, ErrPlanInactive
	}
	principal := platform.RoundMoney(in.PrincipalAmount)
	if principal < plan.MinPrincipal {
		return nil, ErrPrincipalBelowMin
	}

	startDate := in.StartDate
	if startDate.IsZero() {
		startDate = time.Now()
	}
	maturityDate := startDate.AddDate(0, plan.TenureMonths, 0)

	rec := &Investment{
		BranchID:            in.BranchID,
		CustomerID:          in.CustomerID,
		PlanID:              plan.ID,
		CreatedByEmployeeID: in.CreatedByEmployeeID,
		PrincipalAmount:     principal,
		InterestRateType:    plan.InterestRateType,
		InterestRatePercent: plan.InterestRatePercent,
		PayoutFrequency:     plan.PayoutFrequency,
		TenureMonths:        plan.TenureMonths,
		Engine:              engineOrDefault(plan.Engine),
		StartDate:           startDate,
		MaturityDate:        maturityDate,
		Status:              StatusActive,
	}
	if rec.Engine == EngineLive {
		// Live-engine investments seed their running balance and accrual
		// anchor here instead of generating a payout schedule below — see
		// accrual.go's projectAccrual, which reads OutstandingPrincipal/
		// LastAccrualDate rather than a precomputed InvestmentPayout row.
		rec.OutstandingPrincipal = principal
		rec.LastAccrualDate = startDate
	}

	err = s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		count, err := s.repo.CountAll(ctx)
		if err != nil {
			return err
		}
		rec.InvestmentNumber = fmt.Sprintf("INV-%05d", count+1)

		if err := s.repo.Create(ctx, tx, rec); err != nil {
			return err
		}

		if rec.Engine != EngineLive {
			payouts := generatePayoutSchedule(rec)
			// GORM's tenant-stamp Create hook (platform.stampCallback)
			// reliably sets TenantID for a single-struct create — which is
			// how `rec` above just got stamped — but does not propagate to
			// every element of a []InvestmentPayout batch insert (see
			// personalloan.Service.CreateLoan's identical fix/comment). Left
			// unstamped, most payout rows persist with TenantID 0: not
			// rejected, just invisible afterwards to any normally
			// tenant-scoped query, so the payout schedule tab would show
			// only a handful of rows for a long-tenure investment.
			for i := range payouts {
				payouts[i].TenantID = rec.TenantID
			}
			if err := s.repo.CreatePayouts(ctx, tx, payouts); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// The deposit is recorded once the investment (and its schedule, if any)
	// is durably persisted — best-effort and outside the transaction, same
	// as personalloan.Service.CreateLoan's disbursement recording.
	if s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordInvestmentDepositCashIn(ctx, rec.ID, rec.InvestmentNumber, rec.PrincipalAmount, rec.BranchID, startDate); err != nil {
			log.Printf("cash-in movement (investment deposit) failed for investment %d: %v", rec.ID, err)
		}
	}
	return rec, nil
}

// generatePayoutSchedule builds TenureMonths/monthsPerPeriod interest-due
// rows starting the first period after StartDate, stepping by
// PayoutFrequency (Monthly +1 calendar month, Quarterly +3, Yearly +12).
// Each row's Amount
// is the interest earned that period: Simple interest is a flat fraction
// of the principal every period; Compound recomputes off the cumulative
// compounded value so later periods earn slightly more, matching standard
// "interest paid out each period, compounding on the untouched principal"
// behavior.
func generatePayoutSchedule(inv *Investment) []InvestmentPayout {
	step := monthsPerPeriod(inv.PayoutFrequency)
	periods := inv.TenureMonths / step
	periodsPerYear := 12.0 / float64(step)

	recs := make([]InvestmentPayout, 0, periods)
	due := inv.StartDate
	var prevCompoundedValue = inv.PrincipalAmount
	for i := 1; i <= periods; i++ {
		due = due.AddDate(0, step, 0)

		var amount float64
		switch inv.InterestRateType {
		case InterestRateTypeCompound:
			ratePerPeriod := inv.InterestRatePercent / 100 / periodsPerYear
			nextValue := platform.RoundMoney(prevCompoundedValue * (1 + ratePerPeriod))
			amount = platform.RoundMoney(nextValue - prevCompoundedValue)
			prevCompoundedValue = nextValue
		default: // InterestRateTypeSimple
			amount = platform.RoundMoney(inv.PrincipalAmount * inv.InterestRatePercent / 100 / periodsPerYear)
		}

		recs = append(recs, InvestmentPayout{
			InvestmentID: inv.ID,
			SequenceNo:   i,
			DueDate:      due,
			Amount:       amount,
			Status:       PayoutStatusPending,
		})
	}
	return recs
}

// Get returns a single investment, branch-scoped. For an EngineLive
// investment this also settles (and persists) any interest accrued since
// LastAccrualDate up to now before returning — mirrors
// loan.Service.accrueAndEnrich's "a detail view is where staff act on the
// numbers, so nail them down" rationale. An EngineSchedule investment runs
// none of this — completely unchanged behavior.
func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*Investment, error) {
	rec, err := s.repo.FindByID(ctx, id, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvestmentNotFound
		}
		return nil, err
	}
	if rec.Engine == EngineLive {
		if err := s.settleAndSave(ctx, nil, rec, time.Now()); err != nil {
			return nil, err
		}
		rec.OutstandingInterest = clampMoney(rec.AccruedInterest - rec.InterestWithdrawn)
	}
	return rec, nil
}

// ListInput mirrors personalloan.ListInput.
type ListInput struct {
	BranchID   *uint
	CustomerID *uint
	Status     string
	Query      string
	Limit      int
	Offset     int
}

// List returns one page of investments plus a hasMore flag and the TOTAL
// row count matching in's filters (0 when Limit <= 0) — mirrors
// personalloan.Service.List's Limit+1 trick and total-count addition.
func (s *Service) List(ctx context.Context, in ListInput) ([]Investment, bool, int64, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = 10
	}
	recs, total, err := s.repo.FindAll(ctx, ListFilter{
		BranchID:   in.BranchID,
		CustomerID: in.CustomerID,
		Status:     in.Status,
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
	// Listing is read-only and can return many rows, so EngineLive accrual
	// here is projected into the in-memory copy for display only (never
	// saved) — Get is what actually advances AccruedInterest/
	// LastAccrualDate in the DB. Mirrors loan.Service.List's identical
	// comment. EngineSchedule rows are untouched.
	now := time.Now()
	for i := range recs {
		if recs[i].Engine != EngineLive {
			continue
		}
		delta, _ := projectAccrual(&recs[i], now)
		recs[i].OutstandingInterest = clampMoney(recs[i].AccruedInterest + delta - recs[i].InterestWithdrawn)
	}
	return recs, hasMore, total, nil
}

// GetSchedule returns one page of an investment's payout schedule — mirrors
// personalloan.Service.GetSchedule.
func (s *Service) GetSchedule(ctx context.Context, investmentID uint, branchID *uint, limit, offset int) ([]InvestmentPayout, bool, error) {
	if _, err := s.Get(ctx, investmentID, branchID); err != nil {
		return nil, false, err
	}
	if limit <= 0 {
		limit = 10
	}
	recs, err := s.repo.FindPayouts(ctx, investmentID, limit, offset)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, nil
}

// MarkPayoutPaidInput carries the split-mode breakdown of a payout being
// paid out — CashAmount/UpiAmount/BankTransferAmount/ChequeAmount (NOT NULL
// DEFAULT 0) must sum to the payout's own Amount within
// platform.RoundMoney's tolerance (see platform.ValidateSplit).
type MarkPayoutPaidInput struct {
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
}

// MarkPayoutPaid marks one due payout as Paid: row-locks the payout and its
// parent investment, validates state, records the cash-out, updates the
// investment's running TotalInterestPaid, and best-effort notifies the
// investor — mirrors personalloan.Service.RecordPayment's transactional
// shape but the cash direction is reversed (payout = cash OUT).
func (s *Service) MarkPayoutPaid(ctx context.Context, investmentID, payoutID uint, branchID *uint, employeeID uint, in MarkPayoutPaidInput) (*InvestmentPayout, error) {
	inv, err := s.Get(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	if inv.Status != StatusActive && inv.Status != StatusMatured {
		return nil, ErrInvestmentNotActive
	}

	var payout InvestmentPayout
	err = s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lockedInv, err := s.repo.LockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			return err
		}
		p, err := s.repo.LockPayoutByID(ctx, tx, payoutID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPayoutNotFound
			}
			return err
		}
		if p.InvestmentID != lockedInv.ID {
			return ErrPayoutBelongsElsewhere
		}
		if p.Status == PayoutStatusPaid {
			return ErrPayoutAlreadyPaid
		}
		if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, p.Amount); err != nil {
			return err
		}

		now := time.Now()
		p.Status = PayoutStatusPaid
		p.PaidAt = &now
		p.PaidByEmployeeID = &employeeID
		p.CashAmount = in.CashAmount
		p.UpiAmount = in.UpiAmount
		p.BankTransferAmount = in.BankTransferAmount
		p.ChequeAmount = in.ChequeAmount
		if err := s.repo.UpdatePayout(ctx, tx, p); err != nil {
			return err
		}

		if !p.IsPrincipalReturn {
			lockedInv.TotalInterestPaid = platform.RoundMoney(lockedInv.TotalInterestPaid + p.Amount)
		}
		if err := s.repo.Update(ctx, tx, lockedInv); err != nil {
			return err
		}
		payout = *p
		return nil
	})
	if err != nil {
		return nil, err
	}

	payoutType := "Interest payout"
	if payout.IsPrincipalReturn {
		payoutType = "Principal return"
	}
	if s.cashRecorder != nil {
		movementID, err := s.cashRecorder.RecordInvestmentPayoutCashOut(ctx, inv.ID, inv.InvestmentNumber, payout.Amount, payout.CashAmount, payout.UpiAmount, payout.BankTransferAmount, payout.ChequeAmount, inv.BranchID, *payout.PaidAt, payoutType, inv.CustomerID)
		if err != nil {
			log.Printf("cash-out movement (%s) failed for investment %d: %v", payoutType, inv.ID, err)
		} else {
			payout.CashMovementID = &movementID
			_ = s.repo.UpdatePayout(ctx, nil, &payout)
		}
	}
	if s.comms != nil {
		if err := s.comms.NotifyInterestPayout(ctx, inv.CustomerID, inv.InvestmentNumber, payout.Amount); err != nil {
			log.Printf("notify interest payout failed for investment %d: %v", inv.ID, err)
		}
	}
	return &payout, nil
}

// SweepMaturities flags every Active investment whose MaturityDate has
// passed as Matured and best-effort notifies the investor — called by the
// background job (app.StartBackgroundJobs), mirrors the loan due/overdue
// sweep. It never auto-closes or auto-renews: that always requires an
// explicit staff decision via MatureInvestment.
func (s *Service) SweepMaturities(ctx context.Context) error {
	due, err := s.repo.FindDueForMaturitySweep(ctx, time.Now())
	if err != nil {
		return err
	}
	for i := range due {
		inv := &due[i]
		inv.Status = StatusMatured
		if err := s.repo.Update(ctx, nil, inv); err != nil {
			log.Printf("failed to flag investment %d matured: %v", inv.ID, err)
			continue
		}
		if s.comms != nil {
			if err := s.comms.NotifyInvestmentMatured(ctx, inv.CustomerID, inv.InvestmentNumber); err != nil {
				log.Printf("notify investment matured failed for investment %d: %v", inv.ID, err)
			}
		}
	}
	return nil
}

// MaturityAction values for MatureInvestment's decision.
const (
	MaturityActionClose = "Close"
	MaturityActionRenew = "Renew"
)

// RenewInput mirrors the "Renew Investment" form — a new plan/principal for
// the rolled-over investment (may differ from the maturing one).
type RenewInput struct {
	PlanID              uint
	PrincipalAmount     float64
	CreatedByEmployeeID uint
}

// MatureInvestment applies an admin's explicit decision on a Matured
// investment: Close appends a final principal-return payout row (left
// Pending for staff to disburse via MarkPayoutPaid, same as every other
// payout) and marks the investment Closed; Renew creates a brand-new
// Investment (via CreateInvestment) linked back via
// RenewedFromInvestmentID/RenewedToInvestmentID and marks the old one
// Renewed — mirrors personalloan.Service.RenewLoan's linked-list pattern.
//
// EngineLive investments are refused here (ErrLiveEngineMaturityNotSupported)
// — this whole flow is written entirely in terms of the Schedule engine's
// InvestmentPayout rows and was out of scope for the Add Cash/Withdraw
// feature; use Withdraw to draw down the outstanding balance instead until
// a Live-engine maturity flow is designed.
func (s *Service) MatureInvestment(ctx context.Context, investmentID uint, branchID *uint, action string, renewIn *RenewInput) (*Investment, error) {
	inv, err := s.Get(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	if inv.Engine == EngineLive {
		return nil, ErrLiveEngineMaturityNotSupported
	}
	if inv.Status != StatusMatured {
		return nil, ErrInvestmentNotMatured
	}

	switch action {
	case MaturityActionClose:
		err = s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			locked, err := s.repo.LockByID(ctx, tx, investmentID, branchID)
			if err != nil {
				return err
			}
			nextSeq := 1
			existing, err := s.repo.FindPayouts(ctx, investmentID, 1000, 0)
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				nextSeq = existing[len(existing)-1].SequenceNo + 1
			}
			final := &InvestmentPayout{
				InvestmentID:      locked.ID,
				SequenceNo:        nextSeq,
				DueDate:           time.Now(),
				Amount:            locked.PrincipalAmount,
				IsPrincipalReturn: true,
				Status:            PayoutStatusPending,
			}
			if err := s.repo.AppendPayout(ctx, tx, final); err != nil {
				return err
			}
			now := time.Now()
			locked.Status = StatusClosed
			locked.ClosedAt = &now
			if err := s.repo.Update(ctx, tx, locked); err != nil {
				return err
			}
			inv = locked
			return nil
		})
		if err != nil {
			return nil, err
		}
		return inv, nil

	case MaturityActionRenew:
		if renewIn == nil {
			return nil, ErrInvalidMaturityAction
		}
		newInv, err := s.CreateInvestment(ctx, CreateInput{
			BranchID:            inv.BranchID,
			CustomerID:          inv.CustomerID,
			PlanID:              renewIn.PlanID,
			PrincipalAmount:     renewIn.PrincipalAmount,
			CreatedByEmployeeID: renewIn.CreatedByEmployeeID,
		})
		if err != nil {
			return nil, err
		}
		err = s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			locked, err := s.repo.LockByID(ctx, tx, investmentID, branchID)
			if err != nil {
				return err
			}
			now := time.Now()
			locked.Status = StatusRenewed
			locked.ClosedAt = &now
			locked.RenewedToInvestmentID = &newInv.ID
			if err := s.repo.Update(ctx, tx, locked); err != nil {
				return err
			}

			newLocked, err := s.repo.LockByID(ctx, tx, newInv.ID, branchID)
			if err != nil {
				return err
			}
			newLocked.RenewedFromInvestmentID = &locked.ID
			if err := s.repo.Update(ctx, tx, newLocked); err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		return s.Get(ctx, newInv.ID, branchID)

	default:
		return nil, ErrInvalidMaturityAction
	}
}

// listPendingPayoutsForCalendar exposes Repository.FindPendingPayoutsForCalendar
// for the reminder module — mirrors
// personalloan.Service.ListPendingInstallmentsForCalendar's thin passthrough.
func (s *Service) ListPendingPayoutsForCalendar(ctx context.Context, branchID *uint) ([]CalendarPayout, error) {
	return s.repo.FindPendingPayoutsForCalendar(ctx, branchID)
}

// --- Live engine: Add Cash / Withdraw ---

// AddCashInput mirrors the "Add Cash" form.
type AddCashInput struct {
	Amount               float64
	OccurredOn           time.Time // zero => time.Now()
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	Reference            string
	RecordedByEmployeeID uint
}

// AddCash deposits additional principal into a Live-engine investment:
// settles any interest accrued so far against the OLD OutstandingPrincipal
// (see accrual.go's settleAndSave), THEN increases OutstandingPrincipal/
// PrincipalAmount by Amount, writes an append-only InvestmentTransaction
// row, and best-effort records the cash-in — mirrors
// loan.Service.TopUpLoan's transactional shape and CreateInvestment's own
// best-effort cash recording.
func (s *Service) AddCash(ctx context.Context, investmentID uint, branchID *uint, in AddCashInput) (*Investment, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	amount := platform.RoundMoney(in.Amount)
	if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, amount); err != nil {
		return nil, err
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}

	var invID, branchOfInv uint
	var invNumber string
	var txRow InvestmentTransaction
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := s.repo.LockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvestmentNotFound
			}
			return err
		}
		if inv.Engine != EngineLive {
			return ErrNotLiveEngine
		}
		if inv.Status != StatusActive {
			return ErrInvestmentNotActive
		}
		if err := platform.ValidateOccurredOn(occurredOn, inv.LastAccrualDate, time.Now()); err != nil {
			return err
		}

		// 1. Settle first, against the pre-deposit OutstandingPrincipal.
		if err := s.settleAndSave(ctx, tx, inv, occurredOn); err != nil {
			return err
		}
		principalBefore := inv.OutstandingPrincipal
		interestBefore := clampMoney(inv.AccruedInterest - inv.InterestWithdrawn)

		// 2. Then mutate.
		inv.OutstandingPrincipal = platform.RoundMoney(inv.OutstandingPrincipal + amount)
		inv.PrincipalAmount = platform.RoundMoney(inv.PrincipalAmount + amount)
		if err := s.repo.Update(ctx, tx, inv); err != nil {
			return err
		}

		txRow = InvestmentTransaction{
			InvestmentID:       inv.ID,
			Type:               TxTypeDeposit,
			Amount:             amount,
			PrincipalAmount:    amount,
			CashAmount:         in.CashAmount,
			UpiAmount:          in.UpiAmount,
			BankTransferAmount: in.BankTransferAmount,
			ChequeAmount:       in.ChequeAmount,
			PrincipalBefore:    principalBefore,
			PrincipalAfter:     inv.OutstandingPrincipal,
			InterestBefore:     interestBefore,
			InterestAfter:      clampMoney(inv.AccruedInterest - inv.InterestWithdrawn),
			OccurredOn:         occurredOn,
			Reference:          in.Reference,
		}
		if in.RecordedByEmployeeID != 0 {
			txRow.RecordedByEmployeeID = &in.RecordedByEmployeeID
		}
		if err := s.repo.CreateTransaction(ctx, tx, &txRow); err != nil {
			return err
		}
		invID, branchOfInv, invNumber = inv.ID, inv.BranchID, inv.InvestmentNumber
		return nil
	})
	if err != nil {
		return nil, err
	}

	if s.cashRecorder != nil {
		if movementID, err := s.cashRecorder.RecordInvestmentDepositCashIn(ctx, invID, invNumber, amount, branchOfInv, occurredOn); err != nil {
			log.Printf("cash-in movement (investment add-cash) failed for investment %d: %v", invID, err)
		} else {
			txRow.CashMovementID = &movementID
			_ = s.repo.UpdateTransaction(ctx, nil, &txRow)
		}
	}
	return s.Get(ctx, invID, branchID)
}

// WithdrawInput mirrors the "Withdraw" form. InterestAmount/PrincipalAmount
// are the withdrawal's explicit Interest/Principal/Both split — see
// InvestmentTransaction's doc comment for why two amounts rather than one
// amount plus a source enum.
type WithdrawInput struct {
	InterestAmount       float64
	PrincipalAmount      float64
	OccurredOn           time.Time // zero => time.Now()
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	Reference            string
	RecordedByEmployeeID uint
}

// Withdraw draws down a Live-engine investment's Outstanding Principal
// and/or Outstanding Interest: settles interest first (same "settle before
// mutate" order as AddCash), validates the requested split against the
// freshly-settled balances, applies it, writes the ledger row, and
// best-effort records the cash-out.
func (s *Service) Withdraw(ctx context.Context, investmentID uint, branchID *uint, in WithdrawInput) (*Investment, error) {
	if in.InterestAmount < 0 || in.PrincipalAmount < 0 {
		return nil, ErrInvalidAmount
	}
	total := platform.RoundMoney(in.InterestAmount + in.PrincipalAmount)
	if total <= 0 {
		return nil, ErrInvalidAmount
	}
	if err := platform.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, total); err != nil {
		return nil, err
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}

	var invID, branchOfInv, custID uint
	var invNumber string
	var txRow InvestmentTransaction
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := s.repo.LockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvestmentNotFound
			}
			return err
		}
		if inv.Engine != EngineLive {
			return ErrNotLiveEngine
		}
		if inv.Status != StatusActive {
			return ErrInvestmentNotActive
		}
		if err := platform.ValidateOccurredOn(occurredOn, inv.LastAccrualDate, time.Now()); err != nil {
			return err
		}

		if err := s.settleAndSave(ctx, tx, inv, occurredOn); err != nil {
			return err
		}
		principalBefore := inv.OutstandingPrincipal
		interestBefore := clampMoney(inv.AccruedInterest - inv.InterestWithdrawn)

		principalAmt := platform.RoundMoney(in.PrincipalAmount)
		interestAmt := platform.RoundMoney(in.InterestAmount)
		if principalAmt > principalBefore+epsilon {
			return ErrInsufficientPrincipal
		}
		if interestAmt > interestBefore+epsilon {
			return ErrInsufficientInterest
		}

		inv.OutstandingPrincipal = roundClamp(platform.RoundMoney(inv.OutstandingPrincipal - principalAmt))
		inv.PrincipalAmount = roundClamp(platform.RoundMoney(inv.PrincipalAmount - principalAmt))
		inv.InterestWithdrawn = platform.RoundMoney(inv.InterestWithdrawn + interestAmt)
		if err := s.repo.Update(ctx, tx, inv); err != nil {
			return err
		}

		txRow = InvestmentTransaction{
			InvestmentID:       inv.ID,
			Type:               TxTypeWithdrawal,
			Amount:             total,
			PrincipalAmount:    principalAmt,
			InterestAmount:     interestAmt,
			CashAmount:         in.CashAmount,
			UpiAmount:          in.UpiAmount,
			BankTransferAmount: in.BankTransferAmount,
			ChequeAmount:       in.ChequeAmount,
			PrincipalBefore:    principalBefore,
			PrincipalAfter:     inv.OutstandingPrincipal,
			InterestBefore:     interestBefore,
			InterestAfter:      clampMoney(inv.AccruedInterest - inv.InterestWithdrawn),
			OccurredOn:         occurredOn,
			Reference:          in.Reference,
		}
		if in.RecordedByEmployeeID != 0 {
			txRow.RecordedByEmployeeID = &in.RecordedByEmployeeID
		}
		if err := s.repo.CreateTransaction(ctx, tx, &txRow); err != nil {
			return err
		}
		invID, branchOfInv, invNumber, custID = inv.ID, inv.BranchID, inv.InvestmentNumber, inv.CustomerID
		return nil
	})
	if err != nil {
		return nil, err
	}

	if s.cashRecorder != nil {
		payoutType := "Interest & Principal withdrawal"
		switch {
		case txRow.PrincipalAmount == 0:
			payoutType = "Interest withdrawal"
		case txRow.InterestAmount == 0:
			payoutType = "Principal withdrawal"
		}
		movementID, err := s.cashRecorder.RecordInvestmentPayoutCashOut(ctx, invID, invNumber, total, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, branchOfInv, occurredOn, payoutType, custID)
		if err != nil {
			log.Printf("cash-out movement (investment withdrawal) failed for investment %d: %v", invID, err)
		} else {
			txRow.CashMovementID = &movementID
			_ = s.repo.UpdateTransaction(ctx, nil, &txRow)
		}
	}
	return s.Get(ctx, invID, branchID)
}

// GetTransactions returns one page of a Live-engine investment's ledger
// (deposits + withdrawals), newest first — mirrors GetSchedule's shape.
// Refuses (ErrNotLiveEngine) for a Schedule-engine investment, which has no
// such ledger — its history lives in the payout schedule instead.
func (s *Service) GetTransactions(ctx context.Context, investmentID uint, branchID *uint, limit, offset int) ([]InvestmentTransaction, bool, error) {
	inv, err := s.Get(ctx, investmentID, branchID)
	if err != nil {
		return nil, false, err
	}
	if inv.Engine != EngineLive {
		return nil, false, ErrNotLiveEngine
	}
	if limit <= 0 {
		limit = 20
	}
	recs, err := s.repo.FindTransactions(ctx, investmentID, limit, offset)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, nil
}

// roundClamp guards against floating-point drift leaving a payout amount
// negative by a fraction of a paisa.
func roundClamp(f float64) float64 {
	if math.Abs(f) < epsilon {
		return 0
	}
	return f
}

// clampMoney floors a computed balance at zero, treating anything within
// epsilon of zero as exactly zero — same rationale as loan.clampMoney: a
// fully-drawn-down OutstandingInterest routinely lands a whisker above zero
// (float rate arithmetic) rather than exactly on it.
func clampMoney(v float64) float64 {
	if v < epsilon {
		return 0
	}
	return v
}

// ErrCustomerNotFound is the refusal for a customer id that does not resolve
// inside the caller's own business.
var ErrCustomerNotFound = httpx.NewNotFound("customer not found")

// EnsureCustomerExists resolves a customer id under the CALLER's tenant, and
// is the ownership check behind GET /customers/:id/investments.
//
// The lookup itself is the check: it runs tenant-scoped, so another
// business's customer is simply not found — and 404 is the right refusal
// because a 403 would confirm the customer exists and belongs to someone
// else.
//
// Without this the endpoint answered 200 with an empty list for ANY customer
// id, including another business's. No data crossed (the investments query is
// tenant-scoped too), but the endpoint disagreed with its four siblings under
// /customers/:id/*, which all refuse. internal/loan's ListLoansForCustomer
// carries the same comment after the isolation harness caught the identical
// bug there; this one stayed hidden because its route was missing from the
// harness's manifest entirely.
func (s *Service) EnsureCustomerExists(ctx context.Context, customerID uint) error {
	if _, err := s.customerRepo.FindByID(ctx, customerID); err != nil {
		return ErrCustomerNotFound
	}
	return nil
}

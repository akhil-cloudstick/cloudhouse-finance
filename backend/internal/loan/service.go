package loan

import (
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
)

// PacketCreator auto-generates a loan's tracking packet right after
// creation ("Packet Generated" immediately follows "Loan Created" per the
// compliance doc's stage list). Implemented by packet.Service, injected as
// a narrow interface so internal/loan doesn't import internal/packet
// directly (packet already depends on loan for its joined display fields,
// so the dependency must stay one-directional).
type PacketCreator interface {
	CreatePacketForLoan(loanID uint, lockerID *uint) error
}

// PacketMover records the matching packet movement when a loan's gold is
// pledged to / returned from a bank via RecordBankPledge/ReleaseBankPledge.
// Implemented by packet.Service, injected the same way as PacketCreator.
type PacketMover interface {
	RecordBankPledgeMovement(loanID uint, remarks string) error
	RecordBankReleaseMovement(loanID uint, remarks string) error
	// RecordGoldReleaseMovement moves a loan's packet through to Released —
	// called by CompleteRelease once every release gate has passed.
	RecordGoldReleaseMovement(loanID uint, remarks string) error
}

// CashRecorder reflects a loan's real cash flow into Cash-in-Hand & Expenses
// (frontend/components/Cash.tsx): pledging gold with a bank brings cash in
// (releasing it removes that cash-in again), disbursing a loan's principal
// to the customer is cash out, and every repayment is cash in. Implemented
// by cash.MovementService, injected the same way as PacketCreator/
// PacketMover so internal/loan doesn't import internal/cash directly.
type CashRecorder interface {
	RecordBankPledgeCashIn(loanID uint, bankName string, amount float64, occurredOn time.Time) (movementID uint, err error)
	DeleteCashMovement(movementID uint) error
	RecordLoanDisbursementCashOut(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	RecordLoanPaymentCashIn(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time, paymentType string) (movementID uint, err error)
}

var (
	ErrNotFound                     = errors.New("loan not found")
	ErrOrnamentNotFound             = errors.New("ornament not found")
	ErrBranchInvalid                = errors.New("branch does not exist")
	ErrCustomerInvalid              = errors.New("customer does not exist")
	ErrCustomerNotVerified          = errors.New("customer must be KYC verified before a loan can be created")
	ErrSchemeInvalid                = errors.New("scheme does not exist")
	ErrNoOrnaments                  = errors.New("at least one ornament is required")
	ErrNoGoldRate                   = errors.New("no gold rate has been published yet")
	ErrGoldRateNotSetToday          = errors.New("today's gold rate has not been set yet — please publish it before creating a loan")
	ErrInvalidPurity                = errors.New("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
	ErrInvalidWeight                = errors.New("gross weight must be greater than zero")
	ErrPrincipalTooHigh             = errors.New("principal amount cannot exceed the eligible loan amount")
	ErrInvalidPrincipal             = errors.New("principal amount must be greater than zero")
	ErrInvalidDueDate               = errors.New("due date must be after the opened date")
	ErrWrongStage                   = errors.New("approval action does not match the loan's current approval stage")
	ErrAlreadyDecided               = errors.New("loan approval has already reached a terminal state")
	ErrInvalidAction                = errors.New("action must be Approved or Rejected")
	ErrInvalidAmount                = errors.New("amount must be greater than zero")
	ErrRequestNotFound              = errors.New("loan request not found")
	ErrInvalidRequestType           = errors.New("type must be Extension or Release")
	ErrInvalidMonths                = errors.New("requested extension months must be greater than zero")
	ErrRequestAlreadyDecided        = errors.New("loan request has already been decided")
	ErrInvalidPaymentType           = errors.New("type must be Interest, Principal, Partial, Full Settlement, Adjustment, or Waiver")
	ErrNotExtensionRequest          = errors.New("this request is not an Extension request")
	ErrNotReleaseRequest            = errors.New("this request is not a Release request")
	ErrLoanTerminalState            = errors.New("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	ErrChecklistIncomplete          = errors.New("the release verification checklist must be fully complete before approval")
	ErrReleaseNotApproved           = errors.New("this loan has no approved release request")
	ErrOutstandingBalanceRemains    = errors.New("the final settlement has not been fully paid yet — record the remaining payment before releasing the gold")
	ErrBankPledgeStillActive        = errors.New("gold is still pledged to a bank — release the bank pledge before releasing it to the customer")
	ErrExceedsApprovalLimit         = errors.New("principal exceeds the Loan Operator's approval limit — escalate to Branch Manager or Management")
	ErrAwaitingOperatorVerification = errors.New("the Loan Operator must verify this loan before Branch Manager or Management can approve it")
	ErrAuctionNotFound              = errors.New("this loan has no auction case yet — mark it auction-eligible first")
	ErrLoanNotDefaulted             = errors.New("loan must be Defaulted (overdue by more than 90 days) before it can be marked auction-eligible")
	ErrAuctionAlreadyStarted        = errors.New("this loan already has an auction case in progress")
	ErrAuctionWrongStage            = errors.New("action does not match the auction case's current stage")
)

// Service implements loan business rules: ornament valuation, eligible-
// amount calculation, the fixed 3-step approval chain, and the lightweight
// payment/bank-pledge audit trail.
type Service struct {
	repo                *Repository
	ornamentRepo        *OrnamentRepository
	approvalRepo        *ApprovalRepository
	paymentRepo         *PaymentRepository
	pledgeRepo          *BankPledgeRepository
	requestRepo         *LoanRequestRepository
	requestApprovalRepo *RequestApprovalRepository
	auctionRepo         *AuctionRepository
	approvalLimitRepo   *ApprovalLimitRepository

	branchRepo   *branch.Repository
	customerRepo *customer.Repository
	schemeRepo   *scheme.Repository
	goldRateRepo *goldrate.Repository

	packetCreator PacketCreator
	packetMover   PacketMover
	cashRecorder  CashRecorder
	whatsapp      platform.SMSSender // reused interface — Send(phone, message) matches SMSSender exactly
}

func NewService(
	repo *Repository,
	ornamentRepo *OrnamentRepository,
	approvalRepo *ApprovalRepository,
	paymentRepo *PaymentRepository,
	pledgeRepo *BankPledgeRepository,
	requestRepo *LoanRequestRepository,
	requestApprovalRepo *RequestApprovalRepository,
	auctionRepo *AuctionRepository,
	approvalLimitRepo *ApprovalLimitRepository,
	branchRepo *branch.Repository,
	customerRepo *customer.Repository,
	schemeRepo *scheme.Repository,
	goldRateRepo *goldrate.Repository,
	packetCreator PacketCreator,
	packetMover PacketMover,
	cashRecorder CashRecorder,
	whatsapp platform.SMSSender,
) *Service {
	return &Service{
		repo:                repo,
		ornamentRepo:        ornamentRepo,
		approvalRepo:        approvalRepo,
		paymentRepo:         paymentRepo,
		pledgeRepo:          pledgeRepo,
		requestRepo:         requestRepo,
		requestApprovalRepo: requestApprovalRepo,
		auctionRepo:         auctionRepo,
		approvalLimitRepo:   approvalLimitRepo,
		branchRepo:          branchRepo,
		customerRepo:        customerRepo,
		schemeRepo:          schemeRepo,
		packetCreator:       packetCreator,
		packetMover:         packetMover,
		cashRecorder:        cashRecorder,
		goldRateRepo:        goldRateRepo,
		whatsapp:            whatsapp,
	}
}

// notifyCustomer sends a WhatsApp message to a customer about a loan event
// (submission, sanction, etc.) and only logs on failure — a notification
// bounce must never fail the loan operation it's attached to, the same
// enrichment-not-hard-dependency rule Create already applies to packet
// auto-creation.
func (s *Service) notifyCustomer(phone, message string) {
	if s.whatsapp == nil {
		return
	}
	if err := s.whatsapp.Send(phone, message); err != nil {
		log.Printf("whatsapp notification failed (phone %s): %v", phone, err)
	}
}

// OrnamentInput mirrors the fields captured for one pledged item at
// loan-creation time.
type OrnamentInput struct {
	Name            string
	Purity          string
	GrossWeight     float64
	DeductionWeight float64
	Quantity        int
	Remarks         string
}

// CreateInput mirrors the fields the operator supplies when opening a loan.
type CreateInput struct {
	BranchID        uint
	CustomerID      uint
	SchemeID        uint
	OpenedDate      time.Time
	DueDate         time.Time
	PrincipalAmount float64
	Ornaments       []OrnamentInput
	// LockerID optionally checks the loan's auto-created packet straight
	// into a locker at creation time, instead of requiring a separate
	// manual "check in to locker" step afterward.
	LockerID *uint
}

// rateForPurity lives in purity.go (parses "22K"/"91.6%" and resolves the
// per-gram rate off the day's K24 benchmark).

// valueOrnament fills in NetWeight/GoldValue on an ornament:
//
//	NetWeight = GrossWeight - DeductionWeight
//	GoldValue = NetWeight × applicable Gold Rate (matched to declared purity)
func valueOrnament(o *Ornament, gr *goldrate.GoldRate) error {
	if o.GrossWeight <= 0 {
		return ErrInvalidWeight
	}
	rate, err := rateForPurity(gr, o.Purity)
	if err != nil {
		return err
	}
	o.NetWeight = o.GrossWeight - o.DeductionWeight
	if o.NetWeight < 0 {
		o.NetWeight = 0
	}
	o.GoldValue = o.NetWeight * rate
	return nil
}

// recalculateTotals sums a loan's ornaments into its denormalized totals
// and recomputes EligibleLoanAmount = TotalGoldValue × Scheme.LTVPercent/100.
func recalculateTotals(l *Loan, ornaments []Ornament, sch *scheme.Scheme) {
	var totalNet, totalValue float64
	for _, o := range ornaments {
		totalNet += o.NetWeight
		totalValue += o.GoldValue
	}
	l.TotalNetWeight = totalNet
	l.TotalGoldValue = totalValue
	l.EligibleLoanAmount = totalValue * (sch.LTVPercent / 100)
}

func (s *Service) Create(in CreateInput) (*Loan, error) {
	if len(in.Ornaments) == 0 {
		return nil, ErrNoOrnaments
	}
	if in.PrincipalAmount <= 0 {
		return nil, ErrInvalidPrincipal
	}
	if !in.DueDate.After(in.OpenedDate) {
		return nil, ErrInvalidDueDate
	}

	branchOK, err := s.branchRepo.Exists(in.BranchID)
	if err != nil {
		return nil, err
	}
	if !branchOK {
		return nil, ErrBranchInvalid
	}

	cust, err := s.customerRepo.FindByID(in.CustomerID)
	if err != nil {
		return nil, ErrCustomerInvalid
	}
	if cust.KYCStatus != "Verified" {
		return nil, ErrCustomerNotVerified
	}

	sch, err := s.schemeRepo.FindByID(in.SchemeID)
	if err != nil {
		return nil, ErrSchemeInvalid
	}

	rate, err := s.goldRateRepo.FindLatest()
	if err != nil {
		return nil, ErrNoGoldRate
	}
	now := time.Now()
	if rate.Date.Year() != now.Year() || rate.Date.YearDay() != now.YearDay() {
		return nil, ErrGoldRateNotSetToday
	}

	ornaments := make([]Ornament, 0, len(in.Ornaments))
	for _, oi := range in.Ornaments {
		o := Ornament{
			Name:            oi.Name,
			Purity:          oi.Purity,
			GrossWeight:     oi.GrossWeight,
			DeductionWeight: oi.DeductionWeight,
			Quantity:        oi.Quantity,
			Remarks:         oi.Remarks,
		}
		if o.Quantity <= 0 {
			o.Quantity = 1
		}
		if err := valueOrnament(&o, rate); err != nil {
			return nil, err
		}
		ornaments = append(ornaments, o)
	}

	rec := &Loan{
		BranchID:         in.BranchID,
		CustomerID:       in.CustomerID,
		SchemeID:         in.SchemeID,
		OpenedDate:       in.OpenedDate,
		DueDate:          in.DueDate,
		Status:           StatusPendingApproval,
		ApprovalStage:    SanctionStageLoanOperator,
		BankPledgeStatus: BankPledgeStatusNotPledged,
		// Interest accrues from the day the loan is opened, not from
		// whenever it happens to first be viewed/paid against.
		LastAccrualDate: in.OpenedDate,
	}
	recalculateTotals(rec, ornaments, sch)

	if in.PrincipalAmount > rec.EligibleLoanAmount {
		return nil, ErrPrincipalTooHigh
	}
	rec.PrincipalAmount = in.PrincipalAmount
	rec.OutstandingAmount = in.PrincipalAmount

	count, err := s.repo.CountAll()
	if err != nil {
		return nil, err
	}
	rec.LoanNumber = fmt.Sprintf("LN-%05d", count+1)

	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	for i := range ornaments {
		ornaments[i].LoanID = rec.ID
		if err := s.ornamentRepo.Create(&ornaments[i]); err != nil {
			return nil, err
		}
	}

	created, err := s.repo.FindByID(rec.ID)
	if err != nil {
		return nil, err
	}

	// Packet auto-creation is an enrichment, not a hard dependency of the
	// core lending flow — log and continue on failure rather than failing
	// loan creation.
	if s.packetCreator != nil {
		if err := s.packetCreator.CreatePacketForLoan(created.ID, in.LockerID); err != nil {
			log.Printf("packet auto-creation failed for loan %d: %v", created.ID, err)
		}
	}

	s.enrich(created)

	s.notifyCustomer(created.Customer.Phone, fmt.Sprintf(
		"Dear %s, your gold loan application %s for ₹%.2f has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance",
		created.Customer.Name, created.LoanNumber, created.PrincipalAmount,
	))

	return created, nil
}

func (s *Service) List(f LoanFilter) ([]Loan, error) {
	loans, err := s.repo.FindAll(f)
	if err != nil {
		return nil, err
	}
	// Listing is read-only and can return many rows, so accrual here is
	// projected into the in-memory copy for display only (never saved) —
	// Get/RecordPayment are what actually advance AccruedInterest/
	// AccruedPenalInterest in the DB.
	now := time.Now()
	for i := range loans {
		l := &loans[i]
		interestDelta, penalDelta := projectAccrual(l, &l.Scheme, now)
		l.AccruedInterest += interestDelta
		l.AccruedPenalInterest += penalDelta
		s.enrich(l)
	}
	return loans, nil
}

func (s *Service) Get(id uint, branchID *uint) (*Loan, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return s.accrueAndEnrich(rec)
}

// checkLoanBranch guards a loan-scoped action against branch scoping — nil
// branchID (Administrator) always passes; otherwise the loan must belong to
// that branch, or ErrNotFound is returned (same as a direct not-found, so a
// non-admin can't probe for another branch's loans/requests/auction cases).
func (s *Service) checkLoanBranch(loanID uint, branchID *uint) error {
	if branchID == nil {
		return nil
	}
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return ErrNotFound
	}
	if l.BranchID != *branchID {
		return ErrNotFound
	}
	return nil
}

// GetByLoanNumber looks up a loan by its exact LoanNumber in one atomic
// query (see Repository.FindByLoanNumber) — backs GET
// /loans/by-number/:loanNumber, used by LoanDetail.tsx instead of the
// previous list-then-find-then-get approach.
func (s *Service) GetByLoanNumber(loanNumber string) (*Loan, error) {
	rec, err := s.repo.FindByLoanNumber(loanNumber)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.accrueAndEnrich(rec)
}

// accrueAndEnrich persists any newly-accrued interest (this is always a
// single-loan detail view, where staff act on the numbers — record a
// payment, decide a settlement — so "what's owed" should be nailed down,
// not just projected like List's read-only accrual) and populates the
// computed OutstandingInterest/TotalOutstandingBalance/etc. fields.
func (s *Service) accrueAndEnrich(rec *Loan) (*Loan, error) {
	if s.accrueAndSave(rec) {
		saved, err := s.repo.FindByID(rec.ID)
		if err != nil {
			return nil, err
		}
		rec = saved
	}
	s.enrich(rec)
	return rec, nil
}

// AddOrnamentInput mirrors OrnamentInput for adding an ornament to an
// existing loan after creation.
type AddOrnamentInput = OrnamentInput

// AddOrnament pledges an additional ornament onto an existing loan and
// recalculates the loan's totals/eligible amount.
func (s *Service) AddOrnament(loanID uint, in AddOrnamentInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}

	rate, err := s.goldRateRepo.FindLatest()
	if err != nil {
		return nil, ErrNoGoldRate
	}

	o := Ornament{
		LoanID:          loanID,
		Name:            in.Name,
		Purity:          in.Purity,
		GrossWeight:     in.GrossWeight,
		DeductionWeight: in.DeductionWeight,
		Quantity:        in.Quantity,
		Remarks:         in.Remarks,
	}
	if o.Quantity <= 0 {
		o.Quantity = 1
	}
	if err := valueOrnament(&o, rate); err != nil {
		return nil, err
	}
	if err := s.ornamentRepo.Create(&o); err != nil {
		return nil, err
	}

	return s.recalculateAndSave(l)
}

// UpdateOrnamentInput mirrors OrnamentInput for editing a pledged ornament.
type UpdateOrnamentInput = OrnamentInput

// UpdateOrnament edits a pledged ornament's declared values and
// recalculates its owning loan's totals/eligible amount.
func (s *Service) UpdateOrnament(ornamentID uint, in UpdateOrnamentInput) (*Loan, error) {
	o, err := s.ornamentRepo.FindByID(ornamentID)
	if err != nil {
		return nil, ErrOrnamentNotFound
	}

	rate, err := s.goldRateRepo.FindLatest()
	if err != nil {
		return nil, ErrNoGoldRate
	}

	o.Name = in.Name
	o.Purity = in.Purity
	o.GrossWeight = in.GrossWeight
	o.DeductionWeight = in.DeductionWeight
	o.Quantity = in.Quantity
	o.Remarks = in.Remarks
	if o.Quantity <= 0 {
		o.Quantity = 1
	}
	if err := valueOrnament(o, rate); err != nil {
		return nil, err
	}
	if err := s.ornamentRepo.Update(o); err != nil {
		return nil, err
	}

	l, err := s.repo.FindByID(o.LoanID)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.recalculateAndSave(l)
}

func (s *Service) recalculateAndSave(l *Loan) (*Loan, error) {
	sch, err := s.schemeRepo.FindByID(l.SchemeID)
	if err != nil {
		return nil, ErrSchemeInvalid
	}
	ornaments, err := s.ornamentRepo.FindByLoanID(l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments, sch)
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	return s.Get(l.ID, nil)
}

// PurityTestInput mirrors the fields staff enter when manually re-testing
// a pledged ornament.
type PurityTestInput struct {
	TestedPurity          string
	TestedGrossWeight     float64
	TestedDeductionWeight float64
	TestingRemarks        string
	TestedBy              string
	TestedAt              time.Time
}

func (s *Service) RecordPurityTest(ornamentID uint, in PurityTestInput) (*Ornament, error) {
	o, err := s.ornamentRepo.FindByID(ornamentID)
	if err != nil {
		return nil, ErrOrnamentNotFound
	}
	if _, _, err := ParsePurity(in.TestedPurity); err != nil {
		return nil, ErrInvalidPurity
	}
	if in.TestedGrossWeight <= 0 {
		return nil, ErrInvalidWeight
	}

	t := o.PurityTest
	if t == nil {
		t = &OrnamentPurityTest{OrnamentID: ornamentID}
	}
	t.TestedPurity = in.TestedPurity
	t.TestedGrossWeight = in.TestedGrossWeight
	t.TestedDeductionWeight = in.TestedDeductionWeight
	t.TestedNetWeight = in.TestedGrossWeight - in.TestedDeductionWeight
	if t.TestedNetWeight < 0 {
		t.TestedNetWeight = 0
	}
	t.TestingRemarks = in.TestingRemarks
	t.TestedBy = in.TestedBy
	t.TestedAt = in.TestedAt

	if err := s.ornamentRepo.SavePurityTest(t); err != nil {
		return nil, err
	}
	return s.ornamentRepo.FindByID(ornamentID)
}

// AddOrnamentImage attaches one more photo (already uploaded via
// internal/upload) to an ornament.
func (s *Service) AddOrnamentImage(ornamentID uint, imageURL string) (*Ornament, error) {
	if _, err := s.ornamentRepo.FindByID(ornamentID); err != nil {
		return nil, ErrOrnamentNotFound
	}
	img := &OrnamentImage{OrnamentID: ornamentID, ImageURL: imageURL}
	if err := s.ornamentRepo.AddImage(img); err != nil {
		return nil, err
	}
	return s.ornamentRepo.FindByID(ornamentID)
}

// sanctionChain is the loan sanction chain's fixed stage order — index i's
// role must act (or "Administrator", see Approve) to advance from
// SanctionStage[i] to SanctionStage[i+1] (or to ApprovalStageApproved, for
// the last stage).
var sanctionChain = []struct{ Stage, Role string }{
	{SanctionStageLoanOperator, "Loan Operator"},
	{SanctionStageBranchManager, "Branch Manager"},
	{SanctionStageAuthorizedManagement, "Management"},
	{SanctionStageFinalSanction, "Management"},
}

// sanctionLimits is an advisory-only reference table for Branch Manager/
// Management — "a Branch Manager would typically only sign off on loans up
// to ₹X," etc. It is NEVER used to block an approve/reject decision for
// these two roles, only to compute Loan.ApprovalWarning so the UI can show
// a "consider escalating" note. Hardcoded (no admin screen to edit these
// yet — an explicit scope decision, not an oversight; only the Loan
// Operator limit below was asked to become editable/hard-enforced).
//
// Loan Operator's limit used to live here too, advisory-only; it's now a
// real, admin-editable, HARD-enforced cap — see ApprovalLimit/
// loanOperatorLimit/Approve's stage-role check below.
var sanctionLimits = map[string]float64{
	"Branch Manager": 200000,
	"Management":     0, // 0 == no advisory ceiling — Management/Final Sanction can clear any amount
}

func sanctionWarning(l *Loan) string {
	for _, step := range sanctionChain {
		if step.Stage != l.ApprovalStage {
			continue
		}
		limit := sanctionLimits[step.Role]
		if limit > 0 && l.PrincipalAmount > limit {
			return fmt.Sprintf("Principal ₹%.0f exceeds the typical ₹%.0f limit for %s — consider escalating.", l.PrincipalAmount, limit, step.Role)
		}
		return ""
	}
	return ""
}

// loanOperatorLimit reads the current hard-enforced Loan Operator approval
// limit from the DB, falling back to DefaultLoanOperatorApprovalLimit if
// no row exists yet (shouldn't happen past first migration — see
// SeedLoanOperatorLimit — but a missing row should never silently disable
// enforcement).
func (s *Service) loanOperatorLimit() float64 {
	rec, err := s.approvalLimitRepo.FindByRole("Loan Operator")
	if err != nil {
		return DefaultLoanOperatorApprovalLimit
	}
	return rec.MaxAmount
}

// GetLoanOperatorLimit exposes the current limit for GET /loans/approval-limits/loan-operator.
func (s *Service) GetLoanOperatorLimit() float64 {
	return s.loanOperatorLimit()
}

// SetLoanOperatorLimit updates the Loan Operator's hard-enforced approval
// limit (PUT /loans/approval-limits/loan-operator). amount must be > 0 —
// a Loan Operator having literally no approval authority isn't a state
// this endpoint models; remove the role from the sanction chain instead if
// that's ever needed.
func (s *Service) SetLoanOperatorLimit(amount float64) (float64, error) {
	if amount <= 0 {
		return 0, ErrInvalidAmount
	}
	rec, err := s.approvalLimitRepo.Upsert("Loan Operator", amount)
	if err != nil {
		return 0, err
	}
	return rec.MaxAmount, nil
}

// ApprovalInput mirrors the body of POST /loans/:id/approve.
type ApprovalInput struct {
	Stage           string // one of SanctionStage* — must match the loan's current ApprovalStage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRole       string // employee.ValidRoles value; "Administrator" may act at any pending stage
	Remarks         string
}

// operatorVerified reports whether the Loan Operator has already recorded
// an ApprovalActionVerified entry for loanID's LoanOperator stage — the
// hand-off marker Branch Manager/Management must wait for before they may
// clear that stage themselves on an over-limit loan (see Approve).
func (s *Service) operatorVerified(loanID uint) (bool, error) {
	approvals, err := s.approvalRepo.FindByLoanID(loanID)
	if err != nil {
		return false, err
	}
	for _, a := range approvals {
		if a.Stage == SanctionStageLoanOperator && a.Action == ApprovalActionVerified {
			return true, nil
		}
	}
	return false, nil
}

// Approve advances (or terminates) a loan's 4-step sanction chain:
//
//	LoanOperator -> BranchManager -> AuthorizedManagement -> FinalSanction -> Approved (Status -> Active)
//
// A Rejected action at any stage closes the loan (Status -> Closed) since
// the doc's status list has no distinct "Rejected" bucket. Normally
// in.ActorRole must match the current stage's required role (see
// sanctionChain); an "Administrator" actor is exempt and may act at
// whichever stage is currently pending. sanctionLimits (Branch Manager/
// Management) only feeds Loan.ApprovalWarning, purely advisory — but the
// Loan Operator stage is a hard cap (see loanOperatorLimit): a Loan
// Operator cannot themselves approve a loan whose principal exceeds their
// limit (ErrExceedsApprovalLimit on an Approved action; Rejected is always
// allowed regardless of amount).
//
// Over that limit, the hand-off is two steps rather than Branch Manager/
// Management silently clearing the Loan Operator's stage on their behalf:
//  1. The Loan Operator records an ApprovalActionVerified decision — they
//     still reviewed/verified the loan, just can't grant final approval on
//     it themselves. Doesn't advance the sanction chain.
//  2. Only once that exists (operatorVerified) may Branch Manager/
//     Management clear the LoanOperator stage with a normal Approved (or
//     Rejected) action, advancing the chain as usual. Attempting to
//     approve before step 1 returns ErrAwaitingOperatorVerification.
func (s *Service) Approve(loanID uint, in ApprovalInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected && in.Action != ApprovalActionVerified {
		return nil, ErrInvalidAction
	}
	if l.ApprovalStage == ApprovalStageApproved || l.ApprovalStage == ApprovalStageRejected {
		return nil, ErrAlreadyDecided
	}
	if in.Stage != l.ApprovalStage {
		return nil, ErrWrongStage
	}

	var requiredRole string
	for _, step := range sanctionChain {
		if step.Stage == l.ApprovalStage {
			requiredRole = step.Role
			break
		}
	}
	overLimit := requiredRole == "Loan Operator" && l.PrincipalAmount > s.loanOperatorLimit()

	if in.Action == ApprovalActionVerified {
		// Verified only exists for the over-limit LoanOperator hand-off, and
		// only the Loan Operator (or Administrator, standing in) may record it.
		if requiredRole != "Loan Operator" || !overLimit {
			return nil, ErrWrongStage
		}
		if in.ActorRole != "Loan Operator" && in.ActorRole != "Administrator" {
			return nil, ErrWrongStage
		}
	} else if in.ActorRole != "Administrator" {
		if requiredRole == "Loan Operator" && in.Action == ApprovalStageApproved && overLimit {
			// Over the hard cap: only a higher role may clear this stage,
			// and only after the operator has verified it (see above).
			if in.ActorRole != "Branch Manager" && in.ActorRole != "Management" {
				return nil, ErrExceedsApprovalLimit
			}
			verified, err := s.operatorVerified(loanID)
			if err != nil {
				return nil, err
			}
			if !verified {
				return nil, ErrAwaitingOperatorVerification
			}
		} else if requiredRole != "" && in.ActorRole != requiredRole {
			return nil, ErrWrongStage
		}
	}

	audit := &LoanApproval{
		LoanID:          loanID,
		Stage:           in.Stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		ActorRole:       in.ActorRole,
		Remarks:         in.Remarks,
	}
	if err := s.approvalRepo.Create(audit); err != nil {
		return nil, err
	}

	if in.Action == ApprovalActionVerified {
		// Leaves the sanction chain exactly where it was — this only adds
		// the audit-trail entry the stepper/history reads to know the
		// operator's review happened, ahead of Branch Manager/Management's
		// actual Approved/Rejected decision at this same stage.
		return s.Get(l.ID, nil)
	}

	disbursing := false
	if in.Action == ApprovalStageRejected {
		l.ApprovalStage = ApprovalStageRejected
		l.Status = StatusClosed
	} else {
		switch l.ApprovalStage {
		case SanctionStageLoanOperator:
			l.ApprovalStage = SanctionStageBranchManager
		case SanctionStageBranchManager:
			l.ApprovalStage = SanctionStageAuthorizedManagement
		case SanctionStageAuthorizedManagement:
			l.ApprovalStage = SanctionStageFinalSanction
		case SanctionStageFinalSanction:
			l.ApprovalStage = ApprovalStageApproved
			l.Status = StatusActive
			disbursing = true
		}
	}

	if err := s.repo.Update(l); err != nil {
		return nil, err
	}

	// The principal only actually leaves the till once the loan clears its
	// final approval stage — logging it earlier (e.g. at Create) would show
	// cash going out for a loan that might still be rejected.
	if disbursing && s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordLoanDisbursementCashOut(l.ID, l.LoanNumber, l.PrincipalAmount, l.BranchID, time.Now()); err != nil {
			log.Printf("cash-out movement (disbursement) failed for loan %d: %v", l.ID, err)
		}
	}

	if disbursing {
		s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
			"Dear %s, your gold loan %s has been sanctioned and ₹%.2f has been disbursed. Due date: %s. — Ambika Gold Finance",
			l.Customer.Name, l.LoanNumber, l.PrincipalAmount, l.DueDate.Format("02-Jan-2006"),
		))
	}

	return s.Get(l.ID, nil)
}

// GetInterestCollected sums the interest + penal-interest portions of
// payments recorded within [from, to] — backs Dashboard.tsx's "Interest
// Collected" KPI (GET /loans/interest-collected), replacing the old
// mock-only db.ledger figure that never had a real backend equivalent.
func (s *Service) GetInterestCollected(from, to time.Time) (float64, error) {
	return s.paymentRepo.SumInterestCollected(from, to)
}

// ListApprovals returns the loan's full sanction-chain decision history, in
// the order decisions were made.
func (s *Service) ListApprovals(loanID uint) ([]LoanApproval, error) {
	if _, err := s.repo.FindByID(loanID); err != nil {
		return nil, ErrNotFound
	}
	return s.approvalRepo.FindByLoanID(loanID)
}

// PaymentInput mirrors the body of POST /loans/:id/payments. ProcessingFee
// is an optional additional charge collected alongside Amount — see
// LoanPayment.ProcessingFee's doc comment.
type PaymentInput struct {
	Amount               float64
	Type                 string
	ProcessingFee        float64
	PaidOn               time.Time
	ReceivedByEmployeeID uint
	Method               string
	Reference            string
	Description          string
}

// ErrExceedsOutstanding is returned when a payment's Type restricts which
// bucket(s) it can pay down and Amount is more than currently owed in
// those buckets (e.g. an "Interest" payment bigger than outstanding
// interest+penal interest, or a "Full Settlement" smaller than the total
// owed).
var ErrExceedsOutstanding = errors.New("amount does not match what is owed for this payment type")

// allocatePayment splits amount across the processing-fee/penal-interest/
// interest/principal buckets according to paymentType's waterfall rule,
// against l's *current* outstanding figures (call accrueAndSave first, and
// add any newly-charged ProcessingFee to l.OutstandingProcessingFee,
// before calling this, so the buckets are up to date). Processing fee has
// first priority — the very next rupee paid in clears it before penal
// interest/interest/principal — matching Loan Operator/branch expectation
// that outstanding fees get cleared before anything else. It does not
// mutate l — the caller applies the returned deltas and decides
// cash-recording.
func allocatePayment(l *Loan, paymentType string, amount float64) (fee, penal, interest, principal float64, err error) {
	const epsilon = 0.01 // guards against float rounding rejecting an exact payoff
	feeOutstanding := l.OutstandingProcessingFee
	penalOutstanding := l.AccruedPenalInterest - l.PenalInterestPaid
	interestOutstanding := l.AccruedInterest - l.InterestPaid
	principalOutstanding := l.OutstandingAmount

	switch paymentType {
	case PaymentTypePrincipal:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		if remaining > principalOutstanding+epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}
		principal = remaining

	case PaymentTypeInterest:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		if remaining > epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}

	case PaymentTypePartial:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)
		remaining -= principal
		if remaining > epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}

	case PaymentTypeFullSettlement:
		total := feeOutstanding + penalOutstanding + interestOutstanding + principalOutstanding
		if amount+epsilon < total {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}
		fee, penal, interest, principal = feeOutstanding, penalOutstanding, interestOutstanding, principalOutstanding

	case PaymentTypeAdjustment:
		// A manual correction to the principal ledger (e.g. fixing a data
		// entry error) — never overshoots into a negative outstanding
		// balance, and never touches fee/interest/penal interest.
		principal = math.Min(amount, principalOutstanding)

	case PaymentTypeWaiver:
		// Forgives owed interest/penal interest without any cash changing
		// hands — same penal-then-interest order as a real payment would
		// use, but never reaches into fee/principal (a fee is a real charge,
		// not something a waiver forgives).
		remaining := amount
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		if remaining > epsilon {
			return 0, 0, 0, 0, ErrExceedsOutstanding
		}

	default:
		return 0, 0, 0, 0, ErrInvalidPaymentType
	}
	return fee, penal, interest, principal, nil
}

// RecordPayment logs one ledger entry against a loan: it first brings
// AccruedInterest/AccruedPenalInterest up to date (so the allocation below
// is against real, current figures), charges any newly-added
// ProcessingFee onto OutstandingProcessingFee, then allocates the payment
// across processing fee → penal interest → interest → principal per its
// Type (see allocatePayment), updates the paid-so-far totals, and
// auto-closes the loan once nothing is left owing in any bucket
// (including the fee). Only cash-bearing types (see isCashPaymentType) are
// reflected in Cash-in-Hand — Adjustment/Waiver correct the ledger without
// any cash actually moving.
func (s *Service) RecordPayment(loanID uint, in PaymentInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.ProcessingFee < 0 {
		return nil, ErrInvalidAmount
	}

	s.accrueAndSave(l)

	// Charging the fee before allocating means this same payment's Amount
	// can immediately go toward clearing it — fee has first priority in
	// allocatePayment's waterfall.
	if in.ProcessingFee > 0 {
		l.OutstandingProcessingFee += in.ProcessingFee
	}

	fee, penal, interest, principal, err := allocatePayment(l, in.Type, in.Amount)
	if err != nil {
		return nil, err
	}

	l.OutstandingProcessingFee -= fee
	if l.OutstandingProcessingFee < 0 {
		l.OutstandingProcessingFee = 0
	}
	l.PenalInterestPaid += penal
	l.InterestPaid += interest
	l.OutstandingAmount -= principal
	if l.OutstandingAmount < 0 {
		l.OutstandingAmount = 0
	}

	outstandingInterest := l.AccruedInterest - l.InterestPaid
	outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
	if l.OutstandingAmount <= 0 && outstandingInterest <= 0.01 && outstandingPenal <= 0.01 &&
		l.OutstandingProcessingFee <= 0.01 &&
		(l.Status == StatusActive || l.Status == StatusDueSoon || l.Status == StatusOverdue) {
		l.Status = StatusClosed
	}
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}

	runningBalance := l.OutstandingAmount + math.Max(0, outstandingInterest) + math.Max(0, outstandingPenal) + l.OutstandingProcessingFee
	p := &LoanPayment{
		LoanID:               loanID,
		Amount:               in.Amount,
		Type:                 in.Type,
		ProcessingFee:        in.ProcessingFee,
		ProcessingFeeApplied: fee,
		PaidOn:               in.PaidOn,
		ReceivedByEmployeeID: in.ReceivedByEmployeeID,
		Description:          in.Description,
		Method:               in.Method,
		Reference:            in.Reference,
		PenalInterestApplied: penal,
		InterestApplied:      interest,
		PrincipalApplied:     principal,
		RunningBalance:       runningBalance,
	}
	if err := s.paymentRepo.Create(p); err != nil {
		return nil, err
	}

	// Amount is the actual cash handed over — the fee (if any) is paid out
	// of this same amount, not collected on top of it (see allocatePayment's
	// fee-first priority), so the cash-in movement is just Amount.
	if isCashPaymentType(in.Type) && s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordLoanPaymentCashIn(l.ID, l.LoanNumber, in.Amount, l.BranchID, in.PaidOn, in.Type); err != nil {
			log.Printf("cash-in movement (payment) failed for loan %d: %v", l.ID, err)
		}
	}

	return s.Get(l.ID, nil)
}

// BankPledgeInput mirrors the body of POST /loans/:id/bank-pledge. BankID/
// BankName both come from the caller — the frontend's bank search dropdown
// already resolves both for the bank the staff member picked, so the
// service just stores them as given rather than re-looking the bank up.
type BankPledgeInput struct {
	BankID            *uint
	BankName          string
	PledgedAmount     float64
	PledgeDate        time.Time
	BankInterestRate  float64
	ReferenceNumber   string
	BankPledgeDueDate *time.Time
}

func (s *Service) RecordBankPledge(loanID uint, branchID *uint, in BankPledgeInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if in.PledgedAmount <= 0 {
		return nil, ErrInvalidAmount
	}

	var grossWeight float64
	for _, o := range l.Ornaments {
		grossWeight += o.GrossWeight
	}

	p := &BankPledgeRecord{
		LoanID:             loanID,
		BankID:             in.BankID,
		BankName:           in.BankName,
		PledgedAmount:      in.PledgedAmount,
		PledgeDate:         in.PledgeDate,
		BankInterestRate:   in.BankInterestRate,
		ReferenceNumber:    in.ReferenceNumber,
		BankPledgeDueDate:  in.BankPledgeDueDate,
		PledgedGrossWeight: grossWeight,
		PledgedNetWeight:   l.TotalNetWeight,
	}
	if err := s.pledgeRepo.Create(p); err != nil {
		return nil, err
	}

	l.BankPledgeStatus = BankPledgeStatusPledged
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}

	if s.packetMover != nil {
		if err := s.packetMover.RecordBankPledgeMovement(loanID, "Bank pledge: "+in.BankName); err != nil {
			log.Printf("packet movement (bank pledge) failed for loan %d: %v", loanID, err)
		}
	}

	if s.cashRecorder != nil {
		movementID, err := s.cashRecorder.RecordBankPledgeCashIn(loanID, in.BankName, in.PledgedAmount, in.PledgeDate)
		if err != nil {
			log.Printf("cash-in movement (bank pledge) failed for loan %d: %v", loanID, err)
		} else {
			p.CashMovementID = &movementID
			if err := s.pledgeRepo.Update(p); err != nil {
				log.Printf("saving cash movement link (bank pledge) failed for loan %d: %v", loanID, err)
			}
		}
	}

	return s.Get(l.ID, nil)
}

// --- Auction workflow (7-stage) --------------------------------------------
//
// Overdue -> Defaulted (both derived read-time flags, see
// accrual.go's enrichStatusFlags — no AuctionRecord exists yet at that
// point) -> AuctionEligible -> NoticeIssued -> AuctionScheduled ->
// Auctioned -> Settled. Each function below advances exactly one stage and
// validates the AuctionRecord/Loan is in the correct prior stage first.

func (s *Service) getAuctionRecord(loanID uint) (*AuctionRecord, error) {
	rec, err := s.auctionRepo.FindByLoanID(loanID)
	if err != nil {
		return nil, ErrAuctionNotFound
	}
	return rec, nil
}

// GetAuctionRecord returns a loan's auction case record (including its
// notice history), or ErrAuctionNotFound if the loan was never marked
// auction-eligible.
func (s *Service) GetAuctionRecord(loanID uint, branchID *uint) (*AuctionRecord, error) {
	if err := s.checkLoanBranch(loanID, branchID); err != nil {
		return nil, err
	}
	return s.getAuctionRecord(loanID)
}

// MarkAuctionEligible starts a loan's auction case: requires the loan to
// currently be Defaulted (IsDefaulted, i.e. overdue by more than 90 days —
// see accrual.go), creates its AuctionRecord at AuctionEligible, and sets
// Loan.Status accordingly. A loan can only have one AuctionRecord at a
// time (LoanID is uniquely indexed).
func (s *Service) MarkAuctionEligible(loanID uint, branchID *uint) (*AuctionRecord, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	s.enrich(l)
	if !l.IsDefaulted {
		return nil, ErrLoanNotDefaulted
	}
	if _, err := s.auctionRepo.FindByLoanID(loanID); err == nil {
		return nil, ErrAuctionAlreadyStarted
	}

	rec := &AuctionRecord{
		LoanID:                loanID,
		Stage:                 AuctionStageEligible,
		AuctionEligibleDate:   time.Now(),
		FinalSettlementStatus: AuctionSettlementPending,
	}
	if err := s.auctionRepo.Create(rec); err != nil {
		return nil, err
	}

	l.Status = StatusAuctionEligible
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	return s.getAuctionRecord(loanID)
}

// auctionNoticeChannels are the three channels every auction notice is sent
// through — the operator no longer picks a method (Registered Post/SMS/In
// Person/Email); all three fire together and each is logged as its own
// AuctionNotice row, mirroring the "customer notice history" the compliance
// spec expects. WhatsApp is the only one with a live gateway today (see
// notifyCustomer) — SMS and Postal have no provider wired up yet, so they're
// logged the same way a not-yet-configured WhatsApp send would be.
var auctionNoticeChannels = []string{"SMS", "WhatsApp", "Registered Post"}

// IssueAuctionNotice logs a customer notice against the loan's auction case
// on every channel in auctionNoticeChannels and advances it to NoticeIssued
// (idempotent re-issue: additional notices can be logged after the stage has
// already advanced past Eligible). Actually delivers the WhatsApp message
// (best-effort — a delivery failure never blocks logging the notice, same
// rule as notifyCustomer elsewhere); SMS/Postal have no gateway yet and are
// recorded as logged only.
func (s *Service) IssueAuctionNotice(loanID uint, branchID *uint, remarks string) (*AuctionRecord, error) {
	if err := s.checkLoanBranch(loanID, branchID); err != nil {
		return nil, err
	}
	rec, err := s.getAuctionRecord(loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage == AuctionStageAuctioned || rec.Stage == AuctionStageSettled {
		return nil, ErrAuctionWrongStage
	}

	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}

	for _, method := range auctionNoticeChannels {
		if err := s.auctionRepo.CreateNotice(&AuctionNotice{
			AuctionRecordID: rec.ID,
			IssuedAt:        time.Now(),
			Method:          method,
			Remarks:         remarks,
		}); err != nil {
			return nil, err
		}
		if method == "WhatsApp" {
			s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
				"Dear %s, your gold loan %s is overdue and has been marked for auction. Please contact the branch immediately to settle dues and avoid losing your pledged items.",
				l.Customer.Name, l.LoanNumber,
			))
		}
	}

	if rec.Stage == AuctionStageEligible {
		rec.Stage = AuctionStageNotice
		if err := s.auctionRepo.Update(rec); err != nil {
			return nil, err
		}
	}
	return s.getAuctionRecord(loanID)
}

// ScheduleAuction records the actual auction date/reference and advances
// the case to AuctionScheduled. Requires at least one notice to have been
// issued first.
func (s *Service) ScheduleAuction(loanID uint, branchID *uint, date time.Time, referenceNumber string) (*AuctionRecord, error) {
	if err := s.checkLoanBranch(loanID, branchID); err != nil {
		return nil, err
	}
	rec, err := s.getAuctionRecord(loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != AuctionStageNotice {
		return nil, ErrAuctionWrongStage
	}
	rec.AuctionDate = &date
	rec.AuctionReferenceNumber = referenceNumber
	rec.Stage = AuctionStageScheduled
	if err := s.auctionRepo.Update(rec); err != nil {
		return nil, err
	}
	return s.getAuctionRecord(loanID)
}

// RecordAuctionSale records what the gold actually sold for and what it
// cost to run the auction, computes SurplusShortfall against the loan's
// current TotalOutstandingBalance, advances the case to Auctioned, and
// closes the loan out (Status -> Auctioned, OutstandingAmount -> 0 — same
// end effect as the old one-shot RecordAuction()).
func (s *Service) RecordAuctionSale(loanID uint, branchID *uint, saleAmount, expenses float64) (*AuctionRecord, error) {
	if saleAmount <= 0 {
		return nil, ErrInvalidAmount
	}
	rec, err := s.getAuctionRecord(loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != AuctionStageScheduled {
		return nil, ErrAuctionWrongStage
	}
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	s.enrich(l)

	rec.SaleAmount = saleAmount
	rec.AuctionExpenses = expenses
	rec.SurplusShortfall = saleAmount - expenses - l.TotalOutstandingBalance
	rec.Stage = AuctionStageAuctioned
	if err := s.auctionRepo.Update(rec); err != nil {
		return nil, err
	}

	auctionDate := time.Now()
	l.AuctionDate = &auctionDate
	l.AuctionAmount = &saleAmount
	l.Status = StatusAuctioned
	l.OutstandingAmount = 0
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	return s.getAuctionRecord(loanID)
}

// SettleAuction records how the sale's surplus/shortfall was resolved and
// advances the case to its terminal Settled stage.
func (s *Service) SettleAuction(loanID uint, branchID *uint, settlementStatus string) (*AuctionRecord, error) {
	switch settlementStatus {
	case AuctionSettlementSettledToCustomer, AuctionSettlementSettledToLoanCo:
	default:
		return nil, ErrInvalidAction
	}
	if err := s.checkLoanBranch(loanID, branchID); err != nil {
		return nil, err
	}
	rec, err := s.getAuctionRecord(loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != AuctionStageAuctioned {
		return nil, ErrAuctionWrongStage
	}
	rec.FinalSettlementStatus = settlementStatus
	rec.Stage = AuctionStageSettled
	if err := s.auctionRepo.Update(rec); err != nil {
		return nil, err
	}
	return s.getAuctionRecord(loanID)
}

// --- Extension & release requests ------------------------------------------

// ExtensionRequestInput mirrors the body of POST /loans/:id/extension-request.
type ExtensionRequestInput struct {
	Months      int
	Detail      string
	RequestedBy string // "Customer" | "Staff"; defaults to "Staff" if empty
}

// CreateExtensionRequest logs a customer's ask to push a loan's due date
// out by Months. It does not itself change the loan — staff must Approve it
// via DecideRequest for the new due date to take effect.
func (s *Service) CreateExtensionRequest(loanID uint, in ExtensionRequestInput) (*LoanRequest, error) {
	if _, err := s.repo.FindByID(loanID); err != nil {
		return nil, ErrNotFound
	}
	if in.Months <= 0 {
		return nil, ErrInvalidMonths
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = RequestedByStaff
	}
	months := in.Months
	req := &LoanRequest{
		LoanID:                   loanID,
		Type:                     RequestTypeExtension,
		Status:                   RequestStatusPending,
		RequestedBy:              requestedBy,
		Detail:                   in.Detail,
		RequestedExtensionMonths: &months,
		RequestedAt:              time.Now(),
	}
	if err := s.requestRepo.Create(req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(req.ID)
}

// ReleaseRequestInput mirrors the body of POST /loans/:id/release-request.
type ReleaseRequestInput struct {
	Detail      string
	RequestedBy string // "Customer" | "Staff"; defaults to "Staff" if empty
}

// CreateReleaseRequest logs a customer's ask to close a loan and take the
// pledged gold back. It does not itself close the loan — staff must Approve
// it via DecideRequest, which moves the loan to Closure Requested; actual
// closure still happens through the existing full-settlement payment flow.
func (s *Service) CreateReleaseRequest(loanID uint, in ReleaseRequestInput) (*LoanRequest, error) {
	if _, err := s.repo.FindByID(loanID); err != nil {
		return nil, ErrNotFound
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = RequestedByStaff
	}
	req := &LoanRequest{
		LoanID:      loanID,
		Type:        RequestTypeRelease,
		Status:      RequestStatusPending,
		RequestedBy: requestedBy,
		Detail:      in.Detail,
		RequestedAt: time.Now(),
	}
	if err := s.requestRepo.Create(req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(req.ID)
}

func (s *Service) ListRequests(f LoanRequestFilter) ([]LoanRequest, error) {
	return s.requestRepo.FindAll(f)
}

// DecideRequest approves or rejects a pending Extension request in one
// step — staff review the loan's outstanding principal/interest/penal
// interest (already live on the loan via enrich) and the requested
// extension period, then decide. Release requests go through
// ApproveReleaseRequest's multi-stage chain instead (ErrNotExtensionRequest
// here). Approving pushes the loan's DueDate out by the requested months
// and recalculates status; it's blocked if the loan has already reached a
// terminal state (nothing left to extend). Rejecting only records the
// decision — the loan is untouched either way.
func (s *Service) DecideRequest(requestID uint, branchID *uint, approve bool, decidedByEmployeeID uint, remarks string) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeExtension {
		return nil, ErrNotExtensionRequest
	}
	if req.Status != RequestStatusPending {
		return nil, ErrRequestAlreadyDecided
	}

	now := time.Now()
	req.DecidedAt = &now
	req.DecidedByEmployeeID = &decidedByEmployeeID
	req.Remarks = remarks

	if !approve {
		req.Status = RequestStatusRejected
		if err := s.requestRepo.Update(req); err != nil {
			return nil, err
		}
		return s.requestRepo.FindByID(req.ID)
	}

	l, err := s.repo.FindByID(req.LoanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if isLoanTerminal(l.Status) {
		return nil, ErrLoanTerminalState
	}

	months := 0
	if req.RequestedExtensionMonths != nil {
		months = *req.RequestedExtensionMonths
	}
	newDue := l.DueDate.AddDate(0, months, 0)
	l.DueDate = newDue
	req.NewDueDate = &newDue
	if _, err := s.recalculateAndSave(l); err != nil {
		return nil, err
	}

	req.Status = RequestStatusApproved
	if err := s.requestRepo.Update(req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(req.ID)
}

// isLoanTerminal reports whether a loan has already reached a state with
// nothing left to extend or release — Closed, Auctioned, or Defaulted.
// Everything else (Overdue, Due Soon, Closure Requested, ...) is left to
// staff judgment, per the extension business rules.
func isLoanTerminal(status string) bool {
	return status == StatusClosed || status == StatusAuctioned || status == StatusDefaulted
}

// ChecklistInput mirrors the body of PUT /loans/requests/:requestId/verify.
type ChecklistInput struct {
	PaymentVerified    *bool
	PacketVerified     *bool
	BankPledgeVerified *bool
	CustomerConfirmed  *bool
	VerificationNotes  *string
	Charges            *float64
}

// VerifyReleaseChecklist updates one or more of a pending Release request's
// verification-checklist items. Callable repeatedly as staff confirm each
// item in person (payment settled, packet location, bank pledge status,
// customer confirmation) — ApproveReleaseRequest refuses the first approval
// stage until all four are true.
func (s *Service) VerifyReleaseChecklist(requestID uint, branchID *uint, in ChecklistInput) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeRelease {
		return nil, ErrNotReleaseRequest
	}
	if req.Status != RequestStatusPending {
		return nil, ErrRequestAlreadyDecided
	}

	if in.PaymentVerified != nil {
		req.PaymentVerified = *in.PaymentVerified
	}
	if in.PacketVerified != nil {
		req.PacketVerified = *in.PacketVerified
	}
	if in.BankPledgeVerified != nil {
		req.BankPledgeVerified = *in.BankPledgeVerified
	}
	if in.CustomerConfirmed != nil {
		req.CustomerConfirmed = *in.CustomerConfirmed
	}
	if in.VerificationNotes != nil {
		req.VerificationNotes = *in.VerificationNotes
	}
	if in.Charges != nil {
		req.Charges = *in.Charges
	}
	if req.ApprovalStage == "" {
		req.ApprovalStage = ApprovalStagePendingManager
	}

	if err := s.requestRepo.Update(req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(req.ID)
}

// ReleaseApprovalInput mirrors the body of POST /loans/requests/:requestId/approve.
type ReleaseApprovalInput struct {
	Stage           string // "Manager" | "Management" — must match the request's current ApprovalStage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	Remarks         string
}

// ApproveReleaseRequest advances (or terminates) a Release request's fixed
// 2-step Manager→Management chain — the exact same pattern as Loan.Approve,
// reused per the business decision that release approvals go through the
// same workflow as loan sanctioning. The chain cannot even start until the
// verification checklist (VerifyReleaseChecklist) is fully complete. A
// Rejected action at either stage only rejects the request — the loan is
// untouched. The final Approved action (Management stage) snapshots
// SettlementAmount = Loan.TotalOutstandingBalance + Charges and moves the
// loan to StatusClosureRequested; CompleteRelease (below) does the actual
// hand-back once the settlement is fully paid.
func (s *Service) ApproveReleaseRequest(requestID uint, branchID *uint, in ReleaseApprovalInput) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeRelease {
		return nil, ErrNotReleaseRequest
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected {
		return nil, ErrInvalidAction
	}
	if req.ApprovalStage == ApprovalStageApproved || req.ApprovalStage == ApprovalStageRejected {
		return nil, ErrRequestAlreadyDecided
	}
	if !req.PaymentVerified || !req.PacketVerified || !req.BankPledgeVerified || !req.CustomerConfirmed {
		return nil, ErrChecklistIncomplete
	}

	stage := req.ApprovalStage
	if stage == "" {
		stage = ApprovalStagePendingManager
	}
	var expectedStage string
	switch stage {
	case ApprovalStagePendingManager:
		expectedStage = "Manager"
	case ApprovalStagePendingManagement:
		expectedStage = "Management"
	}
	if in.Stage != expectedStage {
		return nil, ErrWrongStage
	}

	audit := &RequestApproval{
		RequestID:       requestID,
		Stage:           in.Stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		Remarks:         in.Remarks,
	}
	if err := s.requestApprovalRepo.Create(audit); err != nil {
		return nil, err
	}

	if in.Action == ApprovalStageRejected {
		req.ApprovalStage = ApprovalStageRejected
		req.Status = RequestStatusRejected
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &in.ActorEmployeeID
		req.Remarks = in.Remarks
		if err := s.requestRepo.Update(req); err != nil {
			return nil, err
		}
		return s.requestRepo.FindByID(req.ID)
	}

	switch stage {
	case ApprovalStagePendingManager:
		req.ApprovalStage = ApprovalStagePendingManagement
	case ApprovalStagePendingManagement:
		req.ApprovalStage = ApprovalStageApproved

		l, err := s.Get(req.LoanID, nil)
		if err != nil {
			return nil, err
		}
		req.SettlementAmount = l.TotalOutstandingBalance + req.Charges
		l.Status = StatusClosureRequested
		if err := s.repo.Update(l); err != nil {
			return nil, err
		}

		req.Status = RequestStatusApproved
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &in.ActorEmployeeID
		req.Remarks = in.Remarks
	}

	if err := s.requestRepo.Update(req); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(req.ID)
}

// CompleteRelease is the actual "hand the gold back" step — separate from
// approving the release request. It requires: an Approved Release request
// for this loan; the settlement fully paid (TotalOutstandingBalance <= 0 —
// every repayment recorded via RecordPayment has already reduced this
// automatically); and the bank pledge already released, if there was one.
// Only then does it move the loan's packet to Released and close the loan.
func (s *Service) CompleteRelease(loanID uint, branchID *uint, employeeID uint) (*Loan, error) {
	if _, err := s.requestRepo.FindApprovedReleaseByLoanID(loanID); err != nil {
		return nil, ErrReleaseNotApproved
	}

	l, err := s.Get(loanID, branchID)
	if err != nil {
		return nil, err
	}
	if l.TotalOutstandingBalance > 0.01 {
		return nil, ErrOutstandingBalanceRemains
	}
	if l.BankPledgeStatus == BankPledgeStatusPledged {
		return nil, ErrBankPledgeStillActive
	}

	if s.packetMover != nil {
		if err := s.packetMover.RecordGoldReleaseMovement(loanID, "Gold released to customer"); err != nil {
			log.Printf("packet gold-release movement failed for loan %d: %v", loanID, err)
		}
	}

	l.Status = StatusClosed
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	return s.Get(l.ID, nil)
}

func (s *Service) ReleaseBankPledge(loanID, pledgeID uint, branchID *uint) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	p, err := s.pledgeRepo.FindByID(pledgeID)
	if err != nil || p.LoanID != loanID {
		return nil, ErrNotFound
	}

	now := time.Now()
	p.ReleaseDate = &now
	if err := s.pledgeRepo.Update(p); err != nil {
		return nil, err
	}

	l.BankPledgeStatus = BankPledgeStatusReleased
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}

	if s.packetMover != nil {
		if err := s.packetMover.RecordBankReleaseMovement(loanID, "Gold returned from bank: "+p.BankName); err != nil {
			log.Printf("packet bank-release movement failed for loan %d: %v", loanID, err)
		}
	}

	if s.cashRecorder != nil && p.CashMovementID != nil {
		if err := s.cashRecorder.DeleteCashMovement(*p.CashMovementID); err != nil {
			log.Printf("removing cash-in movement (bank release) failed for loan %d: %v", loanID, err)
		}
	}

	return s.Get(l.ID, nil)
}

// --- Customer 360 -----------------------------------------------------------

// Customer360 is a one-screen consolidated view of everything a customer
// has ever done — every loan (with its ornaments, payments, bank pledges),
// every auction case, and running totals across all of it. Lives here
// (not in internal/customer) because internal/loan already imports
// internal/customer for Loan.Customer — the reverse import would be a
// cycle — and Repository.FindAll already preloads Customer/Ornaments/
// Payments/Pledges on every loan, so no extra queries are needed beyond
// one auction lookup per loan. Mirrors the "merge multiple domains into
// one read-only aggregation" style of reminder.Service.GetCalendarEvents.
type Customer360 struct {
	Customer         customer.CustomerResponse `json:"customer"`
	Loans            []Loan                    `json:"loans"`
	AuctionHistory   []AuctionRecord           `json:"auctionHistory"`
	TotalDisbursed   float64                   `json:"totalDisbursed"`
	TotalOutstanding float64                   `json:"totalOutstanding"`
	TotalPaid        float64                   `json:"totalPaid"`
	ActiveLoanCount  int                       `json:"activeLoanCount"`
	ClosedLoanCount  int                       `json:"closedLoanCount"`
}

func (s *Service) GetCustomer360(customerID uint) (*Customer360, error) {
	cust, err := s.customerRepo.FindByID(customerID)
	if err != nil {
		return nil, ErrCustomerInvalid
	}
	loans, err := s.repo.FindAll(LoanFilter{CustomerID: customerID})
	if err != nil {
		return nil, err
	}

	out := &Customer360{Customer: cust.ToResponse()}
	for i := range loans {
		s.enrich(&loans[i])
		out.TotalDisbursed += loans[i].PrincipalAmount
		out.TotalOutstanding += loans[i].TotalOutstandingBalance
		out.TotalPaid += loans[i].TotalPaid
		switch loans[i].Status {
		case StatusClosed, StatusAuctioned:
			out.ClosedLoanCount++
		case StatusActive, StatusDueSoon, StatusOverdue, StatusClosureRequested:
			out.ActiveLoanCount++
		}
		if rec, err := s.auctionRepo.FindByLoanID(loans[i].ID); err == nil {
			out.AuctionHistory = append(out.AuctionHistory, *rec)
		}
	}
	out.Loans = loans
	return out, nil
}

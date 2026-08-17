package loan

import (
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/upload"
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
// AND is mirrored as an auto-approved expense entry (so it also shows up in
// the Expenses register/reports); releasing it books the same amount back
// out as a cash-out movement plus a mirrored release expense, without
// touching the original cash-in entry — both stay as permanent history.
// Disbursing a loan's principal to the customer is cash out, and every
// repayment is cash in. Implemented by cash.MovementService, injected the
// same way as PacketCreator/PacketMover so internal/loan doesn't import
// internal/cash directly.
type CashRecorder interface {
	RecordBankPledgeCashIn(loanID uint, bankName string, amount float64, occurredOn time.Time) (movementID uint, err error)
	RecordBankPledgeExpense(loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (expenseID uint, err error)
	RecordBankPledgeCashOut(loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (movementID uint, err error)
	RecordBankPledgeReleaseExpense(loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (expenseID uint, err error)
	RecordLoanDisbursementCashOut(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	RecordLoanPaymentCashIn(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time, paymentType string) (movementID uint, err error)

	// RecordAuctionSaleCashIn books the NET proceeds of an auction (sale price
	// less auction expenses) into Cash-in-Hand. Previously an auction recorded
	// no cash movement at all, so money the branch genuinely received never
	// appeared in the books.
	RecordAuctionSaleCashIn(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	// RecordAuctionSurplusCashOut books the refund of an auction surplus back
	// to the customer. Called only for the RefundedToCustomer disposition —
	// retaining the surplus as income needs no movement, because the full net
	// proceeds already came in via RecordAuctionSaleCashIn.
	RecordAuctionSurplusCashOut(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
}

var (
	ErrNotFound                  = errors.New("loan not found")
	ErrOrnamentNotFound          = errors.New("ornament not found")
	ErrBranchInvalid             = errors.New("branch does not exist")
	ErrCustomerInvalid           = errors.New("customer does not exist")
	ErrCustomerNotVerified       = errors.New("customer must be KYC verified before a loan can be created")
	ErrSchemeInvalid             = errors.New("scheme does not exist")
	ErrNoOrnaments               = errors.New("at least one ornament is required")
	ErrNoGoldRate                = errors.New("no gold rate has been published yet")
	ErrGoldRateNotSetToday       = errors.New("today's gold rate has not been set yet — please publish it before creating a loan")
	ErrInvalidPurity             = errors.New("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
	ErrInvalidWeight             = errors.New("gross weight must be greater than zero")
	ErrPrincipalTooHigh          = errors.New("principal amount cannot exceed the eligible loan amount")
	ErrInvalidPrincipal          = errors.New("principal amount must be greater than zero")
	ErrInvalidDueDate            = errors.New("due date must be after the opened date")
	ErrWrongStage                = errors.New("approval action does not match the loan's current approval stage")
	ErrAlreadyDecided            = errors.New("loan approval has already reached a terminal state")
	ErrInvalidAction             = errors.New("action must be Approved or Rejected")
	ErrInvalidAmount             = errors.New("amount must be greater than zero")
	ErrRequestNotFound           = errors.New("loan request not found")
	ErrInvalidRequestType        = errors.New("type must be Extension or Release")
	ErrInvalidMonths             = errors.New("requested extension months must be greater than zero")
	ErrRequestAlreadyDecided     = errors.New("loan request has already been decided")
	ErrInvalidPaymentType        = errors.New("type must be Interest, Principal, Partial, Full Settlement, Adjustment, or Waiver")
	ErrNotExtensionRequest       = errors.New("this request is not an Extension request")
	ErrNotReleaseRequest         = errors.New("this request is not a Release request")
	ErrLoanTerminalState         = errors.New("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	ErrChecklistIncomplete       = errors.New("the release verification checklist must be fully complete before approval")
	ErrReleaseNotApproved        = errors.New("this loan has no approved release request")
	ErrOutstandingBalanceRemains = errors.New("the final settlement has not been fully paid yet — record the remaining payment before releasing the gold")
	ErrBankPledgeStillActive     = errors.New("gold is still pledged to a bank — release the bank pledge before releasing it to the customer")
	ErrAuctionNotFound           = errors.New("this loan has no auction case yet — mark it auction-eligible first")
	ErrLoanNotDefaulted          = errors.New("loan must be Defaulted (overdue by more than 90 days) before it can be marked auction-eligible")
	ErrAuctionAlreadyStarted     = errors.New("this loan already has an auction case in progress")
	ErrAuctionWrongStage         = errors.New("action does not match the auction case's current stage")

	// ErrDraftNotFound covers both "no such draft" and "not yours" — a draft
	// belongs to the employee who saved it (see LoanDraft), and answering
	// "exists, but not yours" would leak that someone else has one.
	ErrDraftNotFound = errors.New("loan draft not found")

	ErrInvalidCashTreatment = errors.New("cashTreatment must be either \"CashIn\" or \"RecordOnly\"")
	ErrPledgeNotFound       = errors.New("bank pledge record not found")
	ErrPledgeNotActive      = errors.New("only an active bank pledge can be voided — this one is already released or voided")
	ErrVoidReasonRequired   = errors.New("a reason is required when voiding a bank pledge")

	// ErrAuctionDecisionPending blocks the auction pipeline while a repayment
	// decision is outstanding. This is the safety guarantee that stops gold
	// being sold out from under a customer whose payment is still under review.
	ErrAuctionDecisionPending = errors.New("a repayment decision is pending on this auction — it must be resolved before the auction can proceed")

	ErrAuctionDecisionNotFound       = errors.New("auction decision request not found")
	ErrAuctionDecisionAlreadyDecided = errors.New("this auction decision has already been made")
	ErrInvalidAuctionDecision        = errors.New("decision is not valid for this kind of auction request")
	ErrShortfallAuthorityRequired    = errors.New("only a Branch Manager, Management, or Administrator may decide a post-auction shortfall")
	ErrAuctionBalanceDueCannotSettle = errors.New("this auction left a balance owing — resolve the shortfall decision instead of settling")
	ErrNoSurplusToDispose            = errors.New("this auction left no surplus to dispose of")
	ErrSurplusAlreadyDisposed        = errors.New("this auction's surplus has already been disposed of")
	ErrInvalidSurplusDisposition     = errors.New("surplus disposition must be either \"RefundedToCustomer\" or \"RecordedAsIncome\"")
	ErrSettlementRemarksRequired     = errors.New("remarks are required when a customer's auction surplus is retained as income")
	ErrDecisionRemarksRequired       = errors.New("remarks are required for this decision")

	// ErrEsignNotConfigured/ErrNoIndemnityBondSignRequest are returned by the
	// indemnity-bond Aadhaar eSign flow (StartIndemnityBondSign/
	// CheckIndemnityBondSign) — same shape as customer.Service's
	// ErrDigilockerNotConfigured/ErrNoDigilockerRequest.
	ErrEsignNotConfigured           = errors.New("indemnity bond eSign is not configured")
	ErrNoIndemnityBondSignRequest   = errors.New("no indemnity bond eSign has been started for this loan")
	ErrIndemnityBondAlreadySigned   = errors.New("this loan's indemnity bond has already been signed")
	ErrUnsupportedIndemnityBondLang = errors.New("lang must be en, hi, or gu")
)

// Service implements loan business rules: ornament valuation, eligible-
// amount calculation, the fixed 3-step approval chain, and the lightweight
// payment/bank-pledge audit trail.
type Service struct {
	// db is used ONLY to wrap the auction flows that write several tables at
	// once (sale, decision resolution, and the auction hook inside
	// RecordPayment) in a transaction. Those are the paths where a failure
	// part-way could leave gold sold with no record of the proceeds, or a
	// payment recorded without the auction being frozen.
	//
	// The rest of this service keeps the codebase's existing non-transactional,
	// log-and-continue style — no transaction infrastructure existed here
	// before, and converting every write path was out of scope.
	db *gorm.DB

	repo                *Repository
	ornamentRepo        *OrnamentRepository
	approvalRepo        *ApprovalRepository
	paymentRepo         *PaymentRepository
	pledgeRepo          *BankPledgeRepository
	requestRepo         *LoanRequestRepository
	requestApprovalRepo *RequestApprovalRepository
	auctionRepo         *AuctionRepository
	approvalLimitRepo   *ApprovalLimitRepository

	// draftRepo is built from db inside NewService rather than being passed
	// in like the repositories above — drafts are internal scratch state
	// with no other consumer, and this constructor already takes 21
	// arguments.
	draftRepo *DraftRepository

	branchRepo   *branch.Repository
	customerRepo *customer.Repository
	schemeRepo   *scheme.Repository
	goldRateRepo *goldrate.Repository

	packetCreator PacketCreator
	packetMover   PacketMover
	cashRecorder  CashRecorder
	whatsapp      platform.SMSSender // reused interface — Send(phone, message) matches SMSSender exactly
	commlogRepo   *commlog.Repository

	// esign drives the indemnity bond's Aadhaar eSign flow (see
	// indemnitybond.go, StartIndemnityBondSign/CheckIndemnityBondSign). nil
	// when SETU_ESIGN_* isn't configured — every method using it checks
	// first and returns ErrEsignNotConfigured rather than a nil-pointer
	// panic, same posture as customer.Service's setu/digilocker fields.
	esign      *platform.EsignClient
	uploadsDir string
}

func NewService(
	db *gorm.DB,
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
	commlogRepo *commlog.Repository,
	esign *platform.EsignClient,
	uploadsDir string,
) *Service {
	return &Service{
		db:                  db,
		repo:                repo,
		ornamentRepo:        ornamentRepo,
		approvalRepo:        approvalRepo,
		paymentRepo:         paymentRepo,
		pledgeRepo:          pledgeRepo,
		requestRepo:         requestRepo,
		requestApprovalRepo: requestApprovalRepo,
		auctionRepo:         auctionRepo,
		approvalLimitRepo:   approvalLimitRepo,
		draftRepo:           NewDraftRepository(db),
		branchRepo:          branchRepo,
		customerRepo:        customerRepo,
		schemeRepo:          schemeRepo,
		packetCreator:       packetCreator,
		packetMover:         packetMover,
		cashRecorder:        cashRecorder,
		goldRateRepo:        goldRateRepo,
		whatsapp:            whatsapp,
		commlogRepo:         commlogRepo,
		esign:               esign,
		uploadsDir:          uploadsDir,
	}
}

// notifyCustomer sends a WhatsApp message to a customer about a loan event
// (submission, sanction, etc.) and logs the attempt (success or failure) to
// commlog for the Communication History report — a notification bounce must
// never fail the loan operation it's attached to, the same
// enrichment-not-hard-dependency rule Create already applies to packet
// auto-creation. triggerType/relatedEntityType/relatedEntityID classify the
// message for that report (see commlog.Trigger* constants).
func (s *Service) notifyCustomer(phone, message, triggerType, relatedEntityType string, relatedEntityID uint) {
	if s.whatsapp == nil {
		return
	}
	sendErr := s.whatsapp.Send(phone, message)
	if sendErr != nil {
		log.Printf("whatsapp notification failed (phone %s): %v", phone, sendErr)
	}
	if s.commlogRepo != nil {
		rec := &commlog.CommunicationLog{
			RecipientPhone:    phone,
			ChatID:            commlog.NormalizeChatID(phone),
			Channel:           commlog.ChannelWhatsApp,
			TriggerType:       triggerType,
			MessageBody:       message,
			RelatedEntityType: relatedEntityType,
			RelatedEntityID:   relatedEntityID,
			Status:            commlog.StatusSent,
		}
		if sendErr != nil {
			rec.Status = commlog.StatusFailed
			rec.ErrorMessage = sendErr.Error()
		}
		if err := s.commlogRepo.Create(rec); err != nil {
			log.Printf("communication log write failed (phone %s): %v", phone, err)
		}
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
	), commlog.TriggerLoanSubmission, "loan", created.ID)

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
		interestDelta, penalDelta, _ := projectAccrual(l, &l.Scheme, now)
		l.AccruedInterest = platform.RoundMoney(l.AccruedInterest + interestDelta)
		l.AccruedPenalInterest = platform.RoundMoney(l.AccruedPenalInterest + penalDelta)
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
	{SanctionStageFinalSanction, "Management"},
}

// normalizeSanctionStage maps the retired AuthorizedManagement stage onto
// FinalSanction so a loan left on it by the old 4-stage chain still has a
// role that can clear it (see SanctionStageAuthorizedManagement).
func normalizeSanctionStage(stage string) string {
	if stage == SanctionStageAuthorizedManagement {
		return SanctionStageFinalSanction
	}
	return stage
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
	stage := normalizeSanctionStage(l.ApprovalStage)
	for _, step := range sanctionChain {
		if step.Stage != stage {
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

// Approve advances (or terminates) a loan's 3-step sanction chain:
//
//	LoanOperator (verified) -> BranchManager (approved) -> FinalSanction (Management) -> Approved (Status -> Active)
//
// A Rejected action at any stage closes the loan (Status -> Closed) since
// the doc's status list has no distinct "Rejected" bucket. in.ActorRole
// must match the current stage's required role (see sanctionChain); an
// "Administrator" actor is exempt and may act at whichever stage is
// currently pending.
//
// The LoanOperator stage is a *verification*, not a sanction: the operator
// who made the loan confirms it and the chain moves on to the Branch
// Manager, who is the first actual approver. Both ApprovalActionVerified
// and Approved are accepted there and behave identically (the UI sends
// "Verified"; "Approved" stays accepted so older clients keep working).
// No amount check gates it — the Loan Operator approval limit and
// sanctionLimits are advisory only, feeding Loan.ApprovalWarning.
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
	// Compare against the normalized stage so a loan parked on the retired
	// AuthorizedManagement value can be cleared by a client sending either
	// that value or FinalSanction.
	stage := normalizeSanctionStage(l.ApprovalStage)
	if normalizeSanctionStage(in.Stage) != stage {
		return nil, ErrWrongStage
	}

	var requiredRole string
	for _, step := range sanctionChain {
		if step.Stage == stage {
			requiredRole = step.Role
			break
		}
	}

	// Verified belongs to the LoanOperator stage only.
	if in.Action == ApprovalActionVerified && requiredRole != "Loan Operator" {
		return nil, ErrWrongStage
	}
	if in.ActorRole != "Administrator" && requiredRole != "" && in.ActorRole != requiredRole {
		return nil, ErrWrongStage
	}

	audit := &LoanApproval{
		LoanID:          loanID,
		Stage:           stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		ActorRole:       in.ActorRole,
		Remarks:         in.Remarks,
	}
	if err := s.approvalRepo.Create(audit); err != nil {
		return nil, err
	}

	disbursing := false
	if in.Action == ApprovalStageRejected {
		l.ApprovalStage = ApprovalStageRejected
		l.Status = StatusClosed
	} else {
		switch stage {
		case SanctionStageLoanOperator:
			l.ApprovalStage = SanctionStageBranchManager
		case SanctionStageBranchManager:
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
		), commlog.TriggerLoanSanction, "loan", l.ID)
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

	case PaymentTypeAuctionSale:
		// Auction proceeds pay down exactly like a Partial payment (fee →
		// penal → interest → principal), but must never be rejected for
		// overshooting: gold can fetch more than the debt, and the excess is
		// the customer's surplus, handled by RecordAuctionSale rather than
		// being an error. So each bucket is simply capped and any remainder is
		// left for the surplus path.
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)

	case PaymentTypeAuctionWriteOff:
		// Forgiving a post-auction shortfall. Unlike Waiver this DOES reach
		// principal — once the gold is sold there is no collateral left, so
		// what management is writing off is the principal itself, not merely
		// accrued interest. Capped at what is owed so a write-off can never
		// push a balance negative.
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)

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
		l.OutstandingProcessingFee = platform.RoundMoney(l.OutstandingProcessingFee + in.ProcessingFee)
	}

	fee, penal, interest, principal, err := allocatePayment(l, in.Type, in.Amount)
	if err != nil {
		return nil, err
	}

	// Every balance is rounded as it is written, so stored figures stay exact
	// rupee amounts and the waterfall's float arithmetic cannot accumulate
	// drift across payments — see platform.RoundMoney.
	l.OutstandingProcessingFee = platform.RoundMoney(l.OutstandingProcessingFee - fee)
	if l.OutstandingProcessingFee < 0 {
		l.OutstandingProcessingFee = 0
	}
	l.PenalInterestPaid = platform.RoundMoney(l.PenalInterestPaid + penal)
	l.InterestPaid = platform.RoundMoney(l.InterestPaid + interest)
	l.OutstandingAmount = platform.RoundMoney(l.OutstandingAmount - principal)
	if l.OutstandingAmount < 0 {
		l.OutstandingAmount = 0
	}

	outstandingInterest := l.AccruedInterest - l.InterestPaid
	outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
	if l.OutstandingAmount <= 0 && outstandingInterest <= 0.01 && outstandingPenal <= 0.01 &&
		l.OutstandingProcessingFee <= 0.01 &&
		(l.Status == StatusActive || l.Status == StatusDueSoon || l.Status == StatusOverdue) {
		l.Status = StatusClosed
	} else {
		// Not fully settled, but this payment may have cleared the arrears —
		// which takes an expired-term loan off Overdue and back to Active.
		refreshServicingStatus(l, time.Now())
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

	// A customer paying while their gold sits in the auction pipeline must
	// change what happens to that gold — previously the payment landed and the
	// auction carried on regardless.
	s.resolveAuctionAfterPayment(l, p)

	return s.Get(l.ID, nil)
}

// resolveAuctionAfterPayment reacts to a payment on a loan whose gold is still
// in the auction pipeline:
//
//   - Loan now fully closed → the auction is cancelled automatically and
//     recorded as Settled by Repayment. The customer rescued their gold; no
//     human action should be needed to notice that.
//   - Loan still open → a PartialRepayment escalation is raised and the
//     auction FREEZES (see requireNoPendingDecision). A part-payment is not
//     the system's call to interpret: somebody with authority decides whether
//     to keep pursuing the auction or release the gold. Deliberately NOT
//     auto-withdrawn.
//
// A no-op for the overwhelming majority of payments, which have no live
// auction — the lookup returns nothing and this returns immediately.
func (s *Service) resolveAuctionAfterPayment(l *Loan, p *LoanPayment) {
	err := s.db.Transaction(func(tx *gorm.DB) error {
		// Locked: a concurrent auction action must not read this same state and
		// overwrite the freeze we are about to apply.
		rec, err := s.auctionRepo.FindActiveByLoanIDForUpdate(tx, l.ID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil // no live auction — nothing to do
			}
			return err
		}

		if l.Status == StatusClosed {
			rec.Stage = AuctionStageSettled
			rec.FinalSettlementStatus = AuctionSettlementSettledByRepayment
			if err := s.auctionRepo.UpdateTx(tx, rec); err != nil {
				return err
			}
			s.recordAuctionEvent(tx, rec.ID, AuctionEventSettledByRepaymentAuto, nil, "",
				fmt.Sprintf("Loan cleared in full by payment of ₹%.2f — auction cancelled automatically", p.Amount))
			s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
				"Dear %s, we have received your payment of ₹%.2f. Loan %s is now fully settled, the auction has been cancelled, and your pledged gold is safe. — Ambika Gold Finance",
				l.Customer.Name, p.Amount, l.LoanNumber,
			), commlog.TriggerPayment, "loan", l.ID)
			return nil
		}

		// Refresh the live figures so the decision-maker sees what is actually
		// still owed at this moment.
		s.enrich(l)
		outstanding := platform.RoundMoney(l.TotalOutstandingBalance)

		// One pending request per case: a second part-payment updates the
		// existing escalation rather than stacking up duplicates.
		existing, err := s.auctionRepo.FindPendingDecision(tx, rec.ID, AuctionDecisionKindPartialRepayment)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if existing != nil {
			existing.AmountPaid = platform.RoundMoney(existing.AmountPaid + p.Amount)
			existing.OutstandingAtRequest = outstanding
			existing.TriggeredByPaymentID = &p.ID
			if err := s.auctionRepo.UpdateDecision(tx, existing); err != nil {
				return err
			}
		} else if err := s.auctionRepo.CreateDecision(tx, &AuctionDecisionRequest{
			AuctionRecordID:      rec.ID,
			LoanID:               l.ID,
			Kind:                 AuctionDecisionKindPartialRepayment,
			TriggeredByPaymentID: &p.ID,
			AmountPaid:           platform.RoundMoney(p.Amount),
			OutstandingAtRequest: outstanding,
			Status:               AuctionDecisionPending,
		}); err != nil {
			return err
		}

		s.recordAuctionEvent(tx, rec.ID, AuctionEventDecisionRequested, nil, "", fmt.Sprintf(
			"Part-payment of ₹%.2f received (₹%.2f still owed) — auction frozen pending a keep/remove decision", p.Amount, outstanding))
		return nil
	})
	if err != nil {
		// Logged rather than failing the payment: the money was genuinely
		// received and must stay recorded. The auction stays where it was, and
		// the pipeline guards still re-read state on every subsequent action.
		log.Printf("auction resolution after payment failed for loan %d: %v", l.ID, err)
		return
	}

	if l.Status != StatusClosed {
		s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
			"Dear %s, we have received your payment of ₹%.2f towards loan %s. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — Ambika Gold Finance",
			l.Customer.Name, p.Amount, l.LoanNumber,
		), commlog.TriggerPayment, "loan", l.ID)
	}
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

	// CashTreatment decides whether the bank's advance is booked into
	// Cash-in-Hand or recorded with no cash effect at all. Must be one of the
	// BankPledgeCashTreatment* constants — the handler substitutes RecordOnly
	// for an omitted value, so cash only moves on an explicit opt-in.
	CashTreatment string

	// ActorEmployeeID/ActorRole identify the real authenticated staff member
	// for the audit trail — read from JWT claims via platform.ActorFromContext,
	// never from the request body.
	ActorEmployeeID *uint
	ActorRole       string
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

	// An unrecognised treatment is rejected rather than coerced: silently
	// reading a typo as "no cash" would suppress a real cash entry. The
	// handler is what turns an OMITTED value into RecordOnly.
	switch in.CashTreatment {
	case BankPledgeCashTreatmentCashIn, BankPledgeCashTreatmentRecordOnly:
	default:
		return nil, ErrInvalidCashTreatment
	}

	p := &BankPledgeRecord{
		LoanID:             loanID,
		BankID:             in.BankID,
		BankName:           in.BankName,
		PledgedAmount:      platform.RoundMoney(in.PledgedAmount),
		PledgeDate:         in.PledgeDate,
		BankInterestRate:   in.BankInterestRate,
		ReferenceNumber:    in.ReferenceNumber,
		BankPledgeDueDate:  in.BankPledgeDueDate,
		PledgedGrossWeight: grossWeight,
		PledgedNetWeight:   l.TotalNetWeight,
		CashTreatment:      in.CashTreatment,
		Status:             BankPledgeStatusRecordActive,
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

	// Cash is touched ONLY when the operator explicitly chose CashIn. A
	// RecordOnly pledge is pure book-keeping: no movement, no expense, and
	// correspondingly no reversal on release (see ReleaseBankPledge).
	if in.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil {
		movementID, err := s.cashRecorder.RecordBankPledgeCashIn(loanID, in.BankName, p.PledgedAmount, in.PledgeDate)
		if err != nil {
			log.Printf("cash-in movement (bank pledge) failed for loan %d: %v", loanID, err)
		} else {
			p.CashMovementID = &movementID
		}

		expenseID, err := s.cashRecorder.RecordBankPledgeExpense(loanID, in.BankName, p.PledgedAmount, in.PledgeDate, l.BranchID)
		if err != nil {
			log.Printf("expense entry (bank pledge) failed for loan %d: %v", loanID, err)
		} else {
			p.ExpenseID = &expenseID
		}

		if err := s.pledgeRepo.Update(p); err != nil {
			log.Printf("saving cash movement/expense links (bank pledge) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordPledgeEvent(p, BankPledgeEventPledged, in.ActorEmployeeID, in.ActorRole, pledgeTreatmentRemark(in.CashTreatment))

	return s.Get(l.ID, nil)
}

// pledgeTreatmentRemark renders the cash decision in plain words, so the audit
// timeline explains itself without the reader having to know the enum.
func pledgeTreatmentRemark(treatment string) string {
	if treatment == BankPledgeCashTreatmentCashIn {
		return "Pledged amount added to Cash-in-Hand"
	}
	return "Recorded as a re-pledge record only — no cash effect"
}

// recordPledgeEvent appends to a re-pledge record's audit trail. Like
// notifyCustomer, a failure here is logged rather than propagated: losing an
// audit line must never roll back the financial operation it describes.
func (s *Service) recordPledgeEvent(p *BankPledgeRecord, action string, actorID *uint, actorRole, remarks string) {
	if err := s.pledgeRepo.CreateEvent(&BankPledgeEvent{
		BankPledgeRecordID: p.ID,
		Action:             action,
		ActorEmployeeID:    actorID,
		ActorRole:          actorRole,
		Amount:             p.PledgedAmount,
		Remarks:            remarks,
	}); err != nil {
		log.Printf("bank pledge event (%s) failed for pledge %d: %v", action, p.ID, err)
	}
}

// --- Auction workflow (7-stage) --------------------------------------------
//
// Overdue -> Defaulted (both derived read-time flags, see
// accrual.go's enrichStatusFlags — no AuctionRecord exists yet at that
// point) -> AuctionEligible -> NoticeIssued -> AuctionScheduled ->
// Auctioned -> Settled. Each function below advances exactly one stage and
// validates the AuctionRecord/Loan is in the correct prior stage first.

// getAuctionRecord returns the loan's LIVE auction case. A loan may carry
// concluded cases from earlier attempts; those are reached through
// GetAuctionHistory instead, so "the" auction always means the active one.
func (s *Service) getAuctionRecord(loanID uint) (*AuctionRecord, error) {
	rec, err := s.auctionRepo.FindActiveByLoanID(loanID)
	if err != nil {
		return nil, ErrAuctionNotFound
	}
	return rec, nil
}

// requireNoPendingDecision blocks a pipeline step while any escalation is
// outstanding against the case. This is the load-bearing safety check of the
// whole auction rework: once a customer has paid something, their gold must
// not advance one step closer to being sold until a human has ruled on it.
func (s *Service) requireNoPendingDecision(recID uint) error {
	pending, err := s.auctionRepo.HasAnyPendingDecision(recID)
	if err != nil {
		return err
	}
	if pending {
		return ErrAuctionDecisionPending
	}
	return nil
}

// recordAuctionEvent appends to a case's staff-action audit trail. Logged
// rather than propagated on failure, for the same reason as recordPledgeEvent:
// losing an audit line must not roll back the operation it describes.
func (s *Service) recordAuctionEvent(tx *gorm.DB, recID uint, action string, actorID *uint, actorRole, remarks string) {
	if err := s.auctionRepo.CreateEvent(tx, &AuctionEvent{
		AuctionRecordID: recID,
		Action:          action,
		ActorEmployeeID: actorID,
		ActorRole:       actorRole,
		Remarks:         remarks,
	}); err != nil {
		log.Printf("auction event (%s) failed for auction %d: %v", action, recID, err)
	}
}

// GetAuctionHistory returns every auction case ever opened against a loan.
func (s *Service) GetAuctionHistory(loanID uint, branchID *uint) ([]AuctionRecord, error) {
	if err := s.checkLoanBranch(loanID, branchID); err != nil {
		return nil, err
	}
	return s.auctionRepo.FindHistoryByLoanID(loanID)
}

// ListConcludedAuctions returns finished auction cases (Settled or Withdrawn)
// across all loans, scoped to the caller's branch — backs the Auctions
// screen's History tab.
func (s *Service) ListConcludedAuctions(branchID *uint) ([]AuctionRecord, error) {
	return s.auctionRepo.FindAllConcluded(branchID)
}

// ListPendingAuctionDecisions returns every outstanding escalation awaiting a
// human decision, scoped to the caller's branch.
func (s *Service) ListPendingAuctionDecisions(branchID *uint) ([]AuctionDecisionRequest, error) {
	return s.auctionRepo.FindPendingDecisions(branchID)
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
// currently be Defaulted (IsDefaulted — overdue by more than 90 days AND
// still carrying genuine interest/penal-interest arrears, see accrual.go),
// creates an AuctionRecord at AuctionEligible, and sets Loan.Status
// accordingly. A loan that's overdue but has kept its accrued interest and
// penal interest fully paid down cannot be started into auction here.
//
// Only one case may be ACTIVE per loan, but a loan that had a case withdrawn
// (customer caught up) and then defaulted again can start a fresh one — the
// old behavior of "one auction per loan, forever" left such loans permanently
// unauctionable. The rule is enforced in the database by a partial unique
// index (see cmd/migrate), so two concurrent requests cannot both open a case;
// the constraint violation is translated back to ErrAuctionAlreadyStarted.
func (s *Service) MarkAuctionEligible(loanID uint, branchID *uint, actorID *uint, actorRole string) (*AuctionRecord, error) {
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
	// Checks the ACTIVE case only — a concluded one must not block a new
	// attempt. The DB index is the real guard against races.
	if _, err := s.auctionRepo.FindActiveByLoanID(loanID); err == nil {
		return nil, ErrAuctionAlreadyStarted
	}

	rec := &AuctionRecord{
		LoanID:                loanID,
		Stage:                 AuctionStageEligible,
		AuctionEligibleDate:   time.Now(),
		FinalSettlementStatus: AuctionSettlementPending,
	}
	if err := s.auctionRepo.Create(rec); err != nil {
		// A unique-violation here means a concurrent request won the race and
		// already opened the case, which is exactly "already started".
		if isUniqueViolation(err) {
			return nil, ErrAuctionAlreadyStarted
		}
		return nil, err
	}

	l.Status = StatusAuctionEligible
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}

	s.recordAuctionEvent(nil, rec.ID, AuctionEventEligible, actorID, actorRole, "Loan marked auction-eligible")
	s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
		"Dear %s, your gold loan %s is seriously overdue and has now been marked eligible for auction. Outstanding: ₹%.2f. Please contact the branch immediately to settle and retain your pledged items. — Ambika Gold Finance",
		l.Customer.Name, l.LoanNumber, l.TotalOutstandingBalance,
	), commlog.TriggerAuctionEvent, "auction_record", rec.ID)

	return s.getAuctionRecord(loanID)
}

// isUniqueViolation reports whether err is a duplicate-key error. Matched on
// message text rather than a driver-specific error code, because this codebase
// keeps GORM driver details out of the service layer; the substrings cover
// Postgres ("duplicate key value violates unique constraint") and SQLite
// ("UNIQUE constraint failed").
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "uniqueviolation")
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
func (s *Service) IssueAuctionNotice(loanID uint, branchID *uint, remarks string, actorID *uint, actorRole string) (*AuctionRecord, error) {
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
	// Do not escalate pressure on a customer whose payment is under review.
	if err := s.requireNoPendingDecision(rec.ID); err != nil {
		return nil, err
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
			), commlog.TriggerAuctionNotice, "auction_record", rec.ID)
		}
	}

	if rec.Stage == AuctionStageEligible {
		rec.Stage = AuctionStageNotice
		if err := s.auctionRepo.Update(rec); err != nil {
			return nil, err
		}
	}
	s.recordAuctionEvent(nil, rec.ID, AuctionEventNoticeIssued, actorID, actorRole, remarks)
	return s.getAuctionRecord(loanID)
}

// ScheduleAuction records the actual auction date/reference and advances
// the case to AuctionScheduled. Requires at least one notice to have been
// issued first.
func (s *Service) ScheduleAuction(loanID uint, branchID *uint, date time.Time, referenceNumber string, actorID *uint, actorRole string) (*AuctionRecord, error) {
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
	// Never fix a sale date for gold whose repayment is still being reviewed.
	if err := s.requireNoPendingDecision(rec.ID); err != nil {
		return nil, err
	}
	rec.AuctionDate = &date
	rec.AuctionReferenceNumber = referenceNumber
	rec.Stage = AuctionStageScheduled
	if err := s.auctionRepo.Update(rec); err != nil {
		return nil, err
	}

	s.recordAuctionEvent(nil, rec.ID, AuctionEventScheduled, actorID, actorRole,
		fmt.Sprintf("Auction scheduled for %s (ref %s)", date.Format("02-Jan-2006"), referenceNumber))
	if l, err := s.repo.FindByID(loanID); err == nil {
		s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
			"Dear %s, the auction of the gold pledged against loan %s has been scheduled for %s (ref %s). You may still settle the outstanding dues before this date to reclaim your items. — Ambika Gold Finance",
			l.Customer.Name, l.LoanNumber, date.Format("02-Jan-2006"), referenceNumber,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	}
	return s.getAuctionRecord(loanID)
}

// RecordAuctionSale records what the gold actually sold for and what it cost
// to run the auction, then makes that money REAL:
//
//  1. The net proceeds are booked as a cash-in movement. Previously the sale
//     amount was captured and then thrown away — the branch received money
//     that never appeared anywhere in the books.
//  2. The proceeds are applied against the debt through the ordinary payment
//     waterfall (fee → penal → interest → principal) and logged as a ledger
//     entry, instead of the balance simply being forced to zero.
//  3. What happens next depends on whether the sale actually covered the debt:
//     - Covered it: the loan closes, and any excess is recorded as a surplus
//     payable to the customer, awaiting an explicit disposition decision.
//     - Did not cover it: the loan does NOT close. It moves to
//     StatusAuctionedBalanceDue with the real remaining balance intact, and a
//     Shortfall escalation is raised for Branch Manager/Management to decide
//     whether to write the balance off or pursue it. The old code closed such
//     loans anyway, silently erasing money the customer still owed.
//
// Runs in a transaction: the cash movement, ledger entry, balance change,
// case update and escalation must all land together, or a failure part-way
// could leave gold sold with no record of the proceeds.
func (s *Service) RecordAuctionSale(loanID uint, branchID *uint, saleAmount, expenses float64, actorID *uint, actorRole string) (*AuctionRecord, error) {
	if saleAmount <= 0 {
		return nil, ErrInvalidAmount
	}
	if expenses < 0 {
		return nil, ErrInvalidAmount
	}
	rec, err := s.getAuctionRecord(loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != AuctionStageScheduled {
		return nil, ErrAuctionWrongStage
	}
	// The decisive guard: gold must never be sold while a repayment decision
	// is outstanding.
	if err := s.requireNoPendingDecision(rec.ID); err != nil {
		return nil, err
	}
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}

	// Bring interest up to date first so the debt being compared against the
	// proceeds is the real, current figure.
	s.accrueAndSave(l)
	s.enrich(l)

	saleAmount = platform.RoundMoney(saleAmount)
	expenses = platform.RoundMoney(expenses)
	netProceeds := platform.RoundMoney(saleAmount - expenses)
	totalDebt := platform.RoundMoney(l.TotalOutstandingBalance)
	fullyCovered := netProceeds >= totalDebt-0.01

	// Only the portion that can actually settle debt goes through the
	// waterfall; anything beyond that is the customer's surplus, handled
	// separately so it is never quietly absorbed as if it paid something.
	applied := netProceeds
	if applied > totalDebt {
		applied = totalDebt
	}

	auctionDate := time.Now()
	var payment *LoanPayment

	txErr := s.db.Transaction(func(tx *gorm.DB) error {
		if applied > 0 {
			fee, penal, interest, principal, err := allocatePayment(l, PaymentTypeAuctionSale, applied)
			if err != nil {
				return err
			}
			l.OutstandingProcessingFee = platform.RoundMoney(math.Max(0, l.OutstandingProcessingFee-fee))
			l.PenalInterestPaid = platform.RoundMoney(l.PenalInterestPaid + penal)
			l.InterestPaid = platform.RoundMoney(l.InterestPaid + interest)
			l.OutstandingAmount = platform.RoundMoney(math.Max(0, l.OutstandingAmount-principal))

			outstandingInterest := l.AccruedInterest - l.InterestPaid
			outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
			payment = &LoanPayment{
				LoanID:               loanID,
				Amount:               applied,
				Type:                 PaymentTypeAuctionSale,
				PaidOn:               auctionDate,
				ReceivedByEmployeeID: derefUint(actorID),
				Method:               "Auction",
				Reference:            rec.AuctionReferenceNumber,
				Description:          fmt.Sprintf("Auction proceeds applied (sale ₹%.2f less expenses ₹%.2f)", saleAmount, expenses),
				ProcessingFeeApplied: fee,
				PenalInterestApplied: penal,
				InterestApplied:      interest,
				PrincipalApplied:     principal,
				RunningBalance: platform.RoundMoney(l.OutstandingAmount +
					math.Max(0, outstandingInterest) + math.Max(0, outstandingPenal) + l.OutstandingProcessingFee),
			}
			if err := tx.Create(payment).Error; err != nil {
				return err
			}
		}

		rec.SaleAmount = saleAmount
		rec.AuctionExpenses = expenses
		// Kept as the informational snapshot it always was: positive = surplus
		// owed to the customer, negative = shortfall still unrecovered.
		rec.SurplusShortfall = platform.RoundMoney(netProceeds - totalDebt)
		rec.SurplusPayableAmount = platform.RoundMoney(math.Max(0, netProceeds-totalDebt))
		rec.Stage = AuctionStageAuctioned
		if err := s.auctionRepo.UpdateTx(tx, rec); err != nil {
			return err
		}

		l.AuctionDate = &auctionDate
		l.AuctionAmount = &saleAmount
		if fullyCovered {
			l.Status = StatusClosed
		} else {
			// Deliberately NOT Closed: real money is still owed. Accrual is
			// frozen in this state (see StatusAuctionedBalanceDue) so the
			// manager decides against a stable figure.
			l.Status = StatusAuctionedBalanceDue
		}
		if err := tx.Save(l).Error; err != nil {
			return err
		}

		if !fullyCovered {
			shortfall := platform.RoundMoney(totalDebt - netProceeds)
			if err := s.auctionRepo.CreateDecision(tx, &AuctionDecisionRequest{
				AuctionRecordID:      rec.ID,
				LoanID:               loanID,
				Kind:                 AuctionDecisionKindShortfall,
				AmountPaid:           netProceeds,
				OutstandingAtRequest: shortfall,
				Status:               AuctionDecisionPending,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}

	// Cash and notifications sit outside the transaction because both are
	// external side effects that must not be able to roll back a completed,
	// already-consistent sale — the same log-and-continue rule the rest of
	// this service applies to cash and WhatsApp.
	if s.cashRecorder != nil {
		if _, err := s.cashRecorder.RecordAuctionSaleCashIn(loanID, l.LoanNumber, netProceeds, l.BranchID, auctionDate); err != nil {
			log.Printf("cash-in movement (auction sale) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordAuctionEvent(nil, rec.ID, AuctionEventSaleRecorded, actorID, actorRole, fmt.Sprintf(
		"Sold for ₹%.2f, expenses ₹%.2f, net ₹%.2f applied against debt of ₹%.2f", saleAmount, expenses, netProceeds, totalDebt))

	if fullyCovered {
		surplusNote := ""
		if rec.SurplusPayableAmount > 0.01 {
			surplusNote = fmt.Sprintf(" A surplus of ₹%.2f is due back to you — the branch will contact you regarding this.", rec.SurplusPayableAmount)
		}
		s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
			"Dear %s, the gold pledged against loan %s was auctioned on %s for ₹%.2f. Your loan is now fully settled and closed.%s — Ambika Gold Finance",
			l.Customer.Name, l.LoanNumber, auctionDate.Format("02-Jan-2006"), saleAmount, surplusNote,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	} else {
		s.recordAuctionEvent(nil, rec.ID, AuctionEventShortfallEscalated, actorID, actorRole, fmt.Sprintf(
			"Auction proceeds fell short by ₹%.2f — escalated for a write-off/pursue decision", platform.RoundMoney(totalDebt-netProceeds)))
		s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
			"Dear %s, the gold pledged against loan %s was auctioned on %s for ₹%.2f, which did not cover the full amount due. A balance of ₹%.2f remains and is under review by our management. We will inform you of the outcome. — Ambika Gold Finance",
			l.Customer.Name, l.LoanNumber, auctionDate.Format("02-Jan-2006"), saleAmount, platform.RoundMoney(totalDebt-netProceeds),
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	}

	return s.getAuctionRecord(loanID)
}

// derefUint safely unwraps an optional employee ID for fields that require a
// concrete value; 0 means "system", matching how the rest of the codebase
// treats an absent actor.
func derefUint(p *uint) uint {
	if p == nil {
		return 0
	}
	return *p
}

// SettleAuction disposes of a surplus and closes the case out. It is only
// reachable when the auction fully covered the debt: a sale that left money
// owing goes through the Shortfall decision instead (see
// ResolveAuctionDecision), which is why StatusAuctionedBalanceDue is rejected
// here rather than being quietly settled.
//
// The disposition must be chosen explicitly — the surplus is the customer's
// money, so where it went is recorded as a decision, not a default:
//   - RefundedToCustomer books a real cash-out and links the movement.
//   - RecordedAsIncome books no cash-out, because the full net proceeds
//     already entered the till at sale time; booking another movement would
//     count the same rupees twice.
//
// A disposition can only be set once, so a surplus can never be paid out
// twice.
func (s *Service) SettleAuction(loanID uint, branchID *uint, disposition, remarks string, actorID *uint, actorRole string) (*AuctionRecord, error) {
	switch disposition {
	case AuctionSurplusRefundedToCustomer, AuctionSurplusRecordedAsIncome:
	default:
		return nil, ErrInvalidSurplusDisposition
	}
	if disposition == AuctionSurplusRecordedAsIncome && strings.TrimSpace(remarks) == "" {
		// Retaining a customer's surplus is the kind of decision that must
		// carry a stated reason.
		return nil, ErrSettlementRemarksRequired
	}
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	rec, err := s.getAuctionRecord(loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != AuctionStageAuctioned {
		return nil, ErrAuctionWrongStage
	}
	if l.Status == StatusAuctionedBalanceDue {
		return nil, ErrAuctionBalanceDueCannotSettle
	}
	if rec.SurplusPayableAmount <= 0.01 {
		return nil, ErrNoSurplusToDispose
	}
	if rec.SurplusDisposition != "" || rec.SurplusPaidOutMovementID != nil {
		return nil, ErrSurplusAlreadyDisposed
	}

	now := time.Now()
	if disposition == AuctionSurplusRefundedToCustomer && s.cashRecorder != nil {
		movementID, err := s.cashRecorder.RecordAuctionSurplusCashOut(loanID, l.LoanNumber, rec.SurplusPayableAmount, l.BranchID, now)
		if err != nil {
			log.Printf("cash-out movement (auction surplus refund) failed for loan %d: %v", loanID, err)
		} else {
			rec.SurplusPaidOutMovementID = &movementID
		}
	}

	rec.SurplusDisposition = disposition
	if disposition == AuctionSurplusRefundedToCustomer {
		rec.FinalSettlementStatus = AuctionSettlementSettledToCustomer
	} else {
		rec.FinalSettlementStatus = AuctionSettlementSettledToLoanCo
	}
	rec.Stage = AuctionStageSettled
	if err := s.auctionRepo.Update(rec); err != nil {
		return nil, err
	}

	s.recordAuctionEvent(nil, rec.ID, AuctionEventSettled, actorID, actorRole, fmt.Sprintf(
		"Surplus ₹%.2f — %s. %s", rec.SurplusPayableAmount, disposition, remarks))

	if disposition == AuctionSurplusRefundedToCustomer {
		s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
			"Dear %s, the surplus of ₹%.2f from the auction of loan %s is being refunded to you. Please visit the branch to collect it. — Ambika Gold Finance",
			l.Customer.Name, rec.SurplusPayableAmount, l.LoanNumber,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	} else {
		s.notifyCustomer(l.Customer.Phone, fmt.Sprintf(
			"Dear %s, the auction settlement for loan %s is now complete and the loan is closed. — Ambika Gold Finance",
			l.Customer.Name, l.LoanNumber,
		), commlog.TriggerAuctionEvent, "auction_record", rec.ID)
	}

	return s.getAuctionRecord(loanID)
}

// shortfallAuthorityRoles are the only roles that may decide the fate of a
// post-auction shortfall. Auction Administrator is deliberately absent: it
// raises the escalation (automatically, on recording the sale) but writing off
// or pursuing real money owed is a higher-authority call. Enforced here in the
// service — not merely hidden in the UI — because Auction Administrator does
// pass the auction route guard.
var shortfallAuthorityRoles = map[string]bool{
	"Branch Manager": true,
	"Management":     true,
	"Administrator":  true,
}

// partialRepaymentAuthorityRoles may decide whether a part-paying customer's
// gold stays in the auction. Either the Auction Administrator or the Branch
// Manager can act — whoever gets there first — so a customer's gold is never
// stuck waiting for two signatures.
var partialRepaymentAuthorityRoles = map[string]bool{
	"Auction Administrator": true,
	"Branch Manager":        true,
	"Management":            true,
	"Administrator":         true,
}

// ResolveAuctionDecision records a human decision on an escalation and applies
// its consequences. Both kinds of escalation share this one entry point, with
// the legal outcomes validated per kind:
//
//	PartialRepayment → KeepInAuction | RemovedFromAuction
//	Shortfall        → PursueBalance | WriteOff
//
// The most consequential branch is Shortfall/PursueBalance: it returns the loan
// to Overdue, which is what resumes interest accrual through the ordinary path
// (projectAccrual only accrues for Active/DueSoon/Overdue). While the decision
// was pending the balance sat frozen at StatusAuctionedBalanceDue, so the
// decision-maker judged a stable figure rather than a moving one.
func (s *Service) ResolveAuctionDecision(loanID, requestID uint, branchID *uint, decision, remarks string, actorID *uint, actorRole string) (*AuctionRecord, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}

	var (
		notifyMsg    string
		auctionRecID uint
	)

	txErr := s.db.Transaction(func(tx *gorm.DB) error {
		req, err := s.auctionRepo.FindDecisionByID(tx, requestID)
		if err != nil {
			return ErrAuctionDecisionNotFound
		}
		if req.LoanID != loanID {
			return ErrAuctionDecisionNotFound
		}
		if req.Status != AuctionDecisionPending {
			return ErrAuctionDecisionAlreadyDecided
		}
		auctionRecID = req.AuctionRecordID

		rec, err := s.auctionRepo.FindActiveByLoanIDForUpdate(tx, loanID)
		if err != nil {
			return ErrAuctionNotFound
		}

		now := time.Now()
		req.Status = decision
		req.DecidedByEmployeeID = actorID
		req.DecidedByRole = actorRole
		req.DecisionRemarks = remarks
		req.DecidedAt = &now

		switch req.Kind {
		case AuctionDecisionKindPartialRepayment:
			if !partialRepaymentAuthorityRoles[actorRole] {
				return ErrShortfallAuthorityRequired
			}
			switch decision {
			case AuctionDecisionKeepInAuction:
				// Case simply un-freezes and continues from its current stage.
				s.recordAuctionEvent(tx, rec.ID, AuctionEventDecisionKeep, actorID, actorRole, remarks)
				notifyMsg = fmt.Sprintf(
					"Dear %s, following review of your recent payment, loan %s remains scheduled for auction as a balance of ₹%.2f is still outstanding. Please contact the branch urgently. — Ambika Gold Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)
			case AuctionDecisionRemovedFromAuction:
				rec.Stage = AuctionStageWithdrawn
				if err := s.auctionRepo.UpdateTx(tx, rec); err != nil {
					return err
				}
				// Back to a normal collection status. A fresh default later can
				// open a brand-new auction case (the partial unique index only
				// restricts ACTIVE cases).
				l.Status = normalStatusFor(l, now)
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				s.recordAuctionEvent(tx, rec.ID, AuctionEventDecisionRemove, actorID, actorRole, remarks)
				notifyMsg = fmt.Sprintf(
					"Dear %s, following your recent payment, loan %s has been removed from auction and your pledged gold is no longer at risk. A balance of ₹%.2f remains payable. — Ambika Gold Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)
			default:
				return ErrInvalidAuctionDecision
			}

		case AuctionDecisionKindShortfall:
			if !shortfallAuthorityRoles[actorRole] {
				return ErrShortfallAuthorityRequired
			}
			if strings.TrimSpace(remarks) == "" {
				return ErrDecisionRemarksRequired
			}
			switch decision {
			case AuctionDecisionPursueBalance:
				// Overdue is what resumes accrual and normal collection — see
				// this function's doc comment.
				l.Status = StatusOverdue
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				s.recordAuctionEvent(tx, rec.ID, AuctionEventDecisionPursue, actorID, actorRole, remarks)
				notifyMsg = fmt.Sprintf(
					"Dear %s, the auction of your pledged gold under loan %s did not clear the full amount due. A balance of ₹%.2f remains payable and will continue to accrue interest. Please contact the branch to arrange settlement. — Ambika Gold Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)

			case AuctionDecisionWriteOff:
				// Clear the remaining balance through the ordinary allocation
				// waterfall as a non-cash write-off, so the ledger shows the
				// forgiveness explicitly instead of the balance being zeroed
				// behind the scenes.
				s.enrich(l)
				owed := platform.RoundMoney(l.TotalOutstandingBalance)
				if owed > 0 {
					fee, penal, interest, principal, err := allocatePayment(l, PaymentTypeAuctionWriteOff, owed)
					if err != nil {
						return err
					}
					l.OutstandingProcessingFee = platform.RoundMoney(math.Max(0, l.OutstandingProcessingFee-fee))
					l.PenalInterestPaid = platform.RoundMoney(l.PenalInterestPaid + penal)
					l.InterestPaid = platform.RoundMoney(l.InterestPaid + interest)
					l.OutstandingAmount = platform.RoundMoney(math.Max(0, l.OutstandingAmount-principal))

					if err := tx.Create(&LoanPayment{
						LoanID:               loanID,
						Amount:               owed,
						Type:                 PaymentTypeAuctionWriteOff,
						PaidOn:               now,
						ReceivedByEmployeeID: derefUint(actorID),
						Method:               "Write-Off",
						Description:          "Post-auction shortfall written off by management: " + remarks,
						ProcessingFeeApplied: fee,
						PenalInterestApplied: penal,
						InterestApplied:      interest,
						PrincipalApplied:     principal,
						RunningBalance:       0,
					}).Error; err != nil {
						return err
					}
				}
				l.Status = StatusClosed
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				rec.Stage = AuctionStageSettled
				rec.FinalSettlementStatus = AuctionSettlementWrittenOff
				if err := s.auctionRepo.UpdateTx(tx, rec); err != nil {
					return err
				}
				s.recordAuctionEvent(tx, rec.ID, AuctionEventDecisionWriteOff, actorID, actorRole,
					fmt.Sprintf("Shortfall of ₹%.2f written off: %s", owed, remarks))
				notifyMsg = fmt.Sprintf(
					"Dear %s, the balance remaining on loan %s after auction has been waived and the loan is now closed. No further amount is payable. — Ambika Gold Finance",
					l.Customer.Name, l.LoanNumber,
				)

			default:
				return ErrInvalidAuctionDecision
			}

		default:
			return ErrInvalidAuctionDecision
		}

		return s.auctionRepo.UpdateDecision(tx, req)
	})
	if txErr != nil {
		return nil, txErr
	}

	if notifyMsg != "" {
		s.notifyCustomer(l.Customer.Phone, notifyMsg, commlog.TriggerAuctionEvent, "auction_record", auctionRecID)
	}

	// The case may now be concluded, in which case there is no active record to
	// return — fall back to its history entry so callers still see the outcome.
	if rec, err := s.auctionRepo.FindActiveByLoanID(loanID); err == nil {
		return rec, nil
	}
	if recs, err := s.auctionRepo.FindHistoryByLoanID(loanID); err == nil {
		for i := range recs {
			if recs[i].ID == auctionRecID {
				return &recs[i], nil
			}
		}
	}
	return nil, ErrAuctionNotFound
}

// normalStatusFor derives the status an open loan should carry based purely on
// its due date — used when a loan leaves the auction pipeline and has to rejoin
// ordinary collection. Mirrors the thresholds enrichStatusFlags applies to its
// read-time display flags (accrual.go), so a withdrawn loan lands on the same
// status it would have had if it had never been marked auction-eligible.
func normalStatusFor(l *Loan, asOf time.Time) string {
	if asOf.After(l.DueDate) {
		return StatusOverdue
	}
	if int(l.DueDate.Sub(asOf).Hours()/24) <= dueSoonWindowDays {
		return StatusDueSoon
	}
	return StatusActive
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

// ReleaseBankPledge reclaims a loan's gold from the bank. Its cash effect
// MIRRORS whatever was chosen when the pledge was created: a CashIn pledge
// books the amount back out, while a RecordOnly pledge is a symmetric no-op —
// nothing was booked in, so nothing is booked out. Without that symmetry a
// RecordOnly pledge would credit the till on release for money that never
// arrived.
func (s *Service) ReleaseBankPledge(loanID, pledgeID uint, branchID *uint, actorID *uint, actorRole string) (*Loan, error) {
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
	p.Status = BankPledgeStatusRecordReleased
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

	if p.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil {
		// The original cash-in movement (and its mirrored expense) from the
		// pledge stay untouched as permanent history; releasing the gold
		// books the same amount back out as a fresh cash-out movement plus
		// a mirrored release expense, so both legs are visible in reports.
		movementID, err := s.cashRecorder.RecordBankPledgeCashOut(loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
		if err != nil {
			log.Printf("cash-out movement (bank release) failed for loan %d: %v", loanID, err)
		} else {
			p.ReleaseCashMovementID = &movementID
		}

		expenseID, err := s.cashRecorder.RecordBankPledgeReleaseExpense(loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
		if err != nil {
			log.Printf("release expense entry (bank release) failed for loan %d: %v", loanID, err)
		} else {
			p.ReleaseExpenseID = &expenseID
		}

		if err := s.pledgeRepo.Update(p); err != nil {
			log.Printf("saving cash-out movement/expense links (bank release) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordPledgeEvent(p, BankPledgeEventReleased, actorID, actorRole, pledgeReleaseRemark(p.CashTreatment))

	return s.Get(l.ID, nil)
}

func pledgeReleaseRemark(treatment string) string {
	if treatment == BankPledgeCashTreatmentCashIn {
		return "Pledged amount booked back out of Cash-in-Hand"
	}
	return "No cash effect — pledge was recorded only"
}

// VoidBankPledge cancels a re-pledge recorded in error and is the ONLY way to
// correct a mis-chosen CashTreatment, which is otherwise immutable. Editing
// that field in place would retroactively falsify cash history: a pledge that
// really did put money in the till would start claiming it never had, and its
// release would then skip the reversal that money needs.
//
// Voiding instead leaves the original record fully intact and visible, books a
// compensating cash-out only if the original actually moved cash, and logs who
// voided it and why. Staff then create a fresh pledge with the right treatment.
func (s *Service) VoidBankPledge(loanID, pledgeID uint, branchID *uint, reason string, actorID *uint, actorRole string) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	p, err := s.pledgeRepo.FindByID(pledgeID)
	if err != nil || p.LoanID != loanID {
		return nil, ErrPledgeNotFound
	}
	if p.Status != BankPledgeStatusRecordActive {
		return nil, ErrPledgeNotActive
	}
	if strings.TrimSpace(reason) == "" {
		return nil, ErrVoidReasonRequired
	}

	now := time.Now()
	p.Status = BankPledgeStatusRecordVoided
	p.VoidedAt = &now
	p.VoidReason = reason

	// Only a pledge that actually credited the till needs a reversal. Voiding a
	// RecordOnly pledge touches no cash, exactly as creating it didn't.
	if p.CashTreatment == BankPledgeCashTreatmentCashIn && s.cashRecorder != nil {
		movementID, err := s.cashRecorder.RecordBankPledgeCashOut(loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
		if err != nil {
			log.Printf("compensating cash-out (pledge void) failed for loan %d: %v", loanID, err)
		} else {
			p.VoidCashMovementID = &movementID
		}
	}

	if err := s.pledgeRepo.Update(p); err != nil {
		return nil, err
	}

	// The gold was never really with the bank, so the loan goes back to
	// not-pledged and the packet is moved back accordingly.
	l.BankPledgeStatus = BankPledgeStatusNotPledged
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	if s.packetMover != nil {
		if err := s.packetMover.RecordBankReleaseMovement(loanID, "Bank pledge voided: "+reason); err != nil {
			log.Printf("packet movement (pledge void) failed for loan %d: %v", loanID, err)
		}
	}

	s.recordPledgeEvent(p, BankPledgeEventVoided, actorID, actorRole, reason)

	return s.Get(l.ID, nil)
}

// GetBankPledgeHistory returns every re-pledge ever recorded against a loan,
// including released and voided ones, each with its audit trail.
func (s *Service) GetBankPledgeHistory(loanID uint, branchID *uint) ([]BankPledgeRecord, error) {
	if err := s.checkLoanBranch(loanID, branchID); err != nil {
		return nil, err
	}
	return s.pledgeRepo.FindHistoryByLoanID(loanID)
}

// ListBankPledgeHistory returns re-pledge records across all loans, scoped to
// the caller's branch — backs the Bank Re-Pledge screen's History tab.
func (s *Service) ListBankPledgeHistory(branchID *uint) ([]BankPledgeRecord, error) {
	return s.pledgeRepo.FindAllHistory(branchID)
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

// GetCustomer360 aggregates a customer's whole loan relationship. from/to
// are optional (nil = unbounded) inclusive bounds on each loan's OpenedDate;
// because every other section of the 360 view (ornaments, payments, bank
// pledges, auction history) and every total below is derived from the loan
// set, narrowing the window narrows the entire profile consistently.
func (s *Service) GetCustomer360(customerID uint, from, to *time.Time) (*Customer360, error) {
	cust, err := s.customerRepo.FindByID(customerID)
	if err != nil {
		return nil, ErrCustomerInvalid
	}
	loans, err := s.repo.FindAll(LoanFilter{CustomerID: customerID, OpenedFrom: from, OpenedTo: to})
	if err != nil {
		return nil, err
	}

	out := &Customer360{Customer: cust.ToResponse()}
	for i := range loans {
		s.enrich(&loans[i])
		// Only money that actually left the till. A loan still in the sanction
		// chain (or rejected) has been disbursed nothing — see Decide's
		// `disbursing` flag, which is what triggers the cash-out movement.
		if loans[i].ApprovalStage == ApprovalStageApproved {
			out.TotalDisbursed += loans[i].PrincipalAmount
		}
		out.TotalOutstanding += loans[i].TotalOutstandingBalance
		out.TotalPaid += loans[i].TotalPaid
		switch loans[i].Status {
		case StatusClosed, StatusAuctioned:
			out.ClosedLoanCount++
		case StatusActive, StatusDueSoon, StatusOverdue, StatusClosureRequested,
			// A post-auction shortfall balance is still owed and still being
			// collected, so it counts as an open relationship, not a closed one.
			StatusAuctionedBalanceDue:
			out.ActiveLoanCount++
		}
		// A loan can accumulate several auction cases over its life (one
		// withdrawn after the customer caught up, another after a later
		// default), so the 360 view shows all of them rather than just one.
		if recs, err := s.auctionRepo.FindHistoryByLoanID(loans[i].ID); err == nil {
			out.AuctionHistory = append(out.AuctionHistory, recs...)
		}
	}
	out.Loans = loans
	return out, nil
}

// --- Indemnity bond Aadhaar eSign (Setu) ------------------------------------

// bondDataForLoan builds the RenderIndemnityBondPDF input from a loan's
// preloaded Customer/Branch — same fields frontend/components/NewLoan.tsx's
// printIndemnity() assembles via buildDraft(), computed from the loan's own
// data rather than the pre-save draft it uses (this runs against a real,
// persisted loan — see StartIndemnityBondSign).
func bondDataForLoan(l *Loan) BondData {
	now := time.Now()
	age := 0
	if !l.Customer.DOB.IsZero() {
		age = int(now.Sub(l.Customer.DOB).Hours() / 24 / 365.25)
	}
	return BondData{
		LoanNumber:   l.LoanNumber,
		CustomerName: l.Customer.Name,
		Age:          age,
		Address:      l.Customer.Address,
		BranchName:   l.Branch.Name,
		Phone:        l.Customer.Phone,
		Day:          now.Day(),
		Month:        now.Month().String(),
		Year:         now.Year(),
	}
}

// StartIndemnityBondSign renders the indemnity bond PDF for loanID (in the
// given language), uploads it to Setu, and creates an Aadhaar eSign
// signature request naming the loan's customer as signer. redirectURL is
// where Setu sends the customer back to after they complete Aadhaar+OTP
// signing on their own device — the frontend supplies this the same way
// customer.Service.StartAadhaarVerify's redirectURL works.
//
// The bond's print-and-sign-by-hand buttons (NewLoan.tsx/LoanDetail.tsx)
// are untouched by this — eSign is an additional path, not a replacement,
// since it needs the customer's own device and network.
func (s *Service) StartIndemnityBondSign(loanID uint, branchID *uint, lang string, redirectURL string) (*platform.SignatureRequest, error) {
	if s.esign == nil {
		return nil, ErrEsignNotConfigured
	}
	if _, ok := bondTemplates[lang]; !ok {
		return nil, ErrUnsupportedIndemnityBondLang
	}
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if l.IndemnityBondSignStatus == "sign_complete" {
		return nil, ErrIndemnityBondAlreadySigned
	}

	pdfBytes, err := RenderIndemnityBondPDF(bondDataForLoan(l), lang)
	if err != nil {
		return nil, err
	}

	doc, err := s.esign.UploadDocument(pdfBytes, "Indemnity Bond - "+l.LoanNumber)
	if err != nil {
		return nil, err
	}

	phone := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, l.Customer.Phone)
	if len(phone) > 10 {
		phone = phone[len(phone)-10:]
	}
	if len(phone) < 10 {
		phone = "9876543210"
	}

	name := strings.TrimSpace(l.Customer.Name)
	if len(name) < 3 {
		name = "Customer " + l.LoanNumber
	}

	signer := platform.Signer{
		Identifier:  phone,
		DisplayName: name,
		Signature: &platform.SignatureConfig{
			OnPages:  []string{"1"},
			Position: "bottom-right",
		},
	}
	if !l.Customer.DOB.IsZero() {
		signer.BirthYear = strconv.Itoa(l.Customer.DOB.Year())
	}
	req, err := s.esign.CreateSignatureRequest(doc.ID, signer, redirectURL)
	if err != nil {
		return nil, err
	}

	l.IndemnityBondDocumentID = doc.ID
	l.IndemnityBondSignRequestID = req.ID
	l.IndemnityBondSignStatus = req.Status
	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	return req, nil
}

// CheckIndemnityBondSign polls the outstanding Setu signature request
// started by StartIndemnityBondSign. While the customer hasn't finished
// Aadhaar+OTP signing yet, this returns the current status and leaves the
// loan's stored signed-document fields untouched — callers should poll
// again later. Once "sign_complete", it downloads the signed PDF from
// Setu's (time-limited) link and re-hosts it via internal/upload so the
// loan keeps its own permanent copy rather than depending on Setu's
// validUpto-bounded URL.
func (s *Service) CheckIndemnityBondSign(loanID uint, branchID *uint) (*Loan, *platform.SignatureStatus, error) {
	if s.esign == nil {
		return nil, nil, ErrEsignNotConfigured
	}
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, nil, ErrNotFound
	}
	if l.IndemnityBondSignRequestID == "" {
		return nil, nil, ErrNoIndemnityBondSignRequest
	}

	status, err := s.esign.GetSignatureStatus(l.IndemnityBondSignRequestID)
	if err != nil {
		return nil, nil, err
	}
	if status.Status != "sign_complete" {
		l.IndemnityBondSignStatus = status.Status
		if updErr := s.repo.Update(l); updErr != nil {
			log.Printf("indemnity bond sign status update failed for loan %d: %v", l.ID, updErr)
		}
		return l, status, nil
	}

	signed, err := s.esign.GetSignedDocument(l.IndemnityBondSignRequestID)
	if err != nil {
		return nil, nil, err
	}

	resp, err := http.Get(signed.DownloadURL)
	if err != nil {
		return nil, nil, fmt.Errorf("indemnity bond: download signed document: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, nil, fmt.Errorf("indemnity bond: download signed document: unexpected status %d", resp.StatusCode)
	}
	pdfBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("indemnity bond: read signed document: %w", err)
	}

	url, err := upload.SaveBytes(s.uploadsDir, "indemnity-bond-"+l.LoanNumber+".pdf", pdfBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("indemnity bond: store signed document: %w", err)
	}

	now := time.Now()
	l.IndemnityBondSignStatus = "sign_complete"
	l.IndemnityBondSignedURL = url
	l.IndemnityBondSignedAt = &now
	if err := s.repo.Update(l); err != nil {
		return nil, nil, err
	}

	updated, err := s.repo.FindByID(l.ID)
	if err != nil {
		return nil, nil, err
	}
	return updated, status, nil
}

// --- Loan drafts ------------------------------------------------------------

// DraftOrnamentInput is one row of a draft's ornament table. Every field is
// optional: a draft records how far staff got, so a row with a name but no
// weight yet (or a weight but no type) is legitimate and stored as-is.
type DraftOrnamentInput struct {
	Name        string
	Purity      string
	GrossWeight float64
	Quantity    int
	ImageURL    string
	ImageName   string
}

// DraftInput is the whole New Gold Loan form as saved by "Save Draft".
// BranchID is the only required field — everything else may legitimately be
// unset in a part-filled form (see LoanDraft's doc comment for why nothing
// here is validated the way CreateInput is).
type DraftInput struct {
	BranchID          uint
	CustomerID        *uint
	SchemeID          *uint
	LockerID          *uint
	PrincipalOverride *float64
	Ornaments         []DraftOrnamentInput
}

// ErrDraftBranchRequired is the one validation a draft does enforce: without
// a branch there's nothing to scope the draft to, so it could never be
// listed back by its owner.
var ErrDraftBranchRequired = errors.New("branchId is required to save a draft")

func (in DraftInput) toOrnamentRows() []LoanDraftOrnament {
	rows := make([]LoanDraftOrnament, len(in.Ornaments))
	for i, o := range in.Ornaments {
		rows[i] = LoanDraftOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			Quantity:    o.Quantity,
			ImageURL:    o.ImageURL,
			ImageName:   o.ImageName,
			Position:    i,
		}
	}
	return rows
}

// SaveDraft creates a new draft owned by actorEmployeeID. Branch existence
// is checked (a draft pointing at a deleted branch could never be listed),
// but customer/scheme/locker are NOT — an unverified customer or an inactive
// scheme is a perfectly normal thing to have half-selected, and those rules
// are applied at submission by Create.
func (s *Service) SaveDraft(actorEmployeeID uint, in DraftInput) (*LoanDraft, error) {
	if in.BranchID == 0 {
		return nil, ErrDraftBranchRequired
	}
	if _, err := s.branchRepo.FindByID(in.BranchID); err != nil {
		return nil, ErrBranchInvalid
	}
	d := &LoanDraft{
		CreatedByEmployeeID: actorEmployeeID,
		BranchID:            in.BranchID,
		CustomerID:          in.CustomerID,
		SchemeID:            in.SchemeID,
		LockerID:            in.LockerID,
		PrincipalOverride:   in.PrincipalOverride,
		Ornaments:           in.toOrnamentRows(),
	}
	if err := s.draftRepo.Create(d); err != nil {
		return nil, err
	}
	return s.draftRepo.FindByID(d.ID)
}

// UpdateDraft overwrites an existing draft — what the "Save Draft" button
// does on its second and subsequent presses within the same sitting, so
// repeated saves don't accumulate near-identical drafts. Only the owner may
// update; anyone else gets ErrDraftNotFound.
func (s *Service) UpdateDraft(draftID, actorEmployeeID uint, in DraftInput) (*LoanDraft, error) {
	existing, err := s.getOwnDraft(draftID, actorEmployeeID)
	if err != nil {
		return nil, err
	}
	if in.BranchID == 0 {
		return nil, ErrDraftBranchRequired
	}
	if in.BranchID != existing.BranchID {
		if _, err := s.branchRepo.FindByID(in.BranchID); err != nil {
			return nil, ErrBranchInvalid
		}
	}
	existing.BranchID = in.BranchID
	existing.CustomerID = in.CustomerID
	existing.SchemeID = in.SchemeID
	existing.LockerID = in.LockerID
	existing.PrincipalOverride = in.PrincipalOverride
	existing.Ornaments = in.toOrnamentRows()
	if err := s.draftRepo.Replace(existing); err != nil {
		return nil, err
	}
	return s.draftRepo.FindByID(existing.ID)
}

// ListDrafts returns the caller's own saved drafts, newest-saved first.
func (s *Service) ListDrafts(actorEmployeeID uint, branchScope *uint) ([]LoanDraft, error) {
	return s.draftRepo.FindAllByEmployee(actorEmployeeID, branchScope)
}

// GetDraft returns one of the caller's own drafts, for reopening it in the
// New Gold Loan form.
func (s *Service) GetDraft(draftID, actorEmployeeID uint) (*LoanDraft, error) {
	return s.getOwnDraft(draftID, actorEmployeeID)
}

// DeleteDraft discards a draft — either explicitly ("Discard"), or
// automatically once the loan it became has been created (see
// DeleteDraftQuietly).
func (s *Service) DeleteDraft(draftID, actorEmployeeID uint) error {
	if _, err := s.getOwnDraft(draftID, actorEmployeeID); err != nil {
		return err
	}
	return s.draftRepo.Delete(draftID)
}

// DeleteDraftQuietly discards a draft without reporting failure, used on the
// loan-submission success path: the loan is already created and returned, so
// a lingering draft is untidy rather than wrong, and must not turn a
// successful submission into an error. Mirrors the fail-soft posture Create
// already takes for packet auto-creation and WhatsApp notifications.
func (s *Service) DeleteDraftQuietly(draftID, actorEmployeeID uint) {
	if draftID == 0 {
		return
	}
	if err := s.DeleteDraft(draftID, actorEmployeeID); err != nil {
		log.Printf("loan: could not delete draft %d after submission: %v", draftID, err)
	}
}

// getOwnDraft loads a draft and enforces ownership, collapsing "missing" and
// "someone else's" into the same ErrDraftNotFound.
func (s *Service) getOwnDraft(draftID, actorEmployeeID uint) (*LoanDraft, error) {
	d, err := s.draftRepo.FindByID(draftID)
	if err != nil {
		return nil, ErrDraftNotFound
	}
	if d.CreatedByEmployeeID != actorEmployeeID {
		return nil, ErrDraftNotFound
	}
	return d, nil
}

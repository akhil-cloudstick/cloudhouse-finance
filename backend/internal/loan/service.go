package loan

import (
	"errors"
	"fmt"
	"log"
	"time"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/scheme"
)

// PacketCreator auto-generates a loan's tracking packet right after
// creation ("Packet Generated" immediately follows "Loan Created" per the
// compliance doc's stage list). Implemented by packet.Service, injected as
// a narrow interface so internal/loan doesn't import internal/packet
// directly (packet already depends on loan for its joined display fields,
// so the dependency must stay one-directional).
type PacketCreator interface {
	CreatePacketForLoan(loanID uint) error
}

// PacketMover records the matching packet movement when a loan's gold is
// pledged to / returned from a bank via RecordBankPledge/ReleaseBankPledge.
// Implemented by packet.Service, injected the same way as PacketCreator.
type PacketMover interface {
	RecordBankPledgeMovement(loanID uint, remarks string) error
	RecordBankReleaseMovement(loanID uint, remarks string) error
}

var (
	ErrNotFound            = errors.New("loan not found")
	ErrOrnamentNotFound    = errors.New("ornament not found")
	ErrBranchInvalid       = errors.New("branch does not exist")
	ErrCustomerInvalid     = errors.New("customer does not exist")
	ErrCustomerNotVerified = errors.New("customer must be KYC verified before a loan can be created")
	ErrSchemeInvalid       = errors.New("scheme does not exist")
	ErrNoOrnaments         = errors.New("at least one ornament is required")
	ErrNoGoldRate          = errors.New("no gold rate has been published yet")
	ErrGoldRateNotSetToday = errors.New("today's gold rate has not been set yet — please publish it before creating a loan")
	ErrInvalidPurity       = errors.New("purity must be one of 24K, 22K, 18K")
	ErrInvalidWeight       = errors.New("gross weight must be greater than zero")
	ErrPrincipalTooHigh    = errors.New("principal amount cannot exceed the eligible loan amount")
	ErrInvalidPrincipal    = errors.New("principal amount must be greater than zero")
	ErrInvalidDueDate      = errors.New("due date must be after the opened date")
	ErrWrongStage          = errors.New("approval action does not match the loan's current approval stage")
	ErrAlreadyDecided      = errors.New("loan approval has already reached a terminal state")
	ErrInvalidAction       = errors.New("action must be Approved or Rejected")
	ErrInvalidAmount       = errors.New("amount must be greater than zero")
)

// Service implements loan business rules: ornament valuation, eligible-
// amount calculation, the fixed 3-step approval chain, and the lightweight
// payment/bank-pledge audit trail.
type Service struct {
	repo         *Repository
	ornamentRepo *OrnamentRepository
	approvalRepo *ApprovalRepository
	paymentRepo  *PaymentRepository
	pledgeRepo   *BankPledgeRepository

	branchRepo   *branch.Repository
	customerRepo *customer.Repository
	schemeRepo   *scheme.Repository
	goldRateRepo *goldrate.Repository

	packetCreator PacketCreator
	packetMover   PacketMover
}

func NewService(
	repo *Repository,
	ornamentRepo *OrnamentRepository,
	approvalRepo *ApprovalRepository,
	paymentRepo *PaymentRepository,
	pledgeRepo *BankPledgeRepository,
	branchRepo *branch.Repository,
	customerRepo *customer.Repository,
	schemeRepo *scheme.Repository,
	goldRateRepo *goldrate.Repository,
	packetCreator PacketCreator,
	packetMover PacketMover,
) *Service {
	return &Service{
		repo:          repo,
		ornamentRepo:  ornamentRepo,
		approvalRepo:  approvalRepo,
		paymentRepo:   paymentRepo,
		pledgeRepo:    pledgeRepo,
		branchRepo:    branchRepo,
		customerRepo:  customerRepo,
		schemeRepo:    schemeRepo,
		packetCreator: packetCreator,
		packetMover:   packetMover,
		goldRateRepo:  goldRateRepo,
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
}

// rateForPurity returns the GoldRate field matching an ornament's declared
// purity bucket.
func rateForPurity(gr *goldrate.GoldRate, purity string) (float64, error) {
	switch purity {
	case "24K":
		return gr.K24, nil
	case "22K":
		return gr.K22, nil
	case "18K":
		return gr.K18, nil
	default:
		return 0, ErrInvalidPurity
	}
}

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
		ApprovalStage:    ApprovalStagePendingManager,
		BankPledgeStatus: BankPledgeStatusNotPledged,
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
		if err := s.packetCreator.CreatePacketForLoan(created.ID); err != nil {
			log.Printf("packet auto-creation failed for loan %d: %v", created.ID, err)
		}
	}

	return created, nil
}

func (s *Service) List(f LoanFilter) ([]Loan, error) {
	return s.repo.FindAll(f)
}

func (s *Service) Get(id uint) (*Loan, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
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
	return s.repo.FindByID(l.ID)
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
	if in.TestedPurity != "24K" && in.TestedPurity != "22K" && in.TestedPurity != "18K" {
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

// ApprovalInput mirrors the body of POST /loans/:id/approve.
type ApprovalInput struct {
	Stage           string // "Manager" | "Management" — must match the loan's current ApprovalStage
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	Remarks         string
}

// Approve advances (or terminates) a loan's fixed 3-step sanction chain:
//
//	PendingManager -> PendingManagement -> Approved (Status -> Active)
//
// A Rejected action at any stage closes the loan (Status -> Closed) since
// the doc's status list has no distinct "Rejected" bucket. No employee
// authority-limit check is enforced yet — every step is logged to
// LoanApproval so that check can be added later without a schema change.
func (s *Service) Approve(loanID uint, in ApprovalInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected {
		return nil, ErrInvalidAction
	}
	if l.ApprovalStage == ApprovalStageApproved || l.ApprovalStage == ApprovalStageRejected {
		return nil, ErrAlreadyDecided
	}

	var expectedStage string
	switch l.ApprovalStage {
	case ApprovalStagePendingManager:
		expectedStage = "Manager"
	case ApprovalStagePendingManagement:
		expectedStage = "Management"
	}
	if in.Stage != expectedStage {
		return nil, ErrWrongStage
	}

	audit := &LoanApproval{
		LoanID:          loanID,
		Stage:           in.Stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		Remarks:         in.Remarks,
	}
	if err := s.approvalRepo.Create(audit); err != nil {
		return nil, err
	}

	if in.Action == ApprovalStageRejected {
		l.ApprovalStage = ApprovalStageRejected
		l.Status = StatusClosed
	} else {
		switch l.ApprovalStage {
		case ApprovalStagePendingManager:
			l.ApprovalStage = ApprovalStagePendingManagement
		case ApprovalStagePendingManagement:
			l.ApprovalStage = ApprovalStageApproved
			l.Status = StatusActive
		}
	}

	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	return s.repo.FindByID(l.ID)
}

// PaymentInput mirrors the body of POST /loans/:id/payments.
type PaymentInput struct {
	Amount               float64
	Type                 string
	PaidOn               time.Time
	ReceivedByEmployeeID uint
}

// RecordPayment logs a payment and reduces OutstandingAmount accordingly.
// Interest payments do not reduce OutstandingAmount (they service accrued
// interest, not principal) — Principal/Partial/Full Settlement do.
func (s *Service) RecordPayment(loanID uint, in PaymentInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}

	p := &LoanPayment{
		LoanID:               loanID,
		Amount:               in.Amount,
		Type:                 in.Type,
		PaidOn:               in.PaidOn,
		ReceivedByEmployeeID: in.ReceivedByEmployeeID,
	}
	if err := s.paymentRepo.Create(p); err != nil {
		return nil, err
	}

	if in.Type != "Interest" {
		l.OutstandingAmount -= in.Amount
		if l.OutstandingAmount < 0 {
			l.OutstandingAmount = 0
		}
		if l.OutstandingAmount == 0 && l.Status == StatusActive {
			l.Status = StatusClosed
		}
		if err := s.repo.Update(l); err != nil {
			return nil, err
		}
	}

	return s.repo.FindByID(l.ID)
}

// BankPledgeInput mirrors the body of POST /loans/:id/bank-pledge.
type BankPledgeInput struct {
	BankName      string
	PledgedAmount float64
	PledgeDate    time.Time
}

func (s *Service) RecordBankPledge(loanID uint, in BankPledgeInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.PledgedAmount <= 0 {
		return nil, ErrInvalidAmount
	}

	p := &BankPledgeRecord{
		LoanID:        loanID,
		BankName:      in.BankName,
		PledgedAmount: in.PledgedAmount,
		PledgeDate:    in.PledgeDate,
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

	return s.repo.FindByID(l.ID)
}

// AuctionInput mirrors the body of POST /loans/:id/auction.
type AuctionInput struct {
	AuctionDate   time.Time
	AuctionAmount float64
}

// RecordAuction closes out a loan via auction: stamps AuctionDate/
// AuctionAmount and moves Status to Auctioned. Any loan can be marked
// auctioned regardless of its current status — no state-machine
// enforcement exists yet (mirrors the rest of this service's approach to
// authority checks).
func (s *Service) RecordAuction(loanID uint, in AuctionInput) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if in.AuctionAmount <= 0 {
		return nil, ErrInvalidAmount
	}

	date := in.AuctionDate
	l.AuctionDate = &date
	l.AuctionAmount = &in.AuctionAmount
	l.Status = StatusAuctioned
	l.OutstandingAmount = 0

	if err := s.repo.Update(l); err != nil {
		return nil, err
	}
	return s.repo.FindByID(l.ID)
}

func (s *Service) ReleaseBankPledge(loanID, pledgeID uint) (*Loan, error) {
	l, err := s.repo.FindByID(loanID)
	if err != nil {
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

	return s.repo.FindByID(l.ID)
}

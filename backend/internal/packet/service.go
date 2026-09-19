package packet

import (
	"context"
	"fmt"
	"log"

	"cloudhouse/backend/internal/platform/httpx"
)

var (
	ErrNotFound    = httpx.NewNotFound("packet not found")
	ErrLoanInvalid = httpx.NewBadRequest("loan does not exist")
	// ErrInvalidPacketTransition/ErrLockerFull are state conflicts (the
	// packet's current stage, or the locker's current occupancy, rejects the
	// request) rather than a malformed request — Conflict, not BadRequest.
	ErrInvalidPacketTransition = httpx.NewConflict("invalid packet stage transition")
	ErrLockerRequired          = httpx.NewBadRequest("lockerId is required for this transition")
	ErrLockerInvalid           = httpx.NewBadRequest("locker does not exist or is inactive")
	ErrLockerFull              = httpx.NewConflict("locker is at full capacity")
	// ErrLoanNoLongerMovable guards the manual staff-facing movement
	// endpoint (Handler.RecordMovement) — once a loan's gold has been sold
	// at auction or already released to the customer, nothing about its
	// physical custody is staff's to change by hand any more. NOT enforced
	// inside Service.RecordMovement itself: the automatic internal calls
	// (RecordGoldReleaseMovement/RecordBankPledgeMovement, called from
	// loan.Service right after the loan's own status already flips) must
	// still go through, so this check lives only in the handler, ahead of
	// the manual call.
	ErrLoanNoLongerMovable = httpx.NewConflict("this loan's gold has already left custody — no further packet movement is possible")
)

// LockerCapacityProvider is a narrow read-only dependency satisfied by
// locker.Repository, injected from main.go. internal/packet never imports
// internal/locker directly (only capacity/existence for one lockerId is
// needed here, not the full Locker type), keeping the dependency one-way.
type LockerCapacityProvider interface {
	Capacity(ctx context.Context, lockerID uint) (capacity int, isActive bool, ok bool, err error)
}

// allowedTransitions is the packet stage graph enforced by RecordMovement:
//
//	PacketGenerated -> LockerStored
//	LockerStored    -> BankPledged | Released
//	BankPledged     -> Returned
//	Returned        -> LockerStored | Released
//	Released        (terminal)
//
// StatusReadyForRelease is no longer a step a packet passes through — gold
// goes straight from custody (LockerStored/Returned) to Released — but the
// status value itself stays defined so historic movement rows recorded
// before this change still read correctly.
var allowedTransitions = map[string][]string{
	StatusPacketGenerated: {StatusLockerStored},
	StatusLockerStored:    {StatusBankPledged, StatusReleased},
	StatusBankPledged:     {StatusReturned},
	StatusReturned:        {StatusLockerStored, StatusReleased},
	StatusReadyForRelease: {StatusReleased},
	StatusReleased:        {},
}

func isAllowed(from, to string) bool {
	for _, s := range allowedTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

// Service implements packet business rules: stage-transition validation,
// Code generation, and the loan-creation / bank-pledge integration points
// consumed via the loan.PacketCreator / loan.PacketMover interfaces.
type Service struct {
	repo           *Repository
	lockerCapacity LockerCapacityProvider
}

func NewService(repo *Repository, lockerCapacity LockerCapacityProvider) *Service {
	return &Service{repo: repo, lockerCapacity: lockerCapacity}
}

// Create generates a new tracking packet for a loan: Code = "PKT-%06d"
// (running count), plus the first PacketMovement row. Called automatically
// right after loan.Service.Create() succeeds — see CreatePacketForLoan
// below (the loan.PacketCreator adapter).
//
// If lockerID is non-nil, the packet is checked straight into that locker
// at creation (Status = LockerStored) instead of staff having to do a
// separate manual "check in to locker" step afterward — this is the normal
// path now that New Loan lets staff pick the locker up front. If the
// requested locker turns out to be invalid/inactive/full by the time the
// packet is actually created, that's logged and the packet falls back to
// PacketGenerated (ungrouped) rather than failing loan creation over it —
// staff can still check it in manually later from the Packets page.
func (s *Service) Create(ctx context.Context, loanID uint, lockerID *uint) (*Packet, error) {
	maxSuffix, err := s.repo.MaxCodeSuffix(ctx)
	if err != nil {
		return nil, err
	}
	p := &Packet{
		Code:   fmt.Sprintf("PKT-%06d", maxSuffix+1),
		LoanID: loanID,
		Status: StatusPacketGenerated,
	}

	// TotalGrossWeight/TotalNetWeight start as the sum of the loan's own
	// ornaments — the loan is guaranteed to exist and already carry its
	// ornaments by the time CreatePacketForLoan runs (called right after
	// loan.Service.Create succeeds), so a lookup failure here is logged and
	// left at zero rather than failing packet creation over it; the
	// weights are cosmetic/audit figures, not something the lending flow
	// itself depends on.
	if grossWeight, netWeight, err := s.repo.SumLoanOrnamentWeights(ctx, loanID); err != nil {
		log.Printf("packet: could not sum ornament weights for loan %d at packet creation: %v", loanID, err)
	} else {
		p.TotalGrossWeight = grossWeight
		p.TotalNetWeight = netWeight
	}

	remarks := ""
	if lockerID != nil && *lockerID != 0 {
		if err := s.checkLockerCapacity(ctx, *lockerID); err != nil {
			log.Printf("packet: requested locker %d unavailable at creation for loan %d: %v — packet left ungrouped", *lockerID, loanID, err)
		} else {
			p.Status = StatusLockerStored
			p.CurrentLockerID = lockerID
			remarks = "Locker assigned at packet creation"
		}
	}

	if err := s.repo.Create(ctx, p); err != nil {
		return nil, err
	}
	mv := &PacketMovement{PacketID: p.ID, FromStatus: "", ToStatus: p.Status, LockerID: p.CurrentLockerID, Remarks: remarks}
	if err := s.repo.CreateMovement(ctx, mv); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, p.ID)
}

// CreatePacketForLoan implements loan.PacketCreator — a thin adapter over
// Create that discards the created packet, since loan.Service only cares
// whether packet-auto-creation succeeded (fail-soft: it logs and continues
// on error rather than importing internal/packet's types).
func (s *Service) CreatePacketForLoan(ctx context.Context, loanID uint, lockerID *uint) error {
	_, err := s.Create(ctx, loanID, lockerID)
	return err
}

// checkLockerCapacity is shared by Create (locker-at-creation) and
// RecordMovement (manual check-in) so both enforce the exact same
// active/exists/capacity rules.
func (s *Service) checkLockerCapacity(ctx context.Context, lockerID uint) error {
	capacity, isActive, ok, err := s.lockerCapacity.Capacity(ctx, lockerID)
	if err != nil {
		return err
	}
	if !ok || !isActive {
		return ErrLockerInvalid
	}
	occupied, err := s.repo.CountActivePackets(ctx, lockerID)
	if err != nil {
		return err
	}
	if occupied >= capacity {
		return ErrLockerFull
	}
	return nil
}

func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*Packet, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.Loan.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) GetByCode(ctx context.Context, code string) (*Packet, error) {
	rec, err := s.repo.FindByCode(ctx, code)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) List(ctx context.Context, f Filter) ([]Packet, int64, error) {
	return s.repo.FindAll(ctx, f)
}

func (s *Service) ListMovements(ctx context.Context, packetID uint) ([]PacketMovement, error) {
	if _, err := s.repo.FindByID(ctx, packetID); err != nil {
		return nil, ErrNotFound
	}
	return s.repo.FindMovements(ctx, packetID)
}

// RecordMovement is the single mutating entry point for every stage
// transition: validates the transition graph, enforces locker capacity on
// check-in, updates Packet.Status/CurrentLockerID, and appends the
// PacketMovement audit row.
func (s *Service) RecordMovement(ctx context.Context, packetID uint, toStatus string, lockerID *uint, employeeID uint, remarks string) (*Packet, error) {
	p, err := s.repo.FindByID(ctx, packetID)
	if err != nil {
		return nil, ErrNotFound
	}
	if !isAllowed(p.Status, toStatus) {
		return nil, ErrInvalidPacketTransition
	}

	if toStatus == StatusLockerStored {
		if lockerID == nil || *lockerID == 0 {
			return nil, ErrLockerRequired
		}
		if err := s.checkLockerCapacity(ctx, *lockerID); err != nil {
			return nil, err
		}
	}

	fromStatus := p.Status
	p.Status = toStatus
	if toStatus == StatusLockerStored {
		p.CurrentLockerID = lockerID
	} else {
		p.CurrentLockerID = nil
	}
	if err := s.repo.Update(ctx, p); err != nil {
		return nil, err
	}

	mv := &PacketMovement{
		PacketID:        p.ID,
		FromStatus:      fromStatus,
		ToStatus:        toStatus,
		LockerID:        lockerID,
		ActorEmployeeID: employeeID,
		Remarks:         remarks,
	}
	if err := s.repo.CreateMovement(ctx, mv); err != nil {
		return nil, err
	}

	return s.repo.FindByID(ctx, p.ID)
}

// RecordBankPledgeMovement / RecordBankReleaseMovement implement
// loan.PacketMover — called by loan.Service.RecordBankPledge /
// ReleaseBankPledge right after their own loan-level state change
// succeeds. loan.Service logs and continues on any error these return
// (packet tracking is an enrichment, not a hard lending-flow dependency).
func (s *Service) RecordBankPledgeMovement(ctx context.Context, loanID uint, remarks string) error {
	p, err := s.repo.FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}
	if !isAllowed(p.Status, StatusBankPledged) {
		return ErrInvalidPacketTransition
	}
	_, err = s.RecordMovement(ctx, p.ID, StatusBankPledged, nil, 0, remarks)
	return err
}

func (s *Service) RecordBankReleaseMovement(ctx context.Context, loanID uint, remarks string) error {
	p, err := s.repo.FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}
	if !isAllowed(p.Status, StatusReturned) {
		return ErrInvalidPacketTransition
	}
	_, err = s.RecordMovement(ctx, p.ID, StatusReturned, nil, 0, remarks)
	return err
}

// RecordGoldReleaseMovement implements loan.PacketMover — called by
// loan.Service.CompleteRelease once every release gate (settlement paid,
// bank pledge released, approval chain complete) has passed. Moves the
// packet straight from its current custody status to the terminal Released
// state — there is no intermediate "Ready For Release" step to pass
// through first.
func (s *Service) RecordGoldReleaseMovement(ctx context.Context, loanID uint, remarks string) error {
	p, err := s.repo.FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}
	if p.Status != StatusReleased && !isAllowed(p.Status, StatusReleased) {
		return ErrInvalidPacketTransition
	}
	_, err = s.RecordMovement(ctx, p.ID, StatusReleased, nil, 0, remarks)
	return err
}

// RecordPartialGoldReleaseMovement implements loan.PacketMover's partial
// counterpart to RecordGoldReleaseMovement — called by
// loan.Service.CompleteRelease for a Partial Ornament Release, once only
// SOME of the loan's ornaments are being handed back and the rest stay
// physically in this packet.
//
// Unlike a full release, this deliberately does NOT drive any stage
// transition (FromStatus == ToStatus == the packet's current status): the
// packet is loan-scoped, not ornament-scoped, and it still holds real gold
// in the same locker/bank-pledge state it was already in, so nothing about
// its own custody stage has changed. The movement row exists purely as an
// audit remark ("which ornaments came out, how much weight left") — see
// RecordMovement's normal FromStatus != ToStatus rows for the stage-change
// case this is not.
//
// The weight decrement is the operative effect: without it, a packet's own
// TotalGrossWeight/TotalNetWeight would silently drift away from what the
// locker physically still holds every time a partial release happened,
// which defeats the reason those columns exist in the first place (see
// Packet.TotalGrossWeight's doc comment).
func (s *Service) RecordPartialGoldReleaseMovement(ctx context.Context, loanID uint, releasedGrossWeight, releasedNetWeight float64, remarks string) error {
	p, err := s.repo.FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}

	p.TotalGrossWeight -= releasedGrossWeight
	p.TotalNetWeight -= releasedNetWeight
	if p.TotalGrossWeight < 0 {
		p.TotalGrossWeight = 0
	}
	if p.TotalNetWeight < 0 {
		p.TotalNetWeight = 0
	}
	if err := s.repo.Update(ctx, p); err != nil {
		return err
	}

	mv := &PacketMovement{
		PacketID:   p.ID,
		FromStatus: p.Status,
		ToStatus:   p.Status,
		Remarks:    remarks,
	}
	return s.repo.CreateMovement(ctx, mv)
}

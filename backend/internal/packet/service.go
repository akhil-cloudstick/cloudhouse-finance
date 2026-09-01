package packet

import (
	"fmt"
	"log"

	"ambikagold/backend/internal/platform/httpx"
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
	Capacity(lockerID uint) (capacity int, isActive bool, ok bool, err error)
}

// allowedTransitions is the packet stage graph enforced by RecordMovement:
//
//	PacketGenerated -> LockerStored
//	LockerStored    -> BankPledged | ReadyForRelease
//	BankPledged     -> Returned
//	Returned        -> LockerStored | ReadyForRelease
//	ReadyForRelease -> Released (terminal)
var allowedTransitions = map[string][]string{
	StatusPacketGenerated: {StatusLockerStored},
	StatusLockerStored:    {StatusBankPledged, StatusReadyForRelease},
	StatusBankPledged:     {StatusReturned},
	StatusReturned:        {StatusLockerStored, StatusReadyForRelease},
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
func (s *Service) Create(loanID uint, lockerID *uint) (*Packet, error) {
	count, err := s.repo.CountAll()
	if err != nil {
		return nil, err
	}
	p := &Packet{
		Code:   fmt.Sprintf("PKT-%06d", count+1),
		LoanID: loanID,
		Status: StatusPacketGenerated,
	}

	remarks := ""
	if lockerID != nil && *lockerID != 0 {
		if err := s.checkLockerCapacity(*lockerID); err != nil {
			log.Printf("packet: requested locker %d unavailable at creation for loan %d: %v — packet left ungrouped", *lockerID, loanID, err)
		} else {
			p.Status = StatusLockerStored
			p.CurrentLockerID = lockerID
			remarks = "Locker assigned at packet creation"
		}
	}

	if err := s.repo.Create(p); err != nil {
		return nil, err
	}
	mv := &PacketMovement{PacketID: p.ID, FromStatus: "", ToStatus: p.Status, LockerID: p.CurrentLockerID, Remarks: remarks}
	if err := s.repo.CreateMovement(mv); err != nil {
		return nil, err
	}
	return s.repo.FindByID(p.ID)
}

// CreatePacketForLoan implements loan.PacketCreator — a thin adapter over
// Create that discards the created packet, since loan.Service only cares
// whether packet-auto-creation succeeded (fail-soft: it logs and continues
// on error rather than importing internal/packet's types).
func (s *Service) CreatePacketForLoan(loanID uint, lockerID *uint) error {
	_, err := s.Create(loanID, lockerID)
	return err
}

// checkLockerCapacity is shared by Create (locker-at-creation) and
// RecordMovement (manual check-in) so both enforce the exact same
// active/exists/capacity rules.
func (s *Service) checkLockerCapacity(lockerID uint) error {
	capacity, isActive, ok, err := s.lockerCapacity.Capacity(lockerID)
	if err != nil {
		return err
	}
	if !ok || !isActive {
		return ErrLockerInvalid
	}
	occupied, err := s.repo.CountActivePackets(lockerID)
	if err != nil {
		return err
	}
	if occupied >= capacity {
		return ErrLockerFull
	}
	return nil
}

func (s *Service) Get(id uint, branchID *uint) (*Packet, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.Loan.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) GetByCode(code string) (*Packet, error) {
	rec, err := s.repo.FindByCode(code)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) List(f Filter) ([]Packet, error) {
	return s.repo.FindAll(f)
}

func (s *Service) ListMovements(packetID uint) ([]PacketMovement, error) {
	if _, err := s.repo.FindByID(packetID); err != nil {
		return nil, ErrNotFound
	}
	return s.repo.FindMovements(packetID)
}

// RecordMovement is the single mutating entry point for every stage
// transition: validates the transition graph, enforces locker capacity on
// check-in, updates Packet.Status/CurrentLockerID, and appends the
// PacketMovement audit row.
func (s *Service) RecordMovement(packetID uint, toStatus string, lockerID *uint, employeeID uint, remarks string) (*Packet, error) {
	p, err := s.repo.FindByID(packetID)
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
		if err := s.checkLockerCapacity(*lockerID); err != nil {
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
	if err := s.repo.Update(p); err != nil {
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
	if err := s.repo.CreateMovement(mv); err != nil {
		return nil, err
	}

	return s.repo.FindByID(p.ID)
}

// RecordBankPledgeMovement / RecordBankReleaseMovement implement
// loan.PacketMover — called by loan.Service.RecordBankPledge /
// ReleaseBankPledge right after their own loan-level state change
// succeeds. loan.Service logs and continues on any error these return
// (packet tracking is an enrichment, not a hard lending-flow dependency).
func (s *Service) RecordBankPledgeMovement(loanID uint, remarks string) error {
	p, err := s.repo.FindActiveByLoanID(loanID)
	if err != nil {
		return err
	}
	if !isAllowed(p.Status, StatusBankPledged) {
		return ErrInvalidPacketTransition
	}
	_, err = s.RecordMovement(p.ID, StatusBankPledged, nil, 0, remarks)
	return err
}

func (s *Service) RecordBankReleaseMovement(loanID uint, remarks string) error {
	p, err := s.repo.FindActiveByLoanID(loanID)
	if err != nil {
		return err
	}
	if !isAllowed(p.Status, StatusReturned) {
		return ErrInvalidPacketTransition
	}
	_, err = s.RecordMovement(p.ID, StatusReturned, nil, 0, remarks)
	return err
}

// RecordGoldReleaseMovement implements loan.PacketMover — called by
// loan.Service.CompleteRelease once every release gate (settlement paid,
// bank pledge released, approval chain complete) has passed. Routes the
// packet through ReadyForRelease first if it isn't already there (both
// LockerStored and Returned allow that edge), then to the terminal
// Released state.
func (s *Service) RecordGoldReleaseMovement(loanID uint, remarks string) error {
	p, err := s.repo.FindActiveByLoanID(loanID)
	if err != nil {
		return err
	}
	if p.Status != StatusReadyForRelease {
		if !isAllowed(p.Status, StatusReadyForRelease) {
			return ErrInvalidPacketTransition
		}
		if _, err := s.RecordMovement(p.ID, StatusReadyForRelease, nil, 0, remarks); err != nil {
			return err
		}
		p, err = s.repo.FindByID(p.ID)
		if err != nil {
			return err
		}
	}
	_, err = s.RecordMovement(p.ID, StatusReleased, nil, 0, remarks)
	return err
}

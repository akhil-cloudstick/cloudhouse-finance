package packet

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound                = errors.New("packet not found")
	ErrLoanInvalid             = errors.New("loan does not exist")
	ErrInvalidPacketTransition = errors.New("invalid packet stage transition")
	ErrLockerRequired          = errors.New("lockerId is required for this transition")
	ErrLockerInvalid           = errors.New("locker does not exist or is inactive")
	ErrLockerFull              = errors.New("locker is at full capacity")
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
// (running count), Status = PacketGenerated, plus the first PacketMovement
// row. Called automatically right after loan.Service.Create() succeeds —
// see CreatePacketForLoan below (the loan.PacketCreator adapter).
func (s *Service) Create(loanID uint) (*Packet, error) {
	count, err := s.repo.CountAll()
	if err != nil {
		return nil, err
	}
	p := &Packet{
		Code:   fmt.Sprintf("PKT-%06d", count+1),
		LoanID: loanID,
		Status: StatusPacketGenerated,
	}
	if err := s.repo.Create(p); err != nil {
		return nil, err
	}
	mv := &PacketMovement{PacketID: p.ID, FromStatus: "", ToStatus: StatusPacketGenerated}
	if err := s.repo.CreateMovement(mv); err != nil {
		return nil, err
	}
	return s.repo.FindByID(p.ID)
}

// CreatePacketForLoan implements loan.PacketCreator — a thin adapter over
// Create that discards the created packet, since loan.Service only cares
// whether packet-auto-creation succeeded (fail-soft: it logs and continues
// on error rather than importing internal/packet's types).
func (s *Service) CreatePacketForLoan(loanID uint) error {
	_, err := s.Create(loanID)
	return err
}

func (s *Service) Get(id uint) (*Packet, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
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
		capacity, isActive, ok, err := s.lockerCapacity.Capacity(*lockerID)
		if err != nil {
			return nil, err
		}
		if !ok || !isActive {
			return nil, ErrLockerInvalid
		}
		occupied, err := s.repo.CountActivePackets(*lockerID)
		if err != nil {
			return nil, err
		}
		if occupied >= capacity {
			return nil, ErrLockerFull
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

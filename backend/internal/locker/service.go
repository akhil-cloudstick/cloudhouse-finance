package locker

import (
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/platform/httpx"
	"context"
)

var (
	ErrNotFound        = httpx.NewNotFound("locker not found")
	ErrCodeRequired    = httpx.NewBadRequest("code is required")
	ErrDuplicateCode   = httpx.NewConflict("a locker with this code already exists")
	ErrBranchInvalid   = httpx.NewBadRequest("branch does not exist")
	ErrInvalidCapacity = httpx.NewBadRequest("capacity must be greater than zero")
	ErrInUse           = httpx.NewConflict("locker cannot be removed while it still holds packets")
)

// PacketCounter is a narrow interface satisfied by packet.Repository,
// injected at the main.go wiring level (built after internal/packet
// exists) so internal/locker never imports internal/packet directly — see
// this package's doc comment for the full cycle-avoidance rationale.
type PacketCounter interface {
	CountActivePackets(ctx context.Context, lockerID uint) (int, error)
}

// CreateInput / UpdateInput mirror the fields an admin supplies via the
// "Add Locker" form (LockerModal.tsx).
type CreateInput struct {
	Code     string
	BranchID uint
	Capacity int
}

type UpdateInput struct {
	Code     string
	BranchID uint
	Capacity int
	IsActive bool
}

// View wraps a Locker with its derived occupancy (never stored — computed
// via the injected PacketCounter on every read).
type View struct {
	Locker
	Occupied int `json:"occupied"`
}

// Service implements locker business rules on top of the Repository.
type Service struct {
	repo          *Repository
	branchRepo    *branch.Repository
	packetCounter PacketCounter
}

func NewService(repo *Repository, branchRepo *branch.Repository, packetCounter PacketCounter) *Service {
	return &Service{repo: repo, branchRepo: branchRepo, packetCounter: packetCounter}
}

func (s *Service) validate(ctx context.Context, code string, branchID uint, capacity int) error {
	if code == "" {
		return ErrCodeRequired
	}
	if capacity <= 0 {
		return ErrInvalidCapacity
	}
	ok, err := s.branchRepo.Exists(ctx, branchID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrBranchInvalid
	}
	return nil
}

func (s *Service) toView(ctx context.Context, l Locker) (View, error) {
	occupied, err := s.packetCounter.CountActivePackets(ctx, l.ID)
	if err != nil {
		return View{}, err
	}
	return View{Locker: l, Occupied: occupied}, nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*View, error) {
	if err := s.validate(ctx, in.Code, in.BranchID, in.Capacity); err != nil {
		return nil, err
	}
	if existing, _ := s.repo.FindByCode(ctx, in.Code); existing != nil {
		return nil, ErrDuplicateCode
	}
	rec := &Locker{
		Code:     in.Code,
		BranchID: in.BranchID,
		Capacity: in.Capacity,
		IsActive: true,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	full, err := s.repo.FindByID(ctx, rec.ID)
	if err != nil {
		return nil, err
	}
	v, err := s.toView(ctx, *full)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// List returns lockers, optionally scoped to branchID (nil = all branches —
// Administrator only, see platform.GetBranchScope).
func (s *Service) List(ctx context.Context, branchID *uint) ([]View, error) {
	views, _, err := s.Find(ctx, LockerFilter{BranchID: branchID})
	return views, err
}

// Find is List's filtered/paginated superset — backs the packet Check-In
// picker's search box (SearchableSelect), same q/limit/offset shape as
// packet.Filter/loan.LoanFilter. Returns the TOTAL row count for f's
// filters (0 when f.Limit <= 0).
func (s *Service) Find(ctx context.Context, f LockerFilter) ([]View, int64, error) {
	lockers, total, err := s.repo.Find(ctx, f)
	if err != nil {
		return nil, 0, err
		return nil, 0, err
	}
	views := make([]View, 0, len(lockers))
	for _, l := range lockers {
		v, err := s.toView(ctx, l)
		if err != nil {
			return nil, 0, err
		}
		views = append(views, v)
	}
	return views, total, nil
}

// Get returns the locker by id, or ErrNotFound if it doesn't exist OR (when
// branchID is non-nil) belongs to a different branch — a non-admin gets the
// same "not found" for another branch's locker as for a genuinely missing
// id, so branch existence is never leaked.
func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*View, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	v, err := s.toView(ctx, *rec)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// Update applies in to the locker identified by id. branchID (nil for
// Administrator) must match the locker's current branch or ErrNotFound is
// returned before any other validation runs, same not-found-on-mismatch
// guard as Get.
func (s *Service) Update(ctx context.Context, id uint, in UpdateInput, branchID *uint) (*View, error) {
	if err := s.validate(ctx, in.Code, in.BranchID, in.Capacity); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if existing, _ := s.repo.FindByCode(ctx, in.Code); existing != nil && existing.ID != id {
		return nil, ErrDuplicateCode
	}

	rec.Code = in.Code
	rec.BranchID = in.BranchID
	rec.Capacity = in.Capacity
	rec.IsActive = in.IsActive

	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	full, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	v, err := s.toView(ctx, *full)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// Delete removes a locker outright, guarded against removing one that
// still physically holds packets.
func (s *Service) Delete(ctx context.Context, id uint, branchID *uint) error {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return ErrNotFound
	}
	occupied, err := s.packetCounter.CountActivePackets(ctx, rec.ID)
	if err != nil {
		return err
	}
	if occupied > 0 {
		return ErrInUse
	}
	return s.repo.Delete(ctx, id)
}

package branch

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/auditlog"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
)

var (
	ErrNotFound      = httpx.NewNotFound("branch not found")
	ErrNameRequired  = httpx.NewBadRequest("name is required")
	ErrAddressReq    = httpx.NewBadRequest("address is required")
	ErrDuplicateName = httpx.NewConflict("a branch with this name already exists")
	ErrInUse         = httpx.NewConflict("branch cannot be deactivated while it still has linked employees, expenses, cash movements, or customers")
)

// CreateInput / UpdateInput mirror the fields an admin supplies via the
// "Add Branch" form (BranchModal.tsx).
type CreateInput struct {
	Name    string
	Code    string
	Address string
	Phone   string
}

type UpdateInput struct {
	Name     string
	Code     string
	Address  string
	Phone    string
	IsActive bool
}

// Service implements branch business rules on top of the Repository.
type Service struct {
	repo       *Repository
	tenantRepo *tenant.Repository
	auditRepo  *auditlog.Repository
}

func NewService(repo *Repository, tenantRepo *tenant.Repository, auditRepo *auditlog.Repository) *Service {
	return &Service{repo: repo, tenantRepo: tenantRepo, auditRepo: auditRepo}
}

func validate(name, address string) error {
	if name == "" {
		return ErrNameRequired
	}
	if address == "" {
		return ErrAddressReq
	}
	return nil
}

// actor identifies who is making a write, for the audit log — branch has no
// access to employee records (employee already imports branch, so the
// reverse would be a cycle), so unlike employee.Service's logAudit this
// cannot resolve a display name. label is the caller's role name
// (platform.ActorFromContext's second return value) instead — still
// identifies who acted, just by role rather than by their own name.
type actor struct {
	employeeID uint
	label      string
}

func (s *Service) logAudit(ctx context.Context, a actor, action string, entityID uint, entityName, detail string) {
	if a.employeeID == 0 || s.auditRepo == nil {
		return
	}
	name := a.label
	if name == "" {
		name = "unknown"
	}
	s.auditRepo.Log(ctx, a.employeeID, name, action, "branch", entityID, entityName, detail)
}

func (s *Service) Create(ctx context.Context, in CreateInput, by actor) (*Branch, error) {
	if err := validate(in.Name, in.Address); err != nil {
		return nil, err
	}
	if existing, _ := s.repo.FindByName(ctx, in.Name); existing != nil {
		return nil, ErrDuplicateName
	}

	rec := &Branch{
		Name:     in.Name,
		Code:     in.Code,
		Address:  in.Address,
		Phone:    in.Phone,
		IsActive: true,
	}
	if err := s.reserveAndCreate(ctx, rec); err != nil {
		return nil, err
	}
	s.logAudit(ctx, by, auditlog.ActionBranchCreated, rec.ID, rec.Name, "code="+rec.Code)
	return rec, nil
}

// reserveAndCreate enforces the tenant's tier quota and inserts rec inside
// the same transaction — see tenant.Repository.ReserveBranchSlot for why the
// two cannot be split into a separate check-then-create.
//
// Falls back to a plain create when no tenant is in context at all. That is
// not a quota bypass: branches is tenant-scoped, so the ordinary insert path
// hits the automatic tenant filter's own stamp callback, which raises
// platform.ErrNoTenantInContext rather than inserting unfiltered — the same
// safe failure every other tenant-scoped write already has. This only
// matters for a caller that genuinely established no tenant, which is a bug
// upstream of this method, not a case this method needs to police itself.
func (s *Service) reserveAndCreate(ctx context.Context, rec *Branch) error {
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok || s.tenantRepo == nil {
		return s.repo.Create(ctx, rec)
	}
	return s.tenantRepo.ReserveBranchSlot(ctx, tenantID, func(tx *gorm.DB) error {
		return s.repo.CreateTx(tx, rec)
	})
}

// ErrNoTenant is returned by Usage when the request carries no business.
var ErrNoTenant = httpx.NewUnauthorized("no business in session")

// Usage reports the caller's plan and active-branch count, for the Branches
// page's "1 of 1 used" line. The tenant comes only from the session context,
// never from the request — there is no parameter to point it elsewhere.
func (s *Service) Usage(ctx context.Context) (*tenant.BranchUsage, error) {
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok || s.tenantRepo == nil {
		return nil, ErrNoTenant
	}
	return s.tenantRepo.BranchUsage(ctx, tenantID)
}

// List returns branches, optionally scoped to a single branchID (nil = all,
// used for Administrator).
func (s *Service) List(ctx context.Context, branchID *uint) ([]Branch, error) {
	return s.repo.FindAll(ctx, branchID)
}

// Find is List's filtered/paginated superset (GET /branches?q=&limit=).
func (s *Service) Find(ctx context.Context, f Filter) ([]Branch, int64, error) {
	return s.repo.Find(ctx, f)
}

func (s *Service) Get(ctx context.Context, id uint) (*Branch, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) Update(ctx context.Context, id uint, in UpdateInput, by actor) (*Branch, error) {
	if err := validate(in.Name, in.Address); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if existing, _ := s.repo.FindByName(ctx, in.Name); existing != nil && existing.ID != id {
		return nil, ErrDuplicateName
	}

	// A branch coming back into service is the other path back over the
	// tenant's quota — creation is not the only door, and it is the door
	// people forget. Only THIS transition needs the quota check: the branch
	// already exists and already holds a slot while it stays active or
	// stays inactive, so neither "still active" nor "still inactive" changes
	// how many active branches the tenant has.
	reactivating := !rec.IsActive && in.IsActive
	wasActive := rec.IsActive

	rec.Name = in.Name
	rec.Code = in.Code
	rec.Address = in.Address
	rec.Phone = in.Phone
	rec.IsActive = in.IsActive

	detail := fmt.Sprintf("name=%s active=%v", rec.Name, rec.IsActive)
	if reactivating {
		if err := s.reserveAndUpdate(ctx, rec); err != nil {
			return nil, err
		}
		s.logAudit(ctx, by, auditlog.ActionBranchUpdated, rec.ID, rec.Name, detail)
		return rec, nil
	}
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	action := auditlog.ActionBranchUpdated
	if wasActive && !rec.IsActive {
		action = auditlog.ActionBranchDeactivated
	}
	s.logAudit(ctx, by, action, rec.ID, rec.Name, detail)
	return rec, nil
}

// reserveAndUpdate is reserveAndCreate's counterpart for reactivating an
// existing branch — same quota check, same "check and write in one
// transaction" reasoning, saving rec instead of inserting it.
func (s *Service) reserveAndUpdate(ctx context.Context, rec *Branch) error {
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok || s.tenantRepo == nil {
		return s.repo.Update(ctx, rec)
	}
	return s.tenantRepo.ReserveBranchSlot(ctx, tenantID, func(tx *gorm.DB) error {
		return s.repo.UpdateTx(tx, rec)
	})
}

// Deactivate soft-disables a branch rather than hard-deleting it, so
// historical records referencing it (employees, expenses, cash movements)
// keep a valid BranchID.
func (s *Service) Deactivate(ctx context.Context, id uint, by actor) (*Branch, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	refs, err := s.repo.CountReferences(ctx, id)
	if err != nil {
		return nil, err
	}
	if refs > 0 {
		return nil, ErrInUse
	}
	rec.IsActive = false
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	s.logAudit(ctx, by, auditlog.ActionBranchDeactivated, rec.ID, rec.Name, "")
	return rec, nil
}

// ListSwitchable returns the branches the caller may switch the app's view
// between — every active branch of their own business for a cross-branch role
// (Administrator, Management), and only their own branch for everyone else.
//
// It exists because the ordinary List is itself branch-scoped, which is
// correct for a branch list but wrong for a branch SWITCHER: once a selection
// is active, List returns just that one branch, and a switcher built on it
// would show a single option and leave the user with no way back to the
// others. Asking a different question needs a different endpoint, not a
// special case threaded through the scoped one.
//
// Isolation is unchanged: the query carries the tenant predicate from the
// session like every other, so "every branch" means every branch of the
// caller's own business and can never mean anyone else's.
func (s *Service) ListSwitchable(ctx context.Context, crossBranch bool, ownBranchID uint) ([]Branch, error) {
	if crossBranch {
		return s.repo.FindAll(ctx, nil)
	}
	own := ownBranchID
	return s.repo.FindAll(ctx, &own)
}

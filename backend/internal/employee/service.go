package employee

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"cloudhouse/backend/internal/auditlog"
	"cloudhouse/backend/internal/authz"
	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform/httpx"
)

var (
	ErrNotFound      = httpx.NewNotFound("employee not found")
	ErrNameRequired  = httpx.NewBadRequest("name is required")
	ErrRoleRequired  = httpx.NewBadRequest("role is required")
	ErrInvalidRole   = httpx.NewBadRequest("role must be one of the predefined roles")
	ErrBranchReq     = httpx.NewBadRequest("branch is required")
	ErrBranchInvalid = httpx.NewBadRequest("branch does not exist")
	ErrPhoneInvalid  = httpx.NewBadRequest("phone must be a 10-digit number")
	// ErrPhoneTaken is returned when an employee's phone number is already
	// used by a different employee — phone doubles as a login identifier
	// (see internal/auth), so it must be unique across employees.
	ErrPhoneTaken = httpx.NewConflict("phone number is already in use by another employee")
	// ErrEmailTaken is returned when updating an employee's email to one
	// already used by a different employee.
	ErrEmailTaken = httpx.NewConflict("email is already in use by another employee")
	// ErrEmailInvalid guards against obviously malformed email input.
	ErrEmailInvalid = httpx.NewBadRequest("email is invalid")
	// ErrUsernameTaken is returned when setting an employee's username to
	// one already used by a different employee (see internal/auth for
	// login, which relies on username uniqueness).
	ErrUsernameTaken = httpx.NewConflict("username is already in use by another employee")
	// ErrUsernameInvalid guards against blank/too-short/invalid-character
	// usernames.
	ErrUsernameInvalid = httpx.NewBadRequest("username must be at least 3 characters and contain only letters, numbers, dots, underscores or hyphens")
	// ErrPasswordTooShort mirrors a minimal password-strength rule.
	ErrPasswordTooShort = httpx.NewBadRequest("password must be at least 8 characters")
)

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{3,60}$`)

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// ValidRoles is the canonical role whitelist. Keep this list IDENTICAL to
// the `ROLES` constant in frontend/components/modals/EmployeeModal.tsx —
// there is no shared codegen between the two, so any edit to either list
// must be mirrored in the other.
var ValidRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
	"Accountant", "Collection Staff", "Auction Administrator", "Auditor",
}

func isValidRole(role string) bool {
	for _, r := range ValidRoles {
		if r == role {
			return true
		}
	}
	return false
}

// phoneRe mirrors the 10-digit numeric rule used by
// frontend/components/modals/BranchModal.tsx (BranchModal's `PHONE_RE`) —
// the employee/branch phone fields share the same simple 10-digit
// convention. (Note: the Customer domain only enforces phone as
// non-empty/required and does not apply a format regex, so it is not the
// pattern mirrored here.)
var phoneRe = regexp.MustCompile(`^\d{10}$`)

func validatePhone(phone string) error {
	if phone == "" {
		return nil
	}
	if !phoneRe.MatchString(phone) {
		return ErrPhoneInvalid
	}
	return nil
}

// CreateInput / UpdateInput mirror the fields an admin supplies via the
// "Add Employee" form (EmployeeModal.tsx). Performance counters
// (LoansProcessed/Collections/Followups/Pending) start at zero for a new
// employee and are adjusted by other domains (loans, ledger) once those
// exist — not settable directly on create.
type CreateInput struct {
	Name     string
	Role     string
	BranchID uint
	Phone    string
	// Username/Password optionally set up login credentials right at
	// creation time (both must be given together, or both left blank —
	// see validateCreate). Leave both blank to add the employee without
	// login access yet (an Administrator can set them later via Update).
	Username string
	Password string
}

// UpdateInput additionally allows adjusting the performance counters,
// since an admin may need to correct them directly until the owning
// domains (loans/ledger) are wired up to update them automatically.
type UpdateInput struct {
	Name           string
	Role           string
	BranchID       uint
	Phone          string
	LoansProcessed int
	Collections    float64
	Followups      int
	Pending        int
	// Username/Password are optional — enables an Administrator to set up
	// login credentials for an employee via the existing update endpoint
	// (see internal/auth for the login flow, which accepts Username or
	// Phone). Leave both empty to leave existing credentials untouched.
	// Email is still accepted/stored but no longer used for login.
	Username string
	Email    string
	Password string
}

// Service implements employee business rules on top of the Repository.
type Service struct {
	repo       *Repository
	branchRepo *branch.Repository
	authzRepo  *authz.Repository
	auditRepo  *auditlog.Repository
}

func NewService(repo *Repository, branchRepo *branch.Repository, authzRepo *authz.Repository, auditRepo *auditlog.Repository) *Service {
	return &Service{repo: repo, branchRepo: branchRepo, authzRepo: authzRepo, auditRepo: auditRepo}
}

// logAudit resolves the acting employee's CURRENT name (not from a claim
// that might be stale — see platform.EmployeeSessionChecker's reasoning for
// why current data is worth one extra lookup on a write path) and records
// the action. actorEmployeeID of 0 means no caller identity was available
// (a background job, say) and is skipped rather than logged as employee 0.
func (s *Service) logAudit(ctx context.Context, actorEmployeeID uint, action string, entityID uint, entityName, detail string) {
	if actorEmployeeID == 0 || s.auditRepo == nil {
		return
	}
	actorName := "unknown"
	if actor, err := s.repo.FindByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	s.auditRepo.Log(ctx, actorEmployeeID, actorName, action, "employee", entityID, entityName, detail)
}

// resolveRoleID looks up the id behind a role NAME, scoped to the caller's
// own tenant via ctx.
//
// FOUND AND FIXED 2026-08-29, while proving Step 8b's role-change
// invalidation actually works: neither Create nor Update ever set RoleID at
// all — only the free-text Role name. RoleID is the field RequirePermission
// actually authorizes against, so an employee's real permissions never
// reflected their assigned role at all, for either a brand new employee or
// one whose role was later changed, until the NEXT migrate.Run backfill
// (internal/migrate.backfillEmployeeRoleID) happened to run and recompute it
// — i.e. the next server restart, not "eventually" in any bounded sense a
// user could rely on. Both callers below now set it directly, so a role
// takes effect on the very same write that assigns it.
func (s *Service) resolveRoleID(ctx context.Context, roleName string) (uint, error) {
	id, err := s.authzRepo.RoleIDByName(ctx, roleName)
	if err != nil {
		return 0, ErrInvalidRole
	}
	return id, nil
}

func validateCreate(in CreateInput) error {
	if in.Name == "" {
		return ErrNameRequired
	}
	if in.Role == "" {
		return ErrRoleRequired
	}
	if !isValidRole(in.Role) {
		return ErrInvalidRole
	}
	if in.BranchID == 0 {
		return ErrBranchReq
	}
	if err := validatePhone(in.Phone); err != nil {
		return err
	}
	if in.Username != "" && !usernameRe.MatchString(in.Username) {
		return ErrUsernameInvalid
	}
	if in.Password != "" && len(in.Password) < 8 {
		return ErrPasswordTooShort
	}
	return nil
}

func (s *Service) checkBranch(ctx context.Context, id uint) error {
	ok, err := s.branchRepo.Exists(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return ErrBranchInvalid
	}
	return nil
}

// checkPhoneUnique reports ErrPhoneTaken if phone is non-blank and already
// used by a different employee (excludeID — 0 when creating). Phone is a
// login identifier (see internal/auth), so it must stay unique.
func (s *Service) checkPhoneUnique(ctx context.Context, phone string, excludeID uint) error {
	if phone == "" {
		return nil
	}
	existing, err := s.repo.FindByPhone(ctx, phone)
	if err == nil && existing.ID != excludeID {
		return ErrPhoneTaken
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

// checkUsernameUnique mirrors checkPhoneUnique for Username.
func (s *Service) checkUsernameUnique(ctx context.Context, username string, excludeID uint) error {
	if username == "" {
		return nil
	}
	existing, err := s.repo.FindByUsername(ctx, username)
	if err == nil && existing.ID != excludeID {
		return ErrUsernameTaken
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func (s *Service) Create(ctx context.Context, in CreateInput, actorEmployeeID uint) (*Employee, error) {
	if err := validateCreate(in); err != nil {
		return nil, err
	}
	if err := s.checkBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	if err := s.checkPhoneUnique(ctx, in.Phone, 0); err != nil {
		return nil, err
	}
	if err := s.checkUsernameUnique(ctx, in.Username, 0); err != nil {
		return nil, err
	}

	count, err := s.repo.CountAll(ctx)
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("EMP-%02d", count+1)

	roleID, err := s.resolveRoleID(ctx, in.Role)
	if err != nil {
		return nil, err
	}

	rec := &Employee{
		Code:     code,
		Name:     in.Name,
		Role:     in.Role,
		RoleID:   roleID,
		BranchID: in.BranchID,
		Phone:    in.Phone,
		Username: in.Username,
	}
	if in.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost+2)
		if err != nil {
			return nil, err
		}
		rec.PasswordHash = string(hash)
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	s.logAudit(ctx, actorEmployeeID, auditlog.ActionEmployeeCreated, rec.ID, rec.Name, "role="+rec.Role)
	return s.repo.FindByID(ctx, rec.ID)
}

// List returns employees, optionally scoped to branchID (nil = all
// branches — Administrator only, see platform.GetBranchScope).
func (s *Service) List(ctx context.Context, branchID *uint, search string, limit, offset int) ([]Employee, int64, error) {
	return s.repo.FindAll(ctx, branchID, search, limit, offset)
}

// Get returns the employee by id, or ErrNotFound if it doesn't exist OR
// (when branchID is non-nil) belongs to a different branch — a non-admin
// gets the same "not found" for another branch's employee as for a
// genuinely missing id, so branch existence is never leaked.
func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*Employee, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return rec, nil
}

// Update applies in to the employee identified by id. branchID (nil for
// Administrator) must match the employee's current branch or ErrNotFound is
// returned before any other validation runs, same not-found-on-mismatch
// guard as Get.
func (s *Service) Update(ctx context.Context, id uint, in UpdateInput, branchID *uint, actorEmployeeID uint) (*Employee, error) {
	if in.Name == "" {
		return nil, ErrNameRequired
	}
	if in.Role == "" {
		return nil, ErrRoleRequired
	}
	if !isValidRole(in.Role) {
		return nil, ErrInvalidRole
	}
	if in.BranchID == 0 {
		return nil, ErrBranchReq
	}
	if err := validatePhone(in.Phone); err != nil {
		return nil, err
	}
	if err := s.checkBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if err := s.checkPhoneUnique(ctx, in.Phone, rec.ID); err != nil {
		return nil, err
	}

	roleID, err := s.resolveRoleID(ctx, in.Role)
	if err != nil {
		return nil, err
	}
	beforeRole := rec.Role

	rec.Name = in.Name
	rec.Role = in.Role
	rec.RoleID = roleID
	rec.BranchID = in.BranchID
	rec.Phone = in.Phone
	rec.LoansProcessed = in.LoansProcessed
	rec.Collections = in.Collections
	rec.Followups = in.Followups
	rec.Pending = in.Pending

	if strings.TrimSpace(in.Username) != "" {
		username := strings.TrimSpace(in.Username)
		if !usernameRe.MatchString(username) {
			return nil, ErrUsernameInvalid
		}
		if err := s.checkUsernameUnique(ctx, username, rec.ID); err != nil {
			return nil, err
		}
		rec.Username = username
	}

	if strings.TrimSpace(in.Email) != "" {
		email := strings.ToLower(strings.TrimSpace(in.Email))
		if !emailRe.MatchString(email) {
			return nil, ErrEmailInvalid
		}
		existing, err := s.repo.FindByEmail(ctx, email)
		if err == nil && existing.ID != rec.ID {
			return nil, ErrEmailTaken
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		rec.Email = email
	}

	if in.Password != "" {
		if len(in.Password) < 8 {
			return nil, ErrPasswordTooShort
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost+2)
		if err != nil {
			return nil, err
		}
		rec.PasswordHash = string(hash)
	}

	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	detail := "role unchanged: " + rec.Role
	if beforeRole != rec.Role {
		detail = fmt.Sprintf("role: %s -> %s", beforeRole, rec.Role)
	}
	s.logAudit(ctx, actorEmployeeID, auditlog.ActionEmployeeUpdated, rec.ID, rec.Name, detail)
	return s.repo.FindByID(ctx, rec.ID)
}

// Delete removes the employee identified by id. branchID (nil for
// Administrator) must match the employee's current branch or ErrNotFound is
// returned, same not-found-on-mismatch guard as Get/Update.
func (s *Service) Delete(ctx context.Context, id uint, branchID *uint, actorEmployeeID uint) error {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return ErrNotFound
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.logAudit(ctx, actorEmployeeID, auditlog.ActionEmployeeDeleted, rec.ID, rec.Name, "role="+rec.Role)
	return nil
}

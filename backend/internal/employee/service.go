package employee

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/platform/httpx"
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
}

func NewService(repo *Repository, branchRepo *branch.Repository) *Service {
	return &Service{repo: repo, branchRepo: branchRepo}
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

func (s *Service) checkBranch(id uint) error {
	ok, err := s.branchRepo.Exists(id)
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
func (s *Service) checkPhoneUnique(phone string, excludeID uint) error {
	if phone == "" {
		return nil
	}
	existing, err := s.repo.FindByPhone(phone)
	if err == nil && existing.ID != excludeID {
		return ErrPhoneTaken
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

// checkUsernameUnique mirrors checkPhoneUnique for Username.
func (s *Service) checkUsernameUnique(username string, excludeID uint) error {
	if username == "" {
		return nil
	}
	existing, err := s.repo.FindByUsername(username)
	if err == nil && existing.ID != excludeID {
		return ErrUsernameTaken
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func (s *Service) Create(in CreateInput) (*Employee, error) {
	if err := validateCreate(in); err != nil {
		return nil, err
	}
	if err := s.checkBranch(in.BranchID); err != nil {
		return nil, err
	}
	if err := s.checkPhoneUnique(in.Phone, 0); err != nil {
		return nil, err
	}
	if err := s.checkUsernameUnique(in.Username, 0); err != nil {
		return nil, err
	}

	count, err := s.repo.CountAll()
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("EMP-%02d", count+1)

	rec := &Employee{
		Code:     code,
		Name:     in.Name,
		Role:     in.Role,
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
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

// List returns employees, optionally scoped to branchID (nil = all
// branches — Administrator only, see platform.GetBranchScope).
func (s *Service) List(branchID *uint, limit, offset int) ([]Employee, error) {
	return s.repo.FindAll(branchID, limit, offset)
}

// Get returns the employee by id, or ErrNotFound if it doesn't exist OR
// (when branchID is non-nil) belongs to a different branch — a non-admin
// gets the same "not found" for another branch's employee as for a
// genuinely missing id, so branch existence is never leaked.
func (s *Service) Get(id uint, branchID *uint) (*Employee, error) {
	rec, err := s.repo.FindByID(id)
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
func (s *Service) Update(id uint, in UpdateInput, branchID *uint) (*Employee, error) {
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
	if err := s.checkBranch(in.BranchID); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if err := s.checkPhoneUnique(in.Phone, rec.ID); err != nil {
		return nil, err
	}

	rec.Name = in.Name
	rec.Role = in.Role
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
		if err := s.checkUsernameUnique(username, rec.ID); err != nil {
			return nil, err
		}
		rec.Username = username
	}

	if strings.TrimSpace(in.Email) != "" {
		email := strings.ToLower(strings.TrimSpace(in.Email))
		if !emailRe.MatchString(email) {
			return nil, ErrEmailInvalid
		}
		existing, err := s.repo.FindByEmail(email)
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

	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

// Delete removes the employee identified by id. branchID (nil for
// Administrator) must match the employee's current branch or ErrNotFound is
// returned, same not-found-on-mismatch guard as Get/Update.
func (s *Service) Delete(id uint, branchID *uint) error {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return ErrNotFound
	}
	return s.repo.Delete(id)
}

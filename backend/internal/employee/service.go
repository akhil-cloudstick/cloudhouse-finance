package employee

import (
	"errors"
	"fmt"
	"regexp"

	"ambikagold/backend/internal/branch"
)

var (
	ErrNotFound      = errors.New("employee not found")
	ErrNameRequired  = errors.New("name is required")
	ErrRoleRequired  = errors.New("role is required")
	ErrInvalidRole   = errors.New("role must be one of the predefined roles")
	ErrBranchReq     = errors.New("branch is required")
	ErrBranchInvalid = errors.New("branch does not exist")
	ErrPhoneInvalid  = errors.New("phone must be a 10-digit number")
)

// ValidRoles is the canonical role whitelist. Keep this list IDENTICAL to
// the `ROLES` constant in frontend/components/modals/EmployeeModal.tsx —
// there is no shared codegen between the two, so any edit to either list
// must be mirrored in the other.
var ValidRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
	"Accountant", "Collection Staff", "Auction Admin", "Auditor",
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
	return validatePhone(in.Phone)
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

func (s *Service) Create(in CreateInput) (*Employee, error) {
	if err := validateCreate(in); err != nil {
		return nil, err
	}
	if err := s.checkBranch(in.BranchID); err != nil {
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
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

func (s *Service) List() ([]Employee, error) {
	return s.repo.FindAll()
}

func (s *Service) Get(id uint) (*Employee, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) Update(id uint, in UpdateInput) (*Employee, error) {
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

	rec.Name = in.Name
	rec.Role = in.Role
	rec.BranchID = in.BranchID
	rec.Phone = in.Phone
	rec.LoansProcessed = in.LoansProcessed
	rec.Collections = in.Collections
	rec.Followups = in.Followups
	rec.Pending = in.Pending

	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

func (s *Service) Delete(id uint) error {
	if _, err := s.repo.FindByID(id); err != nil {
		return ErrNotFound
	}
	return s.repo.Delete(id)
}

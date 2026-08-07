package employee

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound     = errors.New("employee not found")
	ErrNameRequired = errors.New("name is required")
	ErrRoleRequired = errors.New("role is required")
	ErrBranchReq    = errors.New("branch is required")
)

// CreateInput / UpdateInput mirror the fields an admin supplies via the
// "Add Employee" form (EmployeeModal.tsx). Performance counters
// (LoansProcessed/Collections/Followups/Pending) start at zero for a new
// employee and are adjusted by other domains (loans, ledger) once those
// exist — not settable directly on create.
type CreateInput struct {
	Name   string
	Role   string
	Branch string
	Phone  string
}

// UpdateInput additionally allows adjusting the performance counters,
// since an admin may need to correct them directly until the owning
// domains (loans/ledger) are wired up to update them automatically.
type UpdateInput struct {
	Name           string
	Role           string
	Branch         string
	Phone          string
	LoansProcessed int
	Collections    float64
	Followups      int
	Pending        int
}

// Service implements employee business rules on top of the Repository.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func validateCreate(in CreateInput) error {
	if in.Name == "" {
		return ErrNameRequired
	}
	if in.Role == "" {
		return ErrRoleRequired
	}
	if in.Branch == "" {
		return ErrBranchReq
	}
	return nil
}

func (s *Service) Create(in CreateInput) (*Employee, error) {
	if err := validateCreate(in); err != nil {
		return nil, err
	}

	count, err := s.repo.CountAll()
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("EMP-%02d", count+1)

	rec := &Employee{
		Code:   code,
		Name:   in.Name,
		Role:   in.Role,
		Branch: in.Branch,
		Phone:  in.Phone,
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return rec, nil
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
	if in.Branch == "" {
		return nil, ErrBranchReq
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}

	rec.Name = in.Name
	rec.Role = in.Role
	rec.Branch = in.Branch
	rec.Phone = in.Phone
	rec.LoansProcessed = in.LoansProcessed
	rec.Collections = in.Collections
	rec.Followups = in.Followups
	rec.Pending = in.Pending

	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) Delete(id uint) error {
	if _, err := s.repo.FindByID(id); err != nil {
		return ErrNotFound
	}
	return s.repo.Delete(id)
}

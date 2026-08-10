package branch

import "errors"

var (
	ErrNotFound      = errors.New("branch not found")
	ErrNameRequired  = errors.New("name is required")
	ErrAddressReq    = errors.New("address is required")
	ErrDuplicateName = errors.New("a branch with this name already exists")
	ErrInUse         = errors.New("branch cannot be deactivated while it still has linked employees, expenses, cash movements, or customers")
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
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
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

func (s *Service) Create(in CreateInput) (*Branch, error) {
	if err := validate(in.Name, in.Address); err != nil {
		return nil, err
	}
	if existing, _ := s.repo.FindByName(in.Name); existing != nil {
		return nil, ErrDuplicateName
	}

	rec := &Branch{
		Name:     in.Name,
		Code:     in.Code,
		Address:  in.Address,
		Phone:    in.Phone,
		IsActive: true,
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) List() ([]Branch, error) {
	return s.repo.FindAll()
}

func (s *Service) Get(id uint) (*Branch, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) Update(id uint, in UpdateInput) (*Branch, error) {
	if err := validate(in.Name, in.Address); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if existing, _ := s.repo.FindByName(in.Name); existing != nil && existing.ID != id {
		return nil, ErrDuplicateName
	}

	rec.Name = in.Name
	rec.Code = in.Code
	rec.Address = in.Address
	rec.Phone = in.Phone
	rec.IsActive = in.IsActive

	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Deactivate soft-disables a branch rather than hard-deleting it, so
// historical records referencing it (employees, expenses, cash movements)
// keep a valid BranchID.
func (s *Service) Deactivate(id uint) (*Branch, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	refs, err := s.repo.CountReferences(id)
	if err != nil {
		return nil, err
	}
	if refs > 0 {
		return nil, ErrInUse
	}
	rec.IsActive = false
	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

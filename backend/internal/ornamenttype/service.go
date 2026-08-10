package ornamenttype

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

var ErrNameRequired = errors.New("name is required")

// Service implements ornament-type business rules on top of the Repository.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(query string) ([]OrnamentType, error) {
	return s.repo.FindAll(query)
}

// FindOrCreate trims the given name, rejects it if empty, and returns the
// existing row with a case-insensitive matching name if one exists;
// otherwise it creates and returns a new row. The bool result reports
// whether a new row was created (true) or an existing one was reused
// (false), so the handler can pick the right HTTP status.
func (s *Service) FindOrCreate(name string) (*OrnamentType, bool, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, false, ErrNameRequired
	}

	existing, err := s.repo.FindByName(trimmed)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}

	rec := &OrnamentType{Name: trimmed}
	if err := s.repo.Create(rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

package ornamenttype

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"ambikagold/backend/internal/platform/httpx"
)

var ErrNameRequired = httpx.NewBadRequest("name is required")

// Service implements ornament-type business rules on top of the Repository.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, query string) ([]OrnamentType, error) {
	return s.repo.FindAll(ctx, query)
}

// FindOrCreate trims the given name, rejects it if empty, and returns the
// existing row with a case-insensitive matching name if one exists;
// otherwise it creates and returns a new row. The bool result reports
// whether a new row was created (true) or an existing one was reused
// (false), so the handler can pick the right HTTP status.
func (s *Service) FindOrCreate(ctx context.Context, name string) (*OrnamentType, bool, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, false, ErrNameRequired
	}

	existing, err := s.repo.FindByName(ctx, trimmed)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}

	rec := &OrnamentType{Name: trimmed}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

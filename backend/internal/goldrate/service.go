package goldrate

import (
	"context"
	"time"

	"ambikagold/backend/internal/platform/httpx"
)

var (
	ErrNotFound    = httpx.NewNotFound("gold rate not found")
	ErrInvalidRate = httpx.NewBadRequest("k24 rate must be greater than zero")
	ErrSetByBlank  = httpx.NewBadRequest("setBy is required")
)

// PublishInput mirrors the fields an admin supplies via the "Set Today's
// Rate" form (RateModal.tsx). Only the 24K benchmark is published — see
// this package's doc comment.
type PublishInput struct {
	Date  time.Time
	K24   float64
	SetBy string
}

// Service implements gold-rate business rules on top of the Repository.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func validate(in PublishInput) error {
	if in.K24 <= 0 {
		return ErrInvalidRate
	}
	if in.SetBy == "" {
		return ErrSetByBlank
	}
	return nil
}

// Publish records a new rate entry. Publishing never overwrites a prior
// entry — every publish is a new history row, and the newest one becomes
// "current" (see Latest).
func (s *Service) Publish(ctx context.Context, in PublishInput) (*GoldRate, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	date := in.Date
	if date.IsZero() {
		date = time.Now()
	}
	rec := &GoldRate{
		Date:  date,
		K24:   in.K24,
		SetBy: in.SetBy,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) List(ctx context.Context, limit, offset int) ([]GoldRate, int64, error) {
	return s.repo.FindAll(ctx, limit, offset)
}

func (s *Service) Latest(ctx context.Context) (*GoldRate, error) {
	rec, err := s.repo.FindLatest(ctx)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) Get(ctx context.Context, id uint) (*GoldRate, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

package goldrate

import (
	"errors"
	"time"
)

var (
	ErrNotFound    = errors.New("gold rate not found")
	ErrInvalidRate = errors.New("k24, k22 and k18 rates must all be greater than zero")
	ErrSetByBlank  = errors.New("setBy is required")
)

// PublishInput mirrors the fields an admin supplies via the "Set Today's
// Rate" form (RateModal.tsx).
type PublishInput struct {
	Date  time.Time
	K24   float64
	K22   float64
	K18   float64
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
	if in.K24 <= 0 || in.K22 <= 0 || in.K18 <= 0 {
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
func (s *Service) Publish(in PublishInput) (*GoldRate, error) {
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
		K22:   in.K22,
		K18:   in.K18,
		SetBy: in.SetBy,
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) List() ([]GoldRate, error) {
	return s.repo.FindAll()
}

func (s *Service) Latest() (*GoldRate, error) {
	rec, err := s.repo.FindLatest()
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) Get(id uint) (*GoldRate, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

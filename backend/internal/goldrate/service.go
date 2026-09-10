package goldrate

import (
	"time"

	"ambikagold/backend/internal/platform/httpx"
)

var (
	ErrNotFound     = httpx.NewNotFound("gold rate not found")
	ErrInvalidRate  = httpx.NewBadRequest("rate must be greater than zero")
	ErrSetByBlank   = httpx.NewBadRequest("setBy is required")
	ErrInvalidKarat = httpx.NewBadRequest("karat must be 24, 22, or 18")
)

// PublishInput mirrors the fields an admin supplies via the "Set Today's
// Rate" form (RateModalContent) — Manual mode types a karat's rate
// directly; Auto mode computes the derived rate client-side off the
// latest K24 and sends it here the same way. Karat says which single
// column this publish is setting; the other two carry forward from the
// previous latest row (see Publish) — every publish still writes a
// complete three-column snapshot, never just one column in isolation.
type PublishInput struct {
	Date  time.Time
	Karat int // 24, 22, or 18
	Rate  float64
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
	if in.Karat != 24 && in.Karat != 22 && in.Karat != 18 {
		return ErrInvalidKarat
	}
	if in.Rate <= 0 {
		return ErrInvalidRate
	}
	if in.SetBy == "" {
		return ErrSetByBlank
	}
	return nil
}

// Publish records a new rate entry. Publishing never overwrites a prior
// entry — every publish is a new history row, and the newest one becomes
// "current" (see Latest). The karat being set takes the new rate; the
// other two columns carry forward unchanged from whatever the previous
// latest row had (zero if this is the very first rate ever published) —
// so a karat's stored rate only ever moves when something actually
// touches it, never as a side effect of publishing a different karat.
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
		SetBy: in.SetBy,
	}
	if prev, err := s.repo.FindLatest(); err == nil {
		rec.K24, rec.K22, rec.K18 = prev.K24, prev.K22, prev.K18
	}
	switch in.Karat {
	case 24:
		rec.K24 = in.Rate
	case 22:
		rec.K22 = in.Rate
	case 18:
		rec.K18 = in.Rate
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) List(limit, offset int) ([]GoldRate, int64, error) {
	return s.repo.FindAll(limit, offset)
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

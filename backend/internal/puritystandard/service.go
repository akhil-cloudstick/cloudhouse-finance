package puritystandard

import (
	"errors"
	"fmt"
	"math"

	"gorm.io/gorm"

	"ambikagold/backend/internal/platform/httpx"
)

// MinKarat/MaxKarat/MinFinenessPercent/MaxFinenessPercent bound every
// purity value the app will accept, in either unit — enforced here, in
// FindOrCreate, and mirrored by internal/loan/service.go's parsePurity so
// an ornament's declared/re-tested purity can never be stored outside this
// range regardless of entry point. 10K/24K matches the seeded range (see
// SeedStandards); fineness% must be a positive share of pure gold, capped
// at 100 (pure gold itself).
const (
	MinKarat           = 10
	MaxKarat           = 24
	MinFinenessPercent = 0.0 // exclusive — see validateKarat/validateFineness
	MaxFinenessPercent = 100.0
)

var (
	ErrKaratOutOfRange    = httpx.NewBadRequest(fmt.Sprintf("karat must be between %d and %d", MinKarat, MaxKarat))
	ErrFinenessOutOfRange = httpx.NewBadRequest(fmt.Sprintf("fineness%% must be greater than %.0f and at most %.0f", MinFinenessPercent, MaxFinenessPercent))
	ErrNeitherProvided    = httpx.NewBadRequest("either karat or finenessPercent is required")
)

// ValidateKarat rejects any karat outside [MinKarat, MaxKarat].
func ValidateKarat(karat int) error {
	if karat < MinKarat || karat > MaxKarat {
		return ErrKaratOutOfRange
	}
	return nil
}

// ValidateFineness rejects any fineness% outside (MinFinenessPercent, MaxFinenessPercent].
func ValidateFineness(finenessPercent float64) error {
	if finenessPercent <= MinFinenessPercent || finenessPercent > MaxFinenessPercent {
		return ErrFinenessOutOfRange
	}
	return nil
}

// FinenessForKarat computes the standard fineness% for a karat value,
// rounded to 1 decimal place — the same formula used to seed every
// PurityStandard row, so a staff-picked karat and its suggested fineness%
// always agree.
func FinenessForKarat(karat int) float64 {
	return math.Round(float64(karat)/24*1000) / 10
}

// CreateInput mirrors the fields supplied via a staff-typed custom purity
// (SearchableSelect's allowCreate) or the seeding step below. At least one
// of Karat/FinenessPercent must be set.
type CreateInput struct {
	Karat           *int
	FinenessPercent *float64
	Label           string
}

// Service implements purity-standard business rules on top of the Repository.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(query string) ([]PurityStandard, error) {
	return s.repo.FindAll(query)
}

// FindOrCreate validates the given karat/fineness%, returns an existing
// matching row if one exists, or creates a new one. Mirrors
// bank.Service.FindOrCreate's shape: the bool result reports whether a new
// row was created (true) or an existing one was reused (false).
func (s *Service) FindOrCreate(in CreateInput) (*PurityStandard, bool, error) {
	if in.Karat == nil && in.FinenessPercent == nil {
		return nil, false, ErrNeitherProvided
	}
	if in.Karat != nil {
		if err := ValidateKarat(*in.Karat); err != nil {
			return nil, false, err
		}
		existing, err := s.repo.FindByKarat(*in.Karat)
		if err == nil {
			return existing, false, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, err
		}
	}
	if in.FinenessPercent != nil {
		if err := ValidateFineness(*in.FinenessPercent); err != nil {
			return nil, false, err
		}
		if in.Karat == nil {
			existing, err := s.repo.FindByFineness(*in.FinenessPercent)
			if err == nil {
				return existing, false, nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, false, err
			}
		}
	}

	label := in.Label
	if label == "" {
		switch {
		case in.Karat != nil && in.FinenessPercent != nil:
			label = fmt.Sprintf("%dK (%.1f%%)", *in.Karat, *in.FinenessPercent)
		case in.Karat != nil:
			label = fmt.Sprintf("%dK", *in.Karat)
		default:
			label = fmt.Sprintf("%.1f%%", *in.FinenessPercent)
		}
	}

	rec := &PurityStandard{Karat: in.Karat, FinenessPercent: in.FinenessPercent, Label: label, IsActive: true}
	if err := s.repo.Create(rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

// SeedStandards idempotently seeds every whole karat from MaxKarat down to
// MinKarat (24K...10K), each with its fineness% computed via
// FinenessForKarat — called once from cmd/migrate/main.go's startup
// sequence, safe to re-run (skips any karat that already has a row).
func SeedStandards(db *gorm.DB) error {
	repo := NewRepository(db)
	svc := NewService(repo)
	for karat := MaxKarat; karat >= MinKarat; karat-- {
		if _, err := repo.FindByKarat(karat); err == nil {
			continue // already seeded
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		k := karat
		fineness := FinenessForKarat(k)
		if _, _, err := svc.FindOrCreate(CreateInput{
			Karat:           &k,
			FinenessPercent: &fineness,
			Label:           fmt.Sprintf("%dK (%.1f%%)", k, fineness),
		}); err != nil {
			return err
		}
	}
	return nil
}

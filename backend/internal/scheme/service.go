package scheme

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound        = errors.New("scheme not found")
	ErrInvalidDuration = errors.New("duration must be greater than zero months")
	ErrInvalidLTV      = errors.New("ltv percent must be between 0 and 100")
	ErrInvalidRate     = errors.New("interest rate must be non-negative")
	ErrInvalidWeight   = errors.New("gold weight must be greater than zero")
	ErrInvalidGoldRt   = errors.New("gold rate must be greater than zero")
)

// CreateInput / UpdateInput mirror the fields an admin supplies when
// creating/editing a scheme.
type CreateInput struct {
	Name           string
	InterestRate   float64
	DurationMonths int
	LTVPercent     float64
	InterestMethod string
	PenalRate      float64
	Conditions     string
	IsActive       bool
}

type UpdateInput = CreateInput

// CalculationResult is returned by the loan-eligibility calculator.
type CalculationResult struct {
	GoldWeight      float64 `json:"goldWeight"`
	GoldRate        float64 `json:"goldRate"`
	GrossGoldValue  float64 `json:"grossGoldValue"`
	LTVPercent      float64 `json:"ltvPercent"`
	EligibleLoanAmt float64 `json:"eligibleLoanAmount"`
}

// Service implements loan-scheme business rules on top of the Repository.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func validate(in CreateInput) error {
	if in.DurationMonths <= 0 {
		return ErrInvalidDuration
	}
	if in.LTVPercent <= 0 || in.LTVPercent > 100 {
		return ErrInvalidLTV
	}
	if in.InterestRate < 0 {
		return ErrInvalidRate
	}
	return nil
}

func (s *Service) Create(in CreateInput) (*Scheme, error) {
	if err := validate(in); err != nil {
		return nil, err
	}

	count, err := s.repo.CountAll()
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("SCH-%02d", count+1)

	rec := &Scheme{
		Code:           code,
		Name:           in.Name,
		InterestRate:   in.InterestRate,
		DurationMonths: in.DurationMonths,
		LTVPercent:     in.LTVPercent,
		InterestMethod: in.InterestMethod,
		PenalRate:      in.PenalRate,
		Conditions:     in.Conditions,
		IsActive:       in.IsActive,
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) List(query string) ([]Scheme, error) {
	return s.repo.FindAll(query)
}

func (s *Service) ListActive(query string, limit, offset int) ([]Scheme, error) {
	return s.repo.FindActive(query, limit, offset)
}

func (s *Service) ListInactive() ([]Scheme, error) {
	return s.repo.FindInactive()
}

func (s *Service) Get(id uint) (*Scheme, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) Update(id uint, in UpdateInput) (*Scheme, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}

	rec.Name = in.Name
	rec.InterestRate = in.InterestRate
	rec.DurationMonths = in.DurationMonths
	rec.LTVPercent = in.LTVPercent
	rec.InterestMethod = in.InterestMethod
	rec.PenalRate = in.PenalRate
	rec.Conditions = in.Conditions
	rec.IsActive = in.IsActive

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

// ToggleActive flips IsActive — schemes have no date window anymore, so
// there's no eligibility check beyond the scheme existing.
func (s *Service) ToggleActive(id uint) (*Scheme, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	rec.IsActive = !rec.IsActive

	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Calculate applies the scheme's LTV to a given gold weight/rate:
//
//	Gold Weight × Applicable Gold Rate = Gross Gold Value
//	Gross Gold Value × Scheme LTV       = Eligible Loan Amount
func (s *Service) Calculate(id uint, goldWeight, goldRate float64) (*CalculationResult, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if goldWeight <= 0 {
		return nil, ErrInvalidWeight
	}
	if goldRate <= 0 {
		return nil, ErrInvalidGoldRt
	}

	gross := goldWeight * goldRate
	eligible := gross * (rec.LTVPercent / 100)

	return &CalculationResult{
		GoldWeight:      goldWeight,
		GoldRate:        goldRate,
		GrossGoldValue:  gross,
		LTVPercent:      rec.LTVPercent,
		EligibleLoanAmt: eligible,
	}, nil
}

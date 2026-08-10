package scheme

import (
	"errors"
	"fmt"
	"time"
)

var (
	ErrNotFound      = errors.New("scheme not found")
	ErrInvalidDates  = errors.New("end date must be after start date")
	ErrInvalidLTV    = errors.New("ltv percent must be between 0 and 100")
	ErrInvalidRate   = errors.New("interest rate must be non-negative")
	ErrOutsideWindow = errors.New("scheme cannot be activated outside its validity window")
	ErrInvalidWeight = errors.New("gold weight must be greater than zero")
	ErrInvalidGoldRt = errors.New("gold rate must be greater than zero")
)

// CreateInput / UpdateInput mirror the fields an admin supplies when
// creating/editing a scheme.
type CreateInput struct {
	Name           string
	InterestRate   float64
	StartDate      time.Time
	EndDate        time.Time
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
	if !in.EndDate.After(in.StartDate) {
		return ErrInvalidDates
	}
	if in.LTVPercent <= 0 || in.LTVPercent > 100 {
		return ErrInvalidLTV
	}
	if in.InterestRate < 0 {
		return ErrInvalidRate
	}
	return nil
}

// withinWindow reports whether "now" falls within [start, end].
func withinWindow(now, start, end time.Time) bool {
	return !now.Before(start) && !now.After(end)
}

func (s *Service) Create(in CreateInput) (*Scheme, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	if in.IsActive && !withinWindow(time.Now(), in.StartDate, in.EndDate) {
		return nil, ErrOutsideWindow
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
		StartDate:      in.StartDate,
		EndDate:        in.EndDate,
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
	if in.IsActive && !withinWindow(time.Now(), in.StartDate, in.EndDate) {
		return nil, ErrOutsideWindow
	}

	rec.Name = in.Name
	rec.InterestRate = in.InterestRate
	rec.StartDate = in.StartDate
	rec.EndDate = in.EndDate
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

// ToggleActive flips IsActive, enforcing the validity-window rule when
// activating.
func (s *Service) ToggleActive(id uint) (*Scheme, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}

	newState := !rec.IsActive
	if newState && !withinWindow(time.Now(), rec.StartDate, rec.EndDate) {
		return nil, ErrOutsideWindow
	}
	rec.IsActive = newState

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

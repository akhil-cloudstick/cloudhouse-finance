package scheme

import (
	"context"
	"fmt"
	"strings"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform/httpx"
)

var (
	ErrNotFound              = httpx.NewNotFound("scheme not found")
	ErrInvalidDuration       = httpx.NewBadRequest("duration must be greater than zero months")
	ErrInvalidLTV            = httpx.NewBadRequest("ltv percent must be between 0 and 100")
	ErrInvalidRate           = httpx.NewBadRequest("interest rate must be non-negative")
	ErrInvalidWeight         = httpx.NewBadRequest("gold weight must be greater than zero")
	ErrInvalidGoldRt         = httpx.NewBadRequest("gold rate must be greater than zero")
	ErrBranchReq             = httpx.NewBadRequest("branch is required")
	ErrBranchInvalid         = httpx.NewBadRequest("branch does not exist")
	ErrInvalidServiceCharge  = httpx.NewBadRequest("service charge type must be None, Flat, or Percent")
	ErrInvalidServiceChgMode = httpx.NewBadRequest("service charge mode must be WithheldFromPayout or AddedToPrincipal when a charge type is set")
	ErrInvalidServiceChgVal  = httpx.NewBadRequest("service charge value must be non-negative, and no more than 100 for a Percent charge")
)

// CreateInput / UpdateInput mirror the fields an admin supplies when
// creating/editing a scheme.
type CreateInput struct {
	Name           string
	BranchID       uint
	InterestRate   float64
	DurationMonths int
	LTVPercent     float64
	InterestMethod string
	PenalRate      float64
	Conditions     string
	IsActive       bool

	// ServiceChargeType/Value/Mode configure an optional per-loan charge —
	// see Scheme's own doc comment on the ServiceChargeType*/
	// ServiceChargeMode* constants. ServiceChargeType empty is treated the
	// same as ServiceChargeTypeNone (the zero value/default).
	ServiceChargeType  string
	ServiceChargeValue float64
	ServiceChargeMode  string
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
	repo       *Repository
	branchRepo *branch.Repository
}

func NewService(repo *Repository, branchRepo *branch.Repository) *Service {
	return &Service{repo: repo, branchRepo: branchRepo}
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
	switch in.ServiceChargeType {
	case "", ServiceChargeTypeNone:
		// No charge configured — Mode/Value are ignored regardless of what
		// was sent, same "don't validate fields the type makes moot"
		// approach the loan payment split types use elsewhere.
	case ServiceChargeTypeFlat, ServiceChargeTypePercent:
		if in.ServiceChargeValue < 0 || (in.ServiceChargeType == ServiceChargeTypePercent && in.ServiceChargeValue > 100) {
			return ErrInvalidServiceChgVal
		}
		switch in.ServiceChargeMode {
		case ServiceChargeModeWithheldFromPayout, ServiceChargeModeAddedToPrincipal:
		default:
			return ErrInvalidServiceChgMode
		}
	default:
		return ErrInvalidServiceCharge
	}
	return nil
}

func (s *Service) checkBranch(ctx context.Context, id uint) error {
	ok, err := s.branchRepo.Exists(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return ErrBranchInvalid
	}
	return nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*Scheme, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	if in.BranchID == 0 {
		return nil, ErrBranchReq
	}
	if err := s.checkBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}

	maxSuffix, err := s.repo.MaxCodeSuffix(ctx)
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("SCH-%02d", maxSuffix+1)

	chargeType := in.ServiceChargeType
	if chargeType == "" {
		chargeType = ServiceChargeTypeNone
	}
	rec := &Scheme{
		Code:               code,
		BranchID:           in.BranchID,
		Name:               in.Name,
		InterestRate:       in.InterestRate,
		DurationMonths:     in.DurationMonths,
		LTVPercent:         in.LTVPercent,
		InterestMethod:     in.InterestMethod,
		PenalRate:          in.PenalRate,
		Conditions:         in.Conditions,
		IsActive:           in.IsActive,
		ServiceChargeType:  chargeType,
		ServiceChargeValue: in.ServiceChargeValue,
		ServiceChargeMode:  in.ServiceChargeMode,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// List returns schemes, optionally scoped to branchID (nil = all branches —
// Administrator only, see platform.GetBranchScope). limit/offset mirror
// FindAll's pagination convention (0 = unpaged).
func (s *Service) List(ctx context.Context, query string, methods []string, branchID *uint, limit, offset int) ([]Scheme, int64, error) {
	return s.repo.FindAll(ctx, query, methods, branchID, limit, offset)
}

func (s *Service) ListActive(ctx context.Context, query string, branchID *uint, limit, offset int) ([]Scheme, int64, error) {
	return s.repo.FindActive(ctx, query, branchID, limit, offset)
}

func (s *Service) ListInactive(ctx context.Context) ([]Scheme, error) {
	return s.repo.FindInactive(ctx)
}

// Get returns the scheme by id, or ErrNotFound if it doesn't exist OR (when
// branchID is non-nil) belongs to a different branch — a non-admin gets the
// same "not found" for another branch's scheme as for a genuinely missing
// id, so branch existence is never leaked.
func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*Scheme, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return rec, nil
}

// Update applies in to the scheme identified by id. branchID (nil for
// Administrator) must match the scheme's current branch or ErrNotFound is
// returned before any other validation runs, same not-found-on-mismatch
// guard as Get.
func (s *Service) Update(ctx context.Context, id uint, in UpdateInput, branchID *uint) (*Scheme, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	if in.BranchID == 0 {
		return nil, ErrBranchReq
	}
	if err := s.checkBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}

	chargeType := in.ServiceChargeType
	if chargeType == "" {
		chargeType = ServiceChargeTypeNone
	}
	rec.BranchID = in.BranchID
	rec.Name = in.Name
	rec.InterestRate = in.InterestRate
	rec.DurationMonths = in.DurationMonths
	rec.LTVPercent = in.LTVPercent
	rec.InterestMethod = in.InterestMethod
	rec.PenalRate = in.PenalRate
	rec.Conditions = in.Conditions
	rec.IsActive = in.IsActive
	rec.ServiceChargeType = chargeType
	rec.ServiceChargeValue = in.ServiceChargeValue
	rec.ServiceChargeMode = in.ServiceChargeMode

	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Delete permanently removes the scheme identified by id. branchID (nil for
// Administrator) must match the scheme's current branch or ErrNotFound is
// returned, same not-found-on-mismatch guard as Get/Update. Refused with a
// 409 while any loan or loan draft still uses the scheme — deactivate it
// instead in that case.
func (s *Service) Delete(ctx context.Context, id uint, branchID *uint) error {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return ErrNotFound
	}
	loans, drafts, err := s.repo.CountReferences(ctx, id)
	if err != nil {
		return err
	}
	if loans > 0 || drafts > 0 {
		return errSchemeInUse(loans, drafts)
	}
	return s.repo.HardDelete(ctx, id)
}

// errSchemeInUse names how many loans/drafts block a scheme delete.
func errSchemeInUse(loans, drafts int64) error {
	var parts []string
	if loans > 0 {
		parts = append(parts, fmt.Sprintf("%d loan(s)", loans))
	}
	if drafts > 0 {
		parts = append(parts, fmt.Sprintf("%d loan draft(s)", drafts))
	}
	return httpx.NewConflict(fmt.Sprintf(
		"Cannot delete this scheme — it is used by %s. Deactivate it instead.",
		strings.Join(parts, " and "),
	))
}

// ToggleActive flips IsActive — schemes have no date window anymore, so
// there's no eligibility check beyond the scheme existing.
func (s *Service) ToggleActive(ctx context.Context, id uint) (*Scheme, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	rec.IsActive = !rec.IsActive

	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Calculate applies the scheme's LTV to a given gold weight/rate:
//
//	Gold Weight × Applicable Gold Rate = Gross Gold Value
//	Gross Gold Value × Scheme LTV       = Eligible Loan Amount
func (s *Service) Calculate(ctx context.Context, id uint, goldWeight, goldRate float64) (*CalculationResult, error) {
	rec, err := s.repo.FindByID(ctx, id)
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

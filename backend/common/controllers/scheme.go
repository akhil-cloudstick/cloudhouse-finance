package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type schemeRequest struct {
	Name               string                  `json:"name" binding:"required"`
	BranchID           uint                    `json:"branch_id"`
	InterestRate       float64                 `json:"interest_rate" binding:"required"`
	DurationMonths     int                     `json:"duration_months" binding:"required"`
	LTVPercent         float64                 `json:"ltv_percent" binding:"required"`
	InterestMethod     string                  `json:"interest_method"`
	PenalRate          float64                 `json:"penal_rate"`
	Conditions         string                  `json:"conditions"`
	IsActive           bool                    `json:"is_active"`
	RateTiers          []commonModels.RateTier `json:"rate_tiers"`
	MinimumDays        int                     `json:"minimum_days"`
	ServiceChargeType  string                  `json:"service_charge_type"`
	ServiceChargeValue float64                 `json:"service_charge_value"`
	ServiceChargeMode  string                  `json:"service_charge_mode"`
}

type calculateRequest struct {
	GoldWeight float64 `json:"gold_weight" binding:"required"`
	GoldRate   float64 `json:"gold_rate" binding:"required"`
}

type SchemeCreateInput struct {
	Name               string
	BranchID           uint
	InterestRate       float64
	DurationMonths     int
	LTVPercent         float64
	InterestMethod     string
	PenalRate          float64
	Conditions         string
	IsActive           bool
	RateTiers          []commonModels.RateTier
	MinimumDays        int
	ServiceChargeType  string
	ServiceChargeValue float64
	ServiceChargeMode  string
}

type SchemeUpdateInput = SchemeCreateInput

type CalculationResult struct {
	GoldWeight      float64 `json:"gold_weight"`
	GoldRate        float64 `json:"gold_rate"`
	GrossGoldValue  float64 `json:"gross_gold_value"`
	LTVPercent      float64 `json:"ltv_percent"`
	EligibleLoanAmt float64 `json:"eligible_loan_amount"`
}

func (req schemeRequest) toInput() SchemeCreateInput {
	return SchemeCreateInput{
		Name:               req.Name,
		BranchID:           req.BranchID,
		InterestRate:       req.InterestRate,
		DurationMonths:     req.DurationMonths,
		LTVPercent:         req.LTVPercent,
		InterestMethod:     req.InterestMethod,
		PenalRate:          req.PenalRate,
		RateTiers:          req.RateTiers,
		MinimumDays:        req.MinimumDays,
		Conditions:         req.Conditions,
		IsActive:           req.IsActive,
		ServiceChargeType:  req.ServiceChargeType,
		ServiceChargeValue: req.ServiceChargeValue,
		ServiceChargeMode:  req.ServiceChargeMode,
	}
}

func insertScheme(ctx context.Context, s *commonModels.Scheme) error {
	return config.DB.
		WithContext(ctx).Create(s).Error
}

func findSchemes(ctx context.Context, query string, methods []string, branchID *uint, limit, offset int) ([]commonModels.Scheme, int64, error) {
	var schemes []commonModels.Scheme
	q := config.DB.
		WithContext(ctx).Preload("Branch").Order("id asc")
	if query != "" {
		like := "%" + query + "%"
		q = q.Where("name ILIKE ? OR code ILIKE ? OR CAST(interest_rate AS TEXT) ILIKE ? OR CAST(ltv_percent AS TEXT) ILIKE ? OR CAST(duration_months AS TEXT) ILIKE ?", like, like, like, like, like)
	}
	if len(methods) > 0 {
		q = q.Where("interest_method IN ?", methods)
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&commonModels.Scheme{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&schemes).Error
	return schemes, total, err
}

func findActive(ctx context.Context, query string, branchID *uint, limit, offset int) ([]commonModels.Scheme, int64, error) {
	var schemes []commonModels.Scheme
	q := config.DB.
		WithContext(ctx).Where("is_active = ?", true).Order("id asc")
	if query != "" {
		q = q.Where("name ILIKE ? OR code ILIKE ?", "%"+query+"%", "%"+query+"%")
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&commonModels.Scheme{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&schemes).Error
	return schemes, total, err
}

func findInactive(ctx context.Context) ([]commonModels.Scheme, error) {
	var schemes []commonModels.Scheme
	err := config.DB.
		WithContext(ctx).Where("is_active = ?", false).Order("id asc").Find(&schemes).Error
	return schemes, err
}

func FindSchemeByID(ctx context.Context, id uint) (*commonModels.Scheme, error) {
	var s commonModels.Scheme
	if err := config.DB.
		WithContext(ctx).Preload("Branch").First(&s, id).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func persistScheme(ctx context.Context, s *commonModels.Scheme) error {
	return config.DB.
		WithContext(ctx).Save(s).Error
}

func hardDelete(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Unscoped().Delete(&commonModels.Scheme{}, id).Error
}

func countSchemeReferences(ctx context.Context, id uint) (loans, drafts int64, err error) {
	db := config.DB.
		WithContext(ctx)
	if err = db.Raw("SELECT COUNT(*) FROM loans WHERE scheme_id = ?", id).Scan(&loans).Error; err != nil {
		return 0, 0, err
	}
	if err = db.Raw("SELECT COUNT(*) FROM loan_drafts WHERE scheme_id = ?", id).Scan(&drafts).Error; err != nil {
		return 0, 0, err
	}
	return loans, drafts, nil
}

func countSchemeAll(ctx context.Context) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Unscoped().Model(&commonModels.Scheme{}).Count(&count).Error
	return count, err
}

func schemeMaxCodeSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := config.DB.
		WithContext(ctx).Model(&commonModels.Scheme{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'SCH-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

func normalizeTiers(in *SchemeCreateInput) {
	if in.InterestMethod != "Multiple interest" {
		in.RateTiers = nil
		in.MinimumDays = 0
		return
	}
	if n := len(in.RateTiers); n > 0 {
		in.RateTiers[n-1].Days = 0
		in.InterestRate = in.RateTiers[0].Rate
	}
}

func validateTiers(in SchemeCreateInput) error {
	if in.InterestMethod != "Multiple interest" {
		return nil
	}
	if len(in.RateTiers) < 2 {
		return NewBadRequest("multiple interest needs at least two rate rows, each with a positive rate and (except the last) a positive number of days, and a non-negative minimum period")
	}
	for i, t := range in.RateTiers {
		if t.Rate <= 0 {
			return NewBadRequest("multiple interest needs at least two rate rows, each with a positive rate and (except the last) a positive number of days, and a non-negative minimum period")
		}
		if i < len(in.RateTiers)-1 && t.Days <= 0 {
			return NewBadRequest("multiple interest needs at least two rate rows, each with a positive rate and (except the last) a positive number of days, and a non-negative minimum period")
		}
	}
	if in.MinimumDays < 0 {
		return NewBadRequest("multiple interest needs at least two rate rows, each with a positive rate and (except the last) a positive number of days, and a non-negative minimum period")
	}
	return nil
}

func schemeValidate(in SchemeCreateInput) error {
	if err := validateTiers(in); err != nil {
		return err
	}
	if in.DurationMonths <= 0 {
		return NewBadRequest("duration must be greater than zero months")
	}
	if in.LTVPercent <= 0 || in.LTVPercent > 100 {
		return NewBadRequest("ltv percent must be between 0 and 100")
	}
	if in.InterestRate < 0 {
		return NewBadRequest("interest rate must be non-negative")
	}
	switch in.ServiceChargeType {
	case "", commonModels.ServiceChargeTypeNone:
	case commonModels.ServiceChargeTypeFlat, commonModels.ServiceChargeTypePercent:
		if in.ServiceChargeValue < 0 || (in.ServiceChargeType == commonModels.ServiceChargeTypePercent && in.ServiceChargeValue > 100) {
			return NewBadRequest("service charge value must be non-negative, and no more than 100 for a Percent charge")
		}
		switch in.ServiceChargeMode {
		case "", commonModels.ServiceChargeModeWithheldFromPayout, commonModels.ServiceChargeModeAddedToPrincipal:
		default:
			return NewBadRequest("service charge mode must be WithheldFromPayout or AddedToPrincipal when a charge type is set")
		}
	default:
		return NewBadRequest("service charge type must be None, Flat, or Percent")
	}
	return nil
}

func checkSchemeBranch(ctx context.Context, id uint) error {
	ok, err := BranchExists(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return NewBadRequest("branch does not exist")
	}
	return nil
}

func SaveScheme(ctx context.Context, in SchemeCreateInput) (*commonModels.Scheme, error) {
	if err := schemeValidate(in); err != nil {
		return nil, err
	}
	normalizeTiers(&in)
	if in.BranchID == 0 {
		return nil, NewBadRequest("branch is required")
	}
	if err := checkSchemeBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	maxSuffix, err := schemeMaxCodeSuffix(ctx)
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("SCH-%02d", maxSuffix+1)
	chargeType := in.ServiceChargeType
	if chargeType == "" {
		chargeType = commonModels.ServiceChargeTypeNone
	}
	rec := &commonModels.Scheme{
		Code:               code,
		BranchID:           in.BranchID,
		Name:               in.Name,
		InterestRate:       in.InterestRate,
		DurationMonths:     in.DurationMonths,
		LTVPercent:         in.LTVPercent,
		InterestMethod:     in.InterestMethod,
		PenalRate:          in.PenalRate,
		RateTiers:          in.RateTiers,
		MinimumDays:        in.MinimumDays,
		Conditions:         in.Conditions,
		IsActive:           in.IsActive,
		ServiceChargeType:  chargeType,
		ServiceChargeValue: in.ServiceChargeValue,
		ServiceChargeMode:  in.ServiceChargeMode,
	}
	if err := insertScheme(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func listSchemes(ctx context.Context, query string, methods []string, branchID *uint, limit, offset int) ([]commonModels.Scheme, int64, error) {
	return findSchemes(ctx, query, methods, branchID, limit, offset)
}

func listActive(ctx context.Context, query string, branchID *uint, limit, offset int) ([]commonModels.Scheme, int64, error) {
	return findActive(ctx, query, branchID, limit, offset)
}

func listInactive(ctx context.Context) ([]commonModels.Scheme, error) {
	return findInactive(ctx)
}

func getScheme(ctx context.Context, id uint, branchID *uint) (*commonModels.Scheme, error) {
	rec, err := FindSchemeByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("scheme not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, NewNotFound("scheme not found")
	}
	return rec, nil
}

func updateScheme(ctx context.Context, id uint, in SchemeUpdateInput, branchID *uint) (*commonModels.Scheme, error) {
	if err := schemeValidate(in); err != nil {
		return nil, err
	}
	normalizeTiers(&in)
	if in.BranchID == 0 {
		return nil, NewBadRequest("branch is required")
	}
	if err := checkSchemeBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	rec, err := FindSchemeByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("scheme not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, NewNotFound("scheme not found")
	}
	chargeType := in.ServiceChargeType
	if chargeType == "" {
		chargeType = commonModels.ServiceChargeTypeNone
	}
	rec.BranchID = in.BranchID
	rec.Name = in.Name
	rec.InterestRate = in.InterestRate
	rec.DurationMonths = in.DurationMonths
	rec.LTVPercent = in.LTVPercent
	rec.InterestMethod = in.InterestMethod
	rec.PenalRate = in.PenalRate
	rec.RateTiers = in.RateTiers
	rec.MinimumDays = in.MinimumDays
	rec.Conditions = in.Conditions
	rec.IsActive = in.IsActive
	rec.ServiceChargeType = chargeType
	rec.ServiceChargeValue = in.ServiceChargeValue
	rec.ServiceChargeMode = in.ServiceChargeMode
	if err := persistScheme(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func deleteScheme(ctx context.Context, id uint, branchID *uint) error {
	rec, err := FindSchemeByID(ctx, id)
	if err != nil {
		return NewNotFound("scheme not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return NewNotFound("scheme not found")
	}
	loans, drafts, err := countSchemeReferences(ctx, id)
	if err != nil {
		return err
	}
	if loans > 0 || drafts > 0 {
		return errSchemeInUse(loans, drafts)
	}
	return hardDelete(ctx, id)
}

func errSchemeInUse(loans, drafts int64) error {
	var parts []string
	if loans > 0 {
		parts = append(parts, fmt.Sprintf("%d loan(s)", loans))
	}
	if drafts > 0 {
		parts = append(parts, fmt.Sprintf("%d loan draft(s)", drafts))
	}
	return NewConflict(fmt.Sprintf(
		"Cannot delete this scheme — it is used by %s. Deactivate it instead.",
		strings.Join(parts, " and "),
	))
}

func toggleActive(ctx context.Context, id uint) (*commonModels.Scheme, error) {
	rec, err := FindSchemeByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("scheme not found")
	}
	rec.IsActive = !rec.IsActive
	if err := persistScheme(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func calculateScheme(ctx context.Context, id uint, goldWeight, goldRate float64) (*CalculationResult, error) {
	rec, err := FindSchemeByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("scheme not found")
	}
	if goldWeight <= 0 {
		return nil, NewBadRequest("gold weight must be greater than zero")
	}
	if goldRate <= 0 {
		return nil, NewBadRequest("gold rate must be greater than zero")
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

func CreateScheme(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req schemeRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input := req.toInput()
	input.BranchID = auth.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := SaveScheme(ctx, input)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func ListSchemes(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	branchID := auth.GetBranchScope(c)
	var methods []string
	for _, m := range strings.Split(c.QueryParam("method"), ",") {
		if m = strings.TrimSpace(m); m != "" {
			methods = append(methods, m)
		}
	}
	if limit == 0 {
		rec, _, err := listSchemes(ctx, c.QueryParam("search"), methods, branchID, 0, 0)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessAll(c, rec)
	}
	rec, total, err := listSchemes(ctx, c.QueryParam("search"), methods, branchID, limit, offset)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessPage(c, page, limit, total, rec)
}

func ListActiveSchemes(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	branchID := auth.GetBranchScope(c)
	if limit == 0 {
		rec, _, err := listActive(ctx, c.QueryParam("search"), branchID, 0, 0)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessAll(c, rec)
	}
	rec, total, err := listActive(ctx, c.QueryParam("search"), branchID, limit, offset)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessPage(c, page, limit, total, rec)
}

func ListInactiveSchemes(c echo.Context) error {
	ctx := auth.RequestContext(c)
	rec, err := listInactive(ctx)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func GetSchemeById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := getScheme(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func UpdateScheme(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req schemeRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input := req.toInput()
	input.BranchID = auth.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := updateScheme(ctx, id, input, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func DeleteScheme(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	if err := deleteScheme(ctx, id, auth.GetBranchScope(c)); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Scheme deleted permanently")
}

func ToggleSchemeActive(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := toggleActive(ctx, id)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func CalculateScheme(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req calculateRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	result, err := calculateScheme(ctx, id, req.GoldWeight, req.GoldRate)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, result)
}

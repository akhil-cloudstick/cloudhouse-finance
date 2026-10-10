package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type purityStandardRequest struct {
	Karat           *int     `json:"karat"`
	FinenessPercent *float64 `json:"fineness_percent"`
	Label           string   `json:"label"`
}

type PurityStandardCreateInput struct {
	Karat           *int
	FinenessPercent *float64
	Label           string
}

func insertPurityStandard(ctx context.Context, p *commonModels.PurityStandard) error {
	return config.DB.
		WithContext(ctx).Create(p).Error
}

func findPurityStandards(ctx context.Context, query string) ([]commonModels.PurityStandard, error) {
	var list []commonModels.PurityStandard
	q := config.DB.
		WithContext(ctx).Where("is_active = ?", true).Order("karat DESC NULLS LAST, fineness_percent DESC NULLS LAST")
	if query != "" {
		q = q.Where("label ILIKE ?", "%"+query+"%")
	}
	err := q.Find(&list).Error
	return list, err
}

func findByKarat(ctx context.Context, karat int) (*commonModels.PurityStandard, error) {
	var p commonModels.PurityStandard
	if err := config.DB.
		WithContext(ctx).Where("karat = ? AND is_active = ?", karat, true).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func findByFineness(ctx context.Context, finenessPercent float64) (*commonModels.PurityStandard, error) {
	var p commonModels.PurityStandard
	if err := config.DB.
		WithContext(ctx).Where("ROUND(fineness_percent::numeric, 1) = ? AND is_active = ?", finenessPercent, true).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func ValidateKarat(karat int) error {
	if karat < 10 || karat > 24 {
		return NewBadRequest(fmt.Sprintf("karat must be between %d and %d", 10, 24))
	}
	return nil
}

func ValidateFineness(finenessPercent float64) error {
	if finenessPercent <= 0.0 || finenessPercent > 100.0 {
		return NewBadRequest(fmt.Sprintf("fineness%% must be greater than %.0f and at most %.0f", 0.0, 100.0))
	}
	return nil
}

func FinenessForKarat(karat int) float64 {
	return math.Round(float64(karat)/24*1000) / 10
}

func listPurityStandards(ctx context.Context, query string) ([]commonModels.PurityStandard, error) {
	return findPurityStandards(ctx, query)
}

func FindPurityStandardOrCreate(ctx context.Context, in PurityStandardCreateInput) (*commonModels.PurityStandard, bool, error) {
	if in.Karat == nil && in.FinenessPercent == nil {
		return nil, false, NewBadRequest("either karat or fineness_percent is required")
	}
	if in.Karat != nil {
		if err := ValidateKarat(*in.Karat); err != nil {
			return nil, false, err
		}
		existing, err := findByKarat(ctx, *in.Karat)
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
			existing, err := findByFineness(ctx, *in.FinenessPercent)
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
	rec := &commonModels.PurityStandard{Karat: in.Karat, FinenessPercent: in.FinenessPercent, Label: label, IsActive: true}
	if err := insertPurityStandard(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

func ListPurityStandards(c echo.Context) error {
	ctx := auth.RequestContext(c)
	rec, err := listPurityStandards(ctx, c.QueryParam("search"))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func CreatePurityStandard(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req purityStandardRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, created, err := FindPurityStandardOrCreate(ctx, PurityStandardCreateInput{Karat: req.Karat, FinenessPercent: req.FinenessPercent, Label: req.Label})
	if err != nil {
		return FailErr(c, err)
	}
	if created {
		return Success(c, http.StatusOK, rec)
	}
	return Success(c, http.StatusOK, rec)
}

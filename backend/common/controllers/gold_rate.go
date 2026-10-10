package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type publishRequest struct {
	Date  string          `json:"date"`
	Karat int             `json:"karat"`
	Rate  float64         `json:"rate"`
	K24   float64         `json:"k24"`
	SetBy string          `json:"set_by" binding:"required"`
	Rates map[int]float64 `json:"rates"`
}

type PublishInput struct {
	Date  time.Time
	Karat int
	Rate  float64
	SetBy string
	Rates map[int]float64
}

func (req publishRequest) toInput() (PublishInput, error) {
	var date time.Time
	if req.Date != "" {
		parsed, err := time.Parse("2006-01-02", req.Date)
		if err != nil {
			return PublishInput{}, NewBadRequest("invalid date: expected YYYY-MM-DD")
		}
		date = parsed
	}
	if len(req.Rates) > 0 {
		return PublishInput{Date: date, Rates: req.Rates, SetBy: req.SetBy}, nil
	}
	karat := req.Karat
	rate := req.Rate
	if karat == 0 {
		karat = 24
	}
	if rate == 0 {
		rate = req.K24
	}
	return PublishInput{Date: date, Karat: karat, Rate: rate, SetBy: req.SetBy}, nil
}

func insertGoldRate(ctx context.Context, g *commonModels.GoldRate) error {
	return config.DB.
		WithContext(ctx).Create(g).Error
}

func FindGoldRates(ctx context.Context, limit, offset int) ([]commonModels.GoldRate, int64, error) {
	var rates []commonModels.GoldRate
	q := config.DB.
		WithContext(ctx).Order("CAST(date AS DATE) desc, id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&commonModels.GoldRate{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rates).Error
	return rates, total, err
}

func FindLatest(ctx context.Context) (*commonModels.GoldRate, error) {
	var g commonModels.GoldRate
	if err := config.DB.
		WithContext(ctx).Order("CAST(date AS DATE) desc, id desc").First(&g).Error; err != nil {
		return nil, err
	}
	return &g, nil
}

func findGoldRateByID(ctx context.Context, id uint) (*commonModels.GoldRate, error) {
	var g commonModels.GoldRate
	if err := config.DB.
		WithContext(ctx).First(&g, id).Error; err != nil {
		return nil, err
	}
	return &g, nil
}

func goldRateValidate(in PublishInput) error {
	if len(in.Rates) > 0 {
		for k, r := range in.Rates {
			if k != 24 && k != 22 && k != 18 {
				return NewBadRequest("karat must be 24, 22, or 18")
			}
			if r <= 0 {
				return NewBadRequest("rate must be greater than zero")
			}
		}
		if in.SetBy == "" {
			return NewBadRequest("set_by is required")
		}
		return nil
	}
	if in.Karat != 24 && in.Karat != 22 && in.Karat != 18 {
		return NewBadRequest("karat must be 24, 22, or 18")
	}
	if in.Rate <= 0 {
		return NewBadRequest("rate must be greater than zero")
	}
	if in.SetBy == "" {
		return NewBadRequest("set_by is required")
	}
	return nil
}

func SaveGoldRate(ctx context.Context, in PublishInput) (*commonModels.GoldRate, error) {
	if err := goldRateValidate(in); err != nil {
		return nil, err
	}
	date := in.Date
	if date.IsZero() {
		date = time.Now()
	}
	rec := &commonModels.GoldRate{
		Date:  date,
		SetBy: in.SetBy,
	}
	if prev, err := FindLatest(ctx); err == nil {
		rec.K24, rec.K22, rec.K18 = prev.K24, prev.K22, prev.K18
	}
	if len(in.Rates) > 0 {
		if r, ok := in.Rates[24]; ok {
			rec.K24 = r
		}
		if r, ok := in.Rates[22]; ok {
			rec.K22 = r
		}
		if r, ok := in.Rates[18]; ok {
			rec.K18 = r
		}
	} else {
		switch in.Karat {
		case 24:
			rec.K24 = in.Rate
		case 22:
			rec.K22 = in.Rate
		case 18:
			rec.K18 = in.Rate
		}
	}
	if err := insertGoldRate(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func listGoldRates(ctx context.Context, limit, offset int) ([]commonModels.GoldRate, int64, error) {
	return FindGoldRates(ctx, limit, offset)
}

func LatestGoldRate(ctx context.Context) (*commonModels.GoldRate, error) {
	rec, err := FindLatest(ctx)
	if err != nil {
		return nil, NewNotFound("gold rate not found")
	}
	return rec, nil
}

func getGoldRate(ctx context.Context, id uint) (*commonModels.GoldRate, error) {
	rec, err := findGoldRateByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("gold rate not found")
	}
	return rec, nil
}

func PublishGoldRate(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req publishRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input, err := req.toInput()
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := SaveGoldRate(ctx, input)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func ListGoldRates(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	if limit > 0 {
		rec, total, err := listGoldRates(ctx, limit, offset)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := listGoldRates(ctx, 0, 0)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessAll(c, rec)
}

func GetLatestGoldRate(c echo.Context) error {
	ctx := auth.RequestContext(c)
	rec, err := LatestGoldRate(ctx)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func GetGoldRateById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := getGoldRate(ctx, id)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

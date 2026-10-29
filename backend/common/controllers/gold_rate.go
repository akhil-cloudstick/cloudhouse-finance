package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"net/http"
	"strings"
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
	Date        time.Time
	Karat       int
	Rate        float64
	SetBy       string
	Designation string
	Rates       map[int]float64
}

// GoldRateDay is one calendar day of rate history: the day's newest rate, plus every change made that day (newest first).
type GoldRateDay struct {
	commonModels.GoldRate
	Entries []commonModels.GoldRate `json:"entries"`
}

type goldRateDayRow struct {
	commonModels.GoldRate
	DayKey time.Time `gorm:"column:day_key"`
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
		Date:             date,
		SetBy:            in.SetBy,
		SetByDesignation: in.Designation,
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

// findGoldRateDays pages over calendar days (not rows), optionally narrowed to a from / to range of days, newest day first.
func findGoldRateDays(ctx context.Context, from, to, search string, limit, offset int) ([]GoldRateDay, int64, error) {
	base := func() *gorm.DB {
		q := config.DB.WithContext(ctx).Model(&commonModels.GoldRate{})
		if from != "" {
			q = q.Where("CAST(date AS DATE) >= ?", from)
		}
		if to != "" {
			q = q.Where("CAST(date AS DATE) <= ?", to)
		}
		// A day is listed when any of its rates matches: its date (as stored or as shown), a rate, or who set it.
		q = ApplySearch(q, search, "CAST(date AS DATE)", "to_char(date, 'DD-MM-YYYY')", "to_char(date, 'DD/MM/YYYY')", "k24", "k22", "k18", "set_by")
		return q
	}
	var total int64
	if err := base().Distinct("CAST(date AS DATE)").Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var days []time.Time
	dq := base().Select("DISTINCT CAST(date AS DATE) AS d").Order("d desc")
	if limit > 0 {
		dq = dq.Limit(limit).Offset(offset)
	}
	if err := dq.Scan(&days).Error; err != nil {
		return nil, 0, err
	}
	if len(days) == 0 {
		return []GoldRateDay{}, total, nil
	}
	var rows []goldRateDayRow
	err := config.DB.WithContext(ctx).Model(&commonModels.GoldRate{}).
		Select("gold_rates.*, CAST(date AS DATE) AS day_key").
		Where("CAST(date AS DATE) IN ?", days).
		Order("CAST(date AS DATE) desc, id desc").
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	out := make([]GoldRateDay, 0, len(days))
	idx := map[string]int{}
	for _, r := range rows {
		k := r.DayKey.Format("2006-01-02")
		i, ok := idx[k]
		if !ok {
			// rows are newest-first, so a day's first row is its newest rate
			out = append(out, GoldRateDay{GoldRate: r.GoldRate})
			i = len(out) - 1
			idx[k] = i
		}
		out[i].Entries = append(out[i].Entries, r.GoldRate)
	}
	return out, total, nil
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
	// the setter's designation is their role from the token, never a client-sent value
	_, input.Designation, _ = auth.ActorFromContext(c)
	rec, err := SaveGoldRate(ctx, input)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func ListGoldRates(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	if c.QueryParam("group") == "day" {
		from, to := c.QueryParam("from"), c.QueryParam("to")
		if day := c.QueryParam("date"); day != "" {
			from, to = day, day
		}
		for _, d := range []string{from, to} {
			if d == "" {
				continue
			}
			if _, err := time.Parse("2006-01-02", d); err != nil {
				return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid date: expected YYYY-MM-DD"})
			}
		}
		rec, total, err := findGoldRateDays(ctx, from, to, strings.TrimSpace(c.QueryParam("search")), limit, offset)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessPage(c, page, limit, total, rec)
	}
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

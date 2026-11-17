package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// The Day Book is kept by hand: each line is a date, its particulars and a debit, credit and/or
// interest amount that staff type in. Unlike the cash ledger it reads nothing from the other
// modules and moves no balance.

const dayBookParticularsMax = 255

type dayBookRequest struct {
	Date        string  `json:"date"`
	Particulars string  `json:"particulars"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Interest    float64 `json:"interest"`
}

// dayBookInput checks a request and returns the values to store.
func dayBookInput(req dayBookRequest) (time.Time, string, error) {
	date, err := time.Parse("2006-01-02", strings.TrimSpace(req.Date))
	if err != nil {
		return time.Time{}, "", common.NewBadRequest("date is required")
	}
	// A day of slack: the server clock may still be on yesterday where the business already is on today.
	if date.After(time.Now().AddDate(0, 0, 1)) {
		return time.Time{}, "", common.NewBadRequest("date cannot be in the future")
	}
	particulars := strings.TrimSpace(req.Particulars)
	if particulars == "" {
		return time.Time{}, "", common.NewBadRequest("particulars are required")
	}
	if len([]rune(particulars)) > dayBookParticularsMax {
		return time.Time{}, "", common.NewBadRequest(fmt.Sprintf("particulars can be at most %d characters", dayBookParticularsMax))
	}
	if req.Debit < 0 || req.Credit < 0 || req.Interest < 0 {
		return time.Time{}, "", common.NewBadRequest("amounts cannot be negative")
	}
	if req.Debit == 0 && req.Credit == 0 && req.Interest == 0 {
		return time.Time{}, "", common.NewBadRequest("enter a debit, credit or interest amount")
	}
	return date, particulars, nil
}

func dayBookRow(e models.DayBookEntry) models.DayBookRow {
	return models.DayBookRow{
		ID: e.ID, Date: e.EntryDate.Format("2006-01-02"), Particulars: e.Particulars,
		Debit: e.Debit, Credit: e.Credit, Interest: e.Interest,
	}
}

// dayBook is every entry of the period, oldest first, with the period's totals.
func dayBook(ctx context.Context, f models.Filter) ([]models.DayBookRow, models.DayBookTotals, error) {
	from, to := dateRange(f)
	q := config.DB.WithContext(ctx).Model(&models.DayBookEntry{}).
		Where("entry_date >= ? AND entry_date < ?", from.Format("2006-01-02"), to.Format("2006-01-02"))
	if len(f.BranchIDs) > 0 {
		q = q.Where("branch_id IN ?", f.BranchIDs)
	}
	var entries []models.DayBookEntry
	if err := q.Order("entry_date asc, id asc").Limit(reportExportMaxRows + 1).Find(&entries).Error; err != nil {
		return nil, models.DayBookTotals{}, err
	}
	if len(entries) > reportExportMaxRows {
		return nil, models.DayBookTotals{}, common.NewBadRequest(fmt.Sprintf("the day book has more than %d entries in the chosen period — choose a shorter date range", reportExportMaxRows))
	}
	rows := make([]models.DayBookRow, 0, len(entries))
	var totals models.DayBookTotals
	for _, e := range entries {
		rows = append(rows, dayBookRow(e))
		totals.Debit += e.Debit
		totals.Credit += e.Credit
		totals.Interest += e.Interest
	}
	totals.Debit = common.RoundDecimal2(totals.Debit)
	totals.Credit = common.RoundDecimal2(totals.Credit)
	totals.Interest = common.RoundDecimal2(totals.Interest)
	return rows, totals, nil
}

// dayBookBranch is the branch a new entry is written under: the caller's own, the one they have
// selected, or else Head Office.
func dayBookBranch(c echo.Context) (*uint, error) {
	if id := auth.EnforceBranchOnWrite(c, 0); id != 0 {
		return &id, nil
	}
	ho, err := common.FindHeadOffice(auth.RequestContext(c))
	if err != nil {
		return nil, err
	}
	return &ho.ID, nil
}

// findDayBookEntry loads an entry the caller may see (inside their branch scope).
func findDayBookEntry(c echo.Context, id uint) (*models.DayBookEntry, error) {
	var e models.DayBookEntry
	if err := config.DB.WithContext(auth.RequestContext(c)).First(&e, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewNotFound("day book entry not found")
		}
		return nil, err
	}
	if scope := auth.GetBranchScope(c); scope != nil && (e.BranchID == nil || *e.BranchID != *scope) {
		return nil, common.NewNotFound("day book entry not found")
	}
	return &e, nil
}

// DayBookReport returns every entry of the period at once (no paging), with the totals.
func DayBookReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := dayBook(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, models.Result{Rows: rows, Totals: totals, TotalCount: len(rows)})
}

func CreateDayBookEntry(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req dayBookRequest
	if err := common.BindJSON(c, &req); err != nil {
		return common.FailErr(c, common.NewBadRequest("Invalid input"))
	}
	date, particulars, err := dayBookInput(req)
	if err != nil {
		return common.FailErr(c, err)
	}
	branchID, err := dayBookBranch(c)
	if err != nil {
		return common.FailErr(c, err)
	}
	in := DayBookInput{Date: date, Particulars: particulars, Debit: req.Debit, Credit: req.Credit, Interest: req.Interest, BranchID: branchID}
	if employeeID, _, _ := auth.ActorFromContext(c); employeeID != 0 {
		in.CreatedByEmployeeID = &employeeID
	}
	e, err := SaveDayBookEntry(ctx, in)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, dayBookRow(*e))
}

// DayBookInput is a new Day Book line, already checked (see dayBookInput).
type DayBookInput struct {
	Date                time.Time
	Particulars         string
	Debit               float64
	Credit              float64
	Interest            float64
	BranchID            *uint
	CreatedByEmployeeID *uint
}

// SaveDayBookEntry stores a new Day Book line (also used by the demo seed).
func SaveDayBookEntry(ctx context.Context, in DayBookInput) (*models.DayBookEntry, error) {
	e := models.DayBookEntry{
		BranchID: in.BranchID, EntryDate: in.Date, Particulars: in.Particulars,
		Debit: common.RoundDecimal2(in.Debit), Credit: common.RoundDecimal2(in.Credit), Interest: common.RoundDecimal2(in.Interest),
		CreatedByEmployeeID: in.CreatedByEmployeeID,
	}
	if err := config.DB.WithContext(ctx).Create(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func UpdateDayBookEntry(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req dayBookRequest
	if err := common.BindJSON(c, &req); err != nil {
		return common.FailErr(c, common.NewBadRequest("Invalid input"))
	}
	date, particulars, err := dayBookInput(req)
	if err != nil {
		return common.FailErr(c, err)
	}
	e, err := findDayBookEntry(c, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	e.EntryDate, e.Particulars = date, particulars
	e.Debit, e.Credit, e.Interest = common.RoundDecimal2(req.Debit), common.RoundDecimal2(req.Credit), common.RoundDecimal2(req.Interest)
	if err := config.DB.WithContext(ctx).Save(e).Error; err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, dayBookRow(*e))
}

func DeleteDayBookEntry(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	e, err := findDayBookEntry(c, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := config.DB.WithContext(ctx).Delete(e).Error; err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessMessage(c, http.StatusOK, "Day book entry deleted")
}

// exportDayBook writes the period's entries as a spreadsheet or PDF, closing with the totals.
func exportDayBook(c echo.Context, f models.Filter, format string) {
	ctx := auth.RequestContext(c)
	rows, totals, err := dayBook(ctx, f)
	if err != nil {
		reportError(c, err)
		return
	}
	money := func(v float64) string {
		if v == 0 {
			return ""
		}
		return fmt.Sprintf("%.2f", v)
	}
	headers := []string{"Date", "Particulars", "Debit", "Credit", "Interest"}
	data := make([][]string, 0, len(rows)+1)
	for _, r := range rows {
		date := r.Date
		if t, err := time.Parse("2006-01-02", r.Date); err == nil {
			date = t.Format("02-01-2006")
		}
		data = append(data, []string{date, r.Particulars, money(r.Debit), money(r.Credit), money(r.Interest)})
	}
	data = append(data, []string{"", "Total", money(totals.Debit), money(totals.Credit), money(totals.Interest)})
	const key = "day-book"
	filename := fmt.Sprintf("%s-%s.%s", key, time.Now().Format("20060102-150405"), format)
	switch format {
	case "xlsx":
		buf, err := BuildXLSX(key, headers, data)
		if err != nil {
			reportError(c, err)
			return
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := BuildPDF(businessName(ctx), "Day Book", headers, data)
		if err != nil {
			reportError(c, err)
			return
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
}

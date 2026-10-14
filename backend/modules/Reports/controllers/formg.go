package controllers

import (
	"bytes"
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/jung-kurt/gofpdf"
	"github.com/labstack/echo/v4"
	"github.com/xuri/excelize/v2"
)

const formGLenderAddress = ""

type FormGBranch struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type FormGLoanCategory struct {
	Label   string  `json:"label"`
	Persons int     `json:"persons"`
	Amount  float64 `json:"amount"`
	Remarks string  `json:"remarks"`
}

type FormGDeposits struct {
	OpeningCount  int     `json:"opening_count"`
	OpeningAmount float64 `json:"opening_amount"`
	DuringCount   int     `json:"during_count"`
	DuringAmount  float64 `json:"during_amount"`
	RepaidCount   int     `json:"repaid_count"`
	RepaidAmount  float64 `json:"repaid_amount"`
	ClosingCount  int     `json:"closing_count"`
	ClosingAmount float64 `json:"closing_amount"`
}

type FormGFinancialPosition struct {
	MaxOutstanding              float64    `json:"max_outstanding"`
	MaxOutstandingDate          *time.Time `json:"max_outstanding_date,omitempty"`
	AssetsValue                 float64    `json:"assets_value"`
	LiabilitiesValue            float64    `json:"liabilities_value"`
	ExcessAssetsOverLiabilities float64    `json:"excess_assets_over_liabilities"`
	ExcessLiabilitiesOverAssets float64    `json:"excess_liabilities_over_assets"`
}

type FormGStatement struct {
	PeriodLabel   string                 `json:"period_label"`
	LenderName    string                 `json:"lender_name"`
	LenderAddress string                 `json:"lender_address"`
	Branches      []FormGBranch          `json:"branches"`
	Section1      []FormGLoanCategory    `json:"section1_advanced"`
	Section2      []FormGLoanCategory    `json:"section2_redeemed"`
	Section3      FormGDeposits          `json:"section3_deposits"`
	Section4      FormGFinancialPosition `json:"section4_financial_position"`
}

type FormGOverrides struct {
	DepositOpeningCount  int
	DepositOpeningAmount float64
	DepositDuringCount   int
	DepositDuringAmount  float64
	DepositRepaidCount   int
	DepositRepaidAmount  float64
	DepositClosingCount  int
	DepositClosingAmount float64
	AssetsValue          float64
	LiabilitiesValue     float64
}

type loanMovementAgg struct {
	Persons int
	Amount  float64
}

type balanceEvent struct {
	Day   time.Time
	Delta float64
}

type loanSpan struct {
	OpenedDate time.Time
	ClosedDate *time.Time
	Principal  float64
}

func singleBranch(ctx context.Context) bool {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return false
	}
	t, err := common.FindTenantByID(ctx, id)
	return err == nil && t.SingleBranch
}

func formGLenderParticulars(ctx context.Context) (name, address string) {
	name, address = "CloudHouse Finance (MLL No. DEMO-0000000000)", formGLenderAddress
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return name, address
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return name, address
	}
	if t.LegalName != "" {
		name = t.LegalName
		if t.KMLRegNo != "" {
			name = fmt.Sprintf("%s (MLL No. %s)", t.LegalName, t.KMLRegNo)
		}
	}
	if t.AddressLine != "" {
		address = common.NormalizeLineBreaks(t.AddressLine)
	}
	return name, address
}

func formGPeriodLabel(f models.Filter) string {
	if f.From == nil || f.To == nil {
		return "Period: all available data"
	}
	days := f.To.Sub(*f.From).Hours() / 24
	const layout = "02/01/2006"
	switch {
	case days >= 350 && days <= 380:
		return fmt.Sprintf("Year ending %s", f.To.Format(layout))
	case days >= 80 && days <= 100:
		return fmt.Sprintf("Quarter ending %s", f.To.Format(layout))
	default:
		return fmt.Sprintf("Period %s to %s", f.From.Format(layout), f.To.Format(layout))
	}
}

func goldLoansAdvanced(ctx context.Context, f models.Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := config.DB.
		WithContext(ctx).Table("loans").
		Select("COUNT(DISTINCT customer_id) as persons, COALESCE(SUM(principal_amount),0) as amount").
		Where("opened_date >= ? AND opened_date < ?", from, to).
		Where("approval_stage = ?", "Approved").
		Where("deleted_at IS NULL")
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	err := q.Scan(&out).Error
	return out, err
}

func personalLoansAdvanced(ctx context.Context, f models.Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := config.DB.
		WithContext(ctx).Table("personal_loans").
		Select("COUNT(DISTINCT customer_id) as persons, COALESCE(SUM(principal_amount),0) as amount").
		Where("opened_date >= ? AND opened_date < ?", from, to).
		// A loan still awaiting (or refused) approval never disbursed anything.
		Where("status NOT IN ?", []string{"Pending Approval", "Rejected"}).
		Where("deleted_at IS NULL")
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	err := q.Scan(&out).Error
	return out, err
}

func goldLoansRedeemed(ctx context.Context, f models.Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := config.DB.
		WithContext(ctx).Table("loans").
		Select("COUNT(DISTINCT customer_id) as persons, COALESCE(SUM(principal_amount),0) as amount").
		Where("status = ?", "Closed").
		Where("updated_at >= ? AND updated_at < ?", from, to).
		Where("deleted_at IS NULL")
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	err := q.Scan(&out).Error
	return out, err
}

func personalLoansRedeemed(ctx context.Context, f models.Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := config.DB.
		WithContext(ctx).Table("personal_loans").
		Select("COUNT(DISTINCT customer_id) as persons, COALESCE(SUM(principal_amount),0) as amount").
		Where("status = ?", "Closed").
		Where("closed_at >= ? AND closed_at < ?", from, to).
		Where("deleted_at IS NULL")
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	err := q.Scan(&out).Error
	return out, err
}

func truncDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func maxOutstandingInPeriod(spans []loanSpan, from, to time.Time) (peak float64, peakDate *time.Time) {
	if len(spans) == 0 {
		return 0, nil
	}
	events := make([]balanceEvent, 0, len(spans)*2)
	for _, sp := range spans {
		start := sp.OpenedDate
		if start.Before(from) {
			start = from
		}
		events = append(events, balanceEvent{Day: truncDay(start), Delta: sp.Principal})
		if sp.ClosedDate != nil && !sp.ClosedDate.After(to) {
			events = append(events, balanceEvent{Day: truncDay(*sp.ClosedDate), Delta: -sp.Principal})
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].Day.Before(events[j].Day) })
	running := 0.0
	for i := 0; i < len(events); {
		day := events[i].Day
		for i < len(events) && events[i].Day.Equal(day) {
			running += events[i].Delta
			i++
		}
		if running > peak {
			peak = running
			d := day
			peakDate = &d
		}
	}
	return peak, peakDate
}

func loanSpansForMaxOutstanding(ctx context.Context, f models.Filter, from, to time.Time) ([]loanSpan, error) {
	var spans []loanSpan
	type goldRow struct {
		OpenedDate      time.Time
		PrincipalAmount float64
		Status          string
		UpdatedAt       time.Time
	}
	var goldRows []goldRow
	gq := config.DB.
		WithContext(ctx).Table("loans").
		Select("opened_date, principal_amount, status, updated_at").
		Where("opened_date < ?", to).
		Where("status <> ? OR updated_at >= ?", "Closed", from).
		Where("deleted_at IS NULL")
	if f.BranchID != nil {
		gq = gq.Where("branch_id = ?", *f.BranchID)
	}
	if err := gq.Scan(&goldRows).Error; err != nil {
		return nil, err
	}
	for _, r := range goldRows {
		sp := loanSpan{OpenedDate: r.OpenedDate, Principal: r.PrincipalAmount}
		if r.Status == "Closed" {
			d := r.UpdatedAt
			sp.ClosedDate = &d
		}
		spans = append(spans, sp)
	}
	type personalRow struct {
		OpenedDate      time.Time
		PrincipalAmount float64
		Status          string
		ClosedAt        *time.Time
	}
	var personalRows []personalRow
	pq := config.DB.
		WithContext(ctx).Table("personal_loans").
		Select("opened_date, principal_amount, status, closed_at").
		Where("opened_date < ?", to).
		Where("status <> ? OR closed_at IS NULL OR closed_at >= ?", "Closed", from).
		Where("status NOT IN ?", []string{"Pending Approval", "Rejected"}).
		Where("deleted_at IS NULL")
	if f.BranchID != nil {
		pq = pq.Where("branch_id = ?", *f.BranchID)
	}
	if err := pq.Scan(&personalRows).Error; err != nil {
		return nil, err
	}
	for _, r := range personalRows {
		spans = append(spans, loanSpan{OpenedDate: r.OpenedDate, ClosedDate: r.ClosedAt, Principal: r.PrincipalAmount})
	}
	return spans, nil
}

func formGBranches(ctx context.Context, f models.Filter) ([]FormGBranch, error) {
	if singleBranch(ctx) {
		return nil, nil
	}
	var out []FormGBranch
	q := config.DB.
		WithContext(ctx).Table("branches").Select("name, address").Where("deleted_at IS NULL")
	if f.BranchID != nil {
		q = q.Where("id = ?", *f.BranchID)
	} else {
		q = q.Where("is_active = ?", true)
	}
	err := q.Order("name").Scan(&out).Error
	return out, err
}

func buildFormGStatement(ctx context.Context, f models.Filter, overrides FormGOverrides) (*FormGStatement, error) {
	from, to := dateRange(f)
	branches, err := formGBranches(ctx, f)
	if err != nil {
		return nil, err
	}
	goldAdv, err := goldLoansAdvanced(ctx, f, from, to)
	if err != nil {
		return nil, err
	}
	personalAdv, err := personalLoansAdvanced(ctx, f, from, to)
	if err != nil {
		return nil, err
	}
	goldRed, err := goldLoansRedeemed(ctx, f, from, to)
	if err != nil {
		return nil, err
	}
	personalRed, err := personalLoansRedeemed(ctx, f, from, to)
	if err != nil {
		return nil, err
	}
	spans, err := loanSpansForMaxOutstanding(ctx, f, from, to)
	if err != nil {
		return nil, err
	}
	peak, peakDate := maxOutstandingInPeriod(spans, from, to)
	assets := overrides.AssetsValue
	liabilities := overrides.LiabilitiesValue
	excessAssets, excessLiabilities := 0.0, 0.0
	if diff := assets - liabilities; diff >= 0 {
		excessAssets = diff
	} else {
		excessLiabilities = -diff
	}
	lenderName, lenderAddress := formGLenderParticulars(ctx)
	stmt := &FormGStatement{
		PeriodLabel:   formGPeriodLabel(f),
		LenderName:    lenderName,
		LenderAddress: lenderAddress,
		Branches:      branches,
		Section1: []FormGLoanCategory{
			{Label: "Against security of gold or gold ornaments", Persons: goldAdv.Persons, Amount: goldAdv.Amount},
			{Label: "Against Promissory Notes", Persons: personalAdv.Persons, Amount: personalAdv.Amount},
			{Label: "Against fixed assets", Persons: 0, Amount: 0},
			{Label: "Against other forms of security", Persons: 0, Amount: 0},
		},
		Section2: []FormGLoanCategory{
			{Label: "Against security of gold or gold ornaments", Persons: goldRed.Persons, Amount: goldRed.Amount},
			{Label: "Against Promissory Notes", Persons: personalRed.Persons, Amount: personalRed.Amount},
			{Label: "Against fixed assets", Persons: 0, Amount: 0},
			{Label: "Against other forms of security", Persons: 0, Amount: 0},
		},
		Section3: FormGDeposits{
			OpeningCount: overrides.DepositOpeningCount, OpeningAmount: overrides.DepositOpeningAmount,
			DuringCount: overrides.DepositDuringCount, DuringAmount: overrides.DepositDuringAmount,
			RepaidCount: overrides.DepositRepaidCount, RepaidAmount: overrides.DepositRepaidAmount,
			ClosingCount: overrides.DepositClosingCount, ClosingAmount: overrides.DepositClosingAmount,
		},
		Section4: FormGFinancialPosition{
			MaxOutstanding:              peak,
			MaxOutstandingDate:          peakDate,
			AssetsValue:                 assets,
			LiabilitiesValue:            liabilities,
			ExcessAssetsOverLiabilities: excessAssets,
			ExcessLiabilitiesOverAssets: excessLiabilities,
		},
	}
	return stmt, nil
}

func buildFormGXLSX(stmt *FormGStatement) ([]byte, error) {
	f := excelize.NewFile()
	sheet := "Form G"
	f.SetSheetName(f.GetSheetName(0), sheet)
	f.SetColWidth(sheet, "A", "A", 42)
	f.SetColWidth(sheet, "B", "D", 22)
	titleStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14}})
	sectionStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 11}, Fill: excelize.Fill{Type: "pattern", Color: []string{"#F0E6D2"}, Pattern: 1}})
	headerStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}, Border: []excelize.Border{
		{Type: "top", Color: "#000000", Style: 1}, {Type: "bottom", Color: "#000000", Style: 1},
		{Type: "left", Color: "#000000", Style: 1}, {Type: "right", Color: "#000000", Style: 1},
	}})
	cellStyle, _ := f.NewStyle(&excelize.Style{Border: []excelize.Border{
		{Type: "top", Color: "#000000", Style: 1}, {Type: "bottom", Color: "#000000", Style: 1},
		{Type: "left", Color: "#000000", Style: 1}, {Type: "right", Color: "#000000", Style: 1},
	}})
	row := 1
	setTitle := func(v string) {
		f.SetCellValue(sheet, fmt.Sprintf("A%d", row), v)
		f.SetCellStyle(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("A%d", row), titleStyle)
		row++
	}
	setKV := func(k, v string) {
		f.SetCellValue(sheet, fmt.Sprintf("A%d", row), k)
		f.SetCellValue(sheet, fmt.Sprintf("B%d", row), v)
		row++
	}
	setSection := func(v string) {
		row++
		f.SetCellValue(sheet, fmt.Sprintf("A%d", row), v)
		f.SetCellStyle(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("D%d", row), sectionStyle)
		f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("D%d", row))
		row++
	}
	setTitle("FORM G — Statement of Accounts (Kerala Money-Lenders Rules, 1964 — Rule 15(3))")
	setKV("Reporting period", stmt.PeriodLabel)
	setKV("Name of money-lender", stmt.LenderName)
	setKV("Postal address", stmt.LenderAddress)
	for _, b := range stmt.Branches {
		setKV("Branch", fmt.Sprintf("%s — %s", b.Name, b.Address))
	}
	writeLoanTable := func(title string, rows []FormGLoanCategory) {
		setSection(title)
		headers := []string{"Nature/Name of Loan", "No. of persons advanced to", "Amount (Rs.)", "Remarks"}
		for i, h := range headers {
			cell, _ := excelize.CoordinatesToCellName(i+1, row)
			f.SetCellValue(sheet, cell, h)
			f.SetCellStyle(sheet, cell, cell, headerStyle)
		}
		row++
		for _, r := range rows {
			vals := []string{r.Label, fmt.Sprintf("%d", r.Persons), fmt.Sprintf("%.2f", r.Amount), r.Remarks}
			for i, v := range vals {
				cell, _ := excelize.CoordinatesToCellName(i+1, row)
				f.SetCellValue(sheet, cell, v)
				f.SetCellStyle(sheet, cell, cell, cellStyle)
			}
			row++
		}
	}
	writeLoanTable("SECTION 1: PARTICULARS OF LOANS ADVANCED", stmt.Section1)
	writeLoanTable("SECTION 2: PARTICULARS OF LOANS REDEEMED / RECEIVED BACK", stmt.Section2)
	setSection("SECTION 3: PARTICULARS OF DEPOSITS RECEIVED (manually entered — see report notes)")
	setKV("Outstanding at beginning of period — count / amount", fmt.Sprintf("%d / %.2f", stmt.Section3.OpeningCount, stmt.Section3.OpeningAmount))
	setKV("Received during period — count / amount", fmt.Sprintf("%d / %.2f", stmt.Section3.DuringCount, stmt.Section3.DuringAmount))
	setKV("Repaid during period — count / amount", fmt.Sprintf("%d / %.2f", stmt.Section3.RepaidCount, stmt.Section3.RepaidAmount))
	setKV("Outstanding at end of period — count / amount", fmt.Sprintf("%d / %.2f", stmt.Section3.ClosingCount, stmt.Section3.ClosingAmount))
	setSection("SECTION 4: FINANCIAL POSITION")
	maxDate := "—"
	if stmt.Section4.MaxOutstandingDate != nil {
		maxDate = stmt.Section4.MaxOutstandingDate.Format("02/01/2006")
	}
	setKV("Maximum amount outstanding on any day", fmt.Sprintf("%.2f", stmt.Section4.MaxOutstanding))
	setKV("Date on which maximum amount was outstanding", maxDate)
	setKV("Value of assets at end of period (manually entered)", fmt.Sprintf("%.2f", stmt.Section4.AssetsValue))
	setKV("Total liabilities outstanding at end of period (manually entered)", fmt.Sprintf("%.2f", stmt.Section4.LiabilitiesValue))
	setKV("Excess of assets over liabilities", fmt.Sprintf("%.2f", stmt.Section4.ExcessAssetsOverLiabilities))
	setKV("Excess of liabilities over assets", fmt.Sprintf("%.2f", stmt.Section4.ExcessLiabilitiesOverAssets))
	setSection("DECLARATION")
	setKV("", "I hereby declare that the information furnished in the above statement is true and correct to the best of my knowledge and belief.")
	setKV("Place", "")
	setKV("Date", "")
	setKV("Name", "")
	setKV("Signature", "")
	setKV("Status (Proprietor/Partner/Manager)", "")
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func buildFormGPDF(stmt *FormGStatement) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 14)
	pdf.MultiCell(0, 8, tr(stmt.LenderName+" — FORM G: Statement of Accounts (Kerala Money-Lenders Rules, 1964 — Rule 15(3))"), "", "L", false)
	pdf.Ln(2)
	kv := func(k, v string) {
		pdf.SetFont("Arial", "B", 9)
		pdf.CellFormat(75, 6, tr(k), "", 0, "L", false, 0, "")
		pdf.SetFont("Arial", "", 9)
		pdf.MultiCell(0, 6, tr(v), "", "L", false)
	}
	section := func(title string) {
		pdf.Ln(2)
		pdf.SetFont("Arial", "B", 11)
		pdf.SetFillColor(240, 230, 210)
		pdf.CellFormat(0, 7, tr(title), "", 1, "L", true, 0, "")
	}
	loanTable := func(rows []FormGLoanCategory) {
		pdf.SetFont("Arial", "B", 8)
		widths := []float64{80, 35, 35, 40}
		headers := []string{"Nature/Name of Loan", "No. of persons", "Amount (Rs.)", "Remarks"}
		for i, h := range headers {
			pdf.CellFormat(widths[i], 7, tr(h), "1", 0, "L", false, 0, "")
		}
		pdf.Ln(-1)
		pdf.SetFont("Arial", "", 8)
		for _, r := range rows {
			pdf.CellFormat(widths[0], 6, tr(r.Label), "1", 0, "L", false, 0, "")
			pdf.CellFormat(widths[1], 6, tr(fmt.Sprintf("%d", r.Persons)), "1", 0, "R", false, 0, "")
			pdf.CellFormat(widths[2], 6, tr(fmt.Sprintf("%.2f", r.Amount)), "1", 0, "R", false, 0, "")
			pdf.CellFormat(widths[3], 6, tr(r.Remarks), "1", 0, "L", false, 0, "")
			pdf.Ln(-1)
		}
	}
	kv("Reporting period:", stmt.PeriodLabel)
	kv("Name of money-lender:", stmt.LenderName)
	kv("Postal address:", stmt.LenderAddress)
	for _, b := range stmt.Branches {
		kv("Branch:", fmt.Sprintf("%s — %s", b.Name, b.Address))
	}
	section("SECTION 1: PARTICULARS OF LOANS ADVANCED")
	loanTable(stmt.Section1)
	section("SECTION 2: PARTICULARS OF LOANS REDEEMED / RECEIVED BACK")
	loanTable(stmt.Section2)
	section("SECTION 3: PARTICULARS OF DEPOSITS RECEIVED (manually entered)")
	kv("Outstanding at beginning — count/amount:", fmt.Sprintf("%d / %.2f", stmt.Section3.OpeningCount, stmt.Section3.OpeningAmount))
	kv("Received during period — count/amount:", fmt.Sprintf("%d / %.2f", stmt.Section3.DuringCount, stmt.Section3.DuringAmount))
	kv("Repaid during period — count/amount:", fmt.Sprintf("%d / %.2f", stmt.Section3.RepaidCount, stmt.Section3.RepaidAmount))
	kv("Outstanding at end — count/amount:", fmt.Sprintf("%d / %.2f", stmt.Section3.ClosingCount, stmt.Section3.ClosingAmount))
	section("SECTION 4: FINANCIAL POSITION")
	maxDate := "—"
	if stmt.Section4.MaxOutstandingDate != nil {
		maxDate = stmt.Section4.MaxOutstandingDate.Format("02/01/2006")
	}
	kv("Maximum amount outstanding on any day:", fmt.Sprintf("%.2f", stmt.Section4.MaxOutstanding))
	kv("Date of maximum outstanding amount:", maxDate)
	kv("Value of assets at end of period (manual):", fmt.Sprintf("%.2f", stmt.Section4.AssetsValue))
	kv("Total liabilities at end of period (manual):", fmt.Sprintf("%.2f", stmt.Section4.LiabilitiesValue))
	kv("Excess of assets over liabilities:", fmt.Sprintf("%.2f", stmt.Section4.ExcessAssetsOverLiabilities))
	kv("Excess of liabilities over assets:", fmt.Sprintf("%.2f", stmt.Section4.ExcessLiabilitiesOverAssets))
	section("DECLARATION")
	pdf.SetFont("Arial", "", 9)
	pdf.MultiCell(0, 6, tr("I hereby declare that the information furnished in the above statement is true and correct to the best of my knowledge and belief."), "", "L", false)
	pdf.Ln(4)
	for _, label := range []string{"Place:", "Date:", "Name:", "Signature:", "Status (Proprietor/Partner/Manager):"} {
		pdf.CellFormat(0, 8, tr(label+" ________________________________"), "", 1, "L", false, 0, "")
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func parseFormGOverrides(c echo.Context) FormGOverrides {
	i := func(name string) int {
		n, _ := strconv.Atoi(c.QueryParam(name))
		return n
	}
	fl := func(name string) float64 {
		v, _ := strconv.ParseFloat(c.QueryParam(name), 64)
		return v
	}
	return FormGOverrides{
		DepositOpeningCount:  i("deposit_opening_count"),
		DepositOpeningAmount: fl("deposit_opening_amount"),
		DepositDuringCount:   i("deposit_during_count"),
		DepositDuringAmount:  fl("deposit_during_amount"),
		DepositRepaidCount:   i("deposit_repaid_count"),
		DepositRepaidAmount:  fl("deposit_repaid_amount"),
		DepositClosingCount:  i("deposit_closing_count"),
		DepositClosingAmount: fl("deposit_closing_amount"),
		AssetsValue:          fl("assets_value"),
		LiabilitiesValue:     fl("liabilities_value"),
	}
}

func exportFormG(c echo.Context, f models.Filter, format string) error {
	overrides := parseFormGOverrides(c)
	stmt, err := buildFormGStatement(auth.RequestContext(c), f, overrides)
	if err != nil {
		reportError(c, err)
		return nil
	}
	filename := fmt.Sprintf("form-g-%s.%s", time.Now().Format("20060102-150405"), format)
	switch format {
	case "xlsx":
		buf, err := buildFormGXLSX(stmt)
		if err != nil {
			reportError(c, err)
			return nil
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := buildFormGPDF(stmt)
		if err != nil {
			reportError(c, err)
			return nil
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
	return nil
}

func FormGReport(c echo.Context) error {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	stmt, err := buildFormGStatement(auth.RequestContext(c), f, FormGOverrides{})
	if err != nil {
		reportError(c, err)
		return nil
	}
	return common.Success(c, http.StatusOK, stmt)
}

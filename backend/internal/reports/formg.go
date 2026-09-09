package reports

import (
	"bytes"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jung-kurt/gofpdf"
	"github.com/xuri/excelize/v2"

	"cloudhouse/backend/internal/platform/httpx"
)

// Form G — statement of accounts required under Rule 15(3) of the Kerala
// Money-Lenders Rules, 1964. Unlike every other report in this package,
// Form G is NOT a repeated-row listing: it's a fixed-layout statutory
// statement (header particulars, two 4-row loan-movement tables, a deposits
// block, a financial-position block, and a blank declaration for manual
// signing), so it does not fit toTable/buildXLSX/buildPDF's generic
// reflection-based table renderer — it gets its own query function
// (BuildFormGStatement) and its own dedicated buildFormGXLSX/buildFormGPDF
// layout functions below, reusing the same excelize/gofpdf libraries and
// house style as export.go's generic builders.

// formGLenderName/formGLenderAddress are the money-lender's own registered
// particulars printed at the top of the statement (Rule 15(3) requires the
// lender's name and full postal address).
//
// DEMO PLACEHOLDERS. Form G is a statutory Kerala Money-Lenders Act filing
// and these two fields identify the licensee, so they must carry the MLL
// registration and registered postal address of the entity actually licensed
// under the Act. The values below are deliberately fake and a filing produced
// with them is not valid — replace both, and the matching pair in
// internal/personalloan/bond.go, with the real registration before anyone
// files this. There is still no structured business-profile table in this
// codebase, so they remain fixed constants; wire them into real config if one
// is ever added.
const formGLenderName = "CloudHouse Gold Finance (MLL No. DEMO-0000000000)"

// formGLenderAddress is the licensee's registered postal address, per the
// same MLL registration referenced above. Also a demo placeholder.
const formGLenderAddress = "Demo Registered Office, Door No. 0/000, Demo Village, Demo Taluk, Ernakulam District, Kerala"

// FormGBranch is one branch's printed particulars (Rule 15(3) also wants
// the branch's own postal address alongside the lender's).
type FormGBranch struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// FormGLoanCategory is one row of Section 1 (loans advanced) or Section 2
// (loans redeemed) — both sections share this exact 4-row/4-column shape
// per the Rule 15(3) template.
type FormGLoanCategory struct {
	Label   string  `json:"label"`
	Persons int     `json:"persons"` // count of distinct customers
	Amount  float64 `json:"amount"`
	Remarks string  `json:"remarks"`
}

// FormGDeposits is Section 3 — this business takes no public deposits and
// there is no deposit-ledger table anywhere in the schema, so every field
// here is always computed as 0 by BuildFormGStatement. It is rendered as
// EDITABLE on the frontend before export: see FormGOverrides below for the
// exact mechanism.
type FormGDeposits struct {
	OpeningCount  int     `json:"openingCount"`
	OpeningAmount float64 `json:"openingAmount"`
	DuringCount   int     `json:"duringCount"`
	DuringAmount  float64 `json:"duringAmount"`
	RepaidCount   int     `json:"repaidCount"`
	RepaidAmount  float64 `json:"repaidAmount"`
	ClosingCount  int     `json:"closingCount"`
	ClosingAmount float64 `json:"closingAmount"`
}

// FormGFinancialPosition is Section 4. MaxOutstanding/MaxOutstandingDate are
// genuinely computed (see maxOutstandingInPeriod); AssetsValue/
// LiabilitiesValue have no balance-sheet module to source them from and
// default to 0, editable the same way as Section 3 (see FormGOverrides).
// ExcessAssetsOverLiabilities/ExcessLiabilitiesOverAssets are derived from
// (possibly-overridden) Assets/Liabilities — the original paper form only
// ever fills in ONE of these two lines, so exactly one is non-zero here.
type FormGFinancialPosition struct {
	MaxOutstanding              float64    `json:"maxOutstanding"`
	MaxOutstandingDate          *time.Time `json:"maxOutstandingDate,omitempty"`
	AssetsValue                 float64    `json:"assetsValue"`
	LiabilitiesValue            float64    `json:"liabilitiesValue"`
	ExcessAssetsOverLiabilities float64    `json:"excessAssetsOverLiabilities"`
	ExcessLiabilitiesOverAssets float64    `json:"excessLiabilitiesOverAssets"`
}

// FormGStatement is the whole GET /reports/form-g response body / export
// source document.
type FormGStatement struct {
	PeriodLabel     string                 `json:"periodLabel"`
	LenderName      string                 `json:"lenderName"`
	LenderAddress   string                 `json:"lenderAddress"`
	Branches        []FormGBranch          `json:"branches"`
	Section1        []FormGLoanCategory    `json:"section1Advanced"`
	Section2        []FormGLoanCategory    `json:"section2Redeemed"`
	Section3        FormGDeposits          `json:"section3Deposits"`
	Section4        FormGFinancialPosition `json:"section4FinancialPosition"`
}

// FormGOverrides carries manual staff-entered replacements for the figures
// this system has no ledger for (public deposits, balance-sheet assets/
// liabilities — see FormGDeposits/FormGFinancialPosition's comments).
//
// EDITABLE-BEFORE-EXPORT MECHANISM: GET /reports/form-g always returns these
// as computed 0s — it is the system's own read of the data, not a place to
// persist manual edits (there's no deposits/balance-sheet table to write
// them back to). Instead, the frontend renders Section 3 and the
// assets/liabilities lines of Section 4 as plain editable inputs seeded
// with 0, and when the user clicks "Export", those typed values are sent as
// extra query-string params on GET /reports/export/form-g (parsed by
// parseFormGOverrides below) so the exported file reflects what the user
// typed, without needing any new persistence layer. Reloading the on-screen
// report resets them to 0 — this is a per-export override, not a saved
// figure. Whoever needs these numbers preserved across sessions should
// replace this with a real small "form_g_overrides" table keyed by
// branch+period; out of scope for this pass given no such table exists yet.
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

// formGPeriodLabel turns Filter.From/To into the display string Rule 15(3)
// statements conventionally use ("Quarter ending ..."/"Year ending ...").
// Since Filter carries no explicit "this is a quarter" flag, this is a
// best-effort heuristic off the span's length: ~1 year -> "Year ending",
// ~1 quarter -> "Quarter ending", anything else falls back to a plain
// from/to range so no span is ever mislabeled.
func formGPeriodLabel(f Filter) string {
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

// loanMovementAgg is the shape every Section 1/2 SQL aggregate scans into.
type loanMovementAgg struct {
	Persons int
	Amount  float64
}

// goldLoansAdvanced/personalLoansAdvanced/goldLoansRedeemed/
// personalLoansRedeemed each answer one Section-1/2 row. "Advanced" means
// opened (money actually disbursed) within [from,to); for the gold-loan book
// this mirrors Service.Disbursement's own approval_stage="Approved" filter
// (a loan still moving through the sanction chain has had no money paid
// out yet, so it must not count as "advanced"). Personal loans have no
// separate sanction chain — creation IS disbursement (see personalloan's
// package doc) — so no such filter is needed there.
//
// "Redeemed" means closed within [from,to). The gold-loan Loan model has no
// ClosedAt column (see internal/loan/model_loan.go) — UpdatedAt is used as
// an APPROXIMATION of the closure date for a Status="Closed" loan; this is
// usually correct in practice (closing a loan is the last write made to
// it) but could be wrong if a closed loan's row is edited afterwards for
// any other reason. PersonalLoan does carry a real ClosedAt, used directly.
func (s *Service) goldLoansAdvanced(f Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := s.db.Table("loans").
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

func (s *Service) personalLoansAdvanced(f Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := s.db.Table("personal_loans").
		Select("COUNT(DISTINCT customer_id) as persons, COALESCE(SUM(principal_amount),0) as amount").
		Where("opened_date >= ? AND opened_date < ?", from, to).
		Where("deleted_at IS NULL")
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	err := q.Scan(&out).Error
	return out, err
}

func (s *Service) goldLoansRedeemed(f Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := s.db.Table("loans").
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

func (s *Service) personalLoansRedeemed(f Filter, from, to time.Time) (loanMovementAgg, error) {
	var out loanMovementAgg
	q := s.db.Table("personal_loans").
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

// balanceEvent is one +/-principal step in the daily-outstanding series
// built by maxOutstandingInPeriod.
type balanceEvent struct {
	Day   time.Time
	Delta float64
}

// loanSpan is a loan's own contribution to the outstanding series: it adds
// Principal on OpenedDate and, if/when it closes, removes Principal on
// ClosedDate (nil ClosedDate = still outstanding at `to`).
type loanSpan struct {
	OpenedDate time.Time
	ClosedDate *time.Time
	Principal  float64
}

func truncDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// maxOutstandingInPeriod computes the day the COMBINED gold-loan +
// personal-loan outstanding principal peaked within [from,to], and the
// peak amount itself.
//
// APPROXIMATION, clearly noted per the task's own allowance for one: there
// is no daily balance-ledger table in this codebase (internal/loan/
// accrual.go tracks interest accrual, not a per-day running principal
// balance), so this reconstructs a daily series from each loan's own
// opened/closed timestamps: every loan contributes +Principal on the day it
// opened and -Principal on the day it closed (gold loans: UpdatedAt when
// Status=Closed, same approximation as goldLoansRedeemed above; personal
// loans: real ClosedAt). This ignores partial repayments entirely — a loan
// is treated as "full principal outstanding" for its whole open lifetime
// and "fully gone" the instant it closes — which is a reasonable
// approximation of the true ledger balance for a statutory statement, but
// NOT an exact one (a loan with partial payments actually owes less than
// its original principal on most days). A future revision with access to a
// real payment-dated balance history could replace this with an exact
// running balance instead.
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

func (s *Service) loanSpansForMaxOutstanding(f Filter, from, to time.Time) ([]loanSpan, error) {
	var spans []loanSpan

	type goldRow struct {
		OpenedDate      time.Time
		PrincipalAmount float64
		Status          string
		UpdatedAt       time.Time
	}
	var goldRows []goldRow
	// Any loan that was opened before `to` and either isn't Closed yet or
	// closed on/after `from` could have contributed to the outstanding
	// balance at some point during the period.
	gq := s.db.Table("loans").
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
	pq := s.db.Table("personal_loans").
		Select("opened_date, principal_amount, status, closed_at").
		Where("opened_date < ?", to).
		Where("status <> ? OR closed_at IS NULL OR closed_at >= ?", "Closed", from).
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

// formGBranches returns the printed branch particulars: the single branch
// named by f.BranchID when the caller/report is scoped to one, otherwise
// every active branch — Rule 15(3) wants "branch particulars" and a
// lender operating several branches under one Form G reasonably lists all
// of them when no single branch was chosen.
func (s *Service) formGBranches(f Filter) ([]FormGBranch, error) {
	var out []FormGBranch
	q := s.db.Table("branches").Select("name, address").Where("deleted_at IS NULL")
	if f.BranchID != nil {
		q = q.Where("id = ?", *f.BranchID)
	} else {
		q = q.Where("is_active = ?", true)
	}
	err := q.Order("name").Scan(&out).Error
	return out, err
}

// BuildFormGStatement runs every Section 1/2/4 aggregation described above
// and applies Section-3/Section-4-assets-liabilities overrides (see
// FormGOverrides) — GET /reports/form-g and the "form-g" export key both
// call this.
func (s *Service) BuildFormGStatement(f Filter, overrides FormGOverrides) (*FormGStatement, error) {
	from, to := dateRange(f)

	branches, err := s.formGBranches(f)
	if err != nil {
		return nil, err
	}

	goldAdv, err := s.goldLoansAdvanced(f, from, to)
	if err != nil {
		return nil, err
	}
	personalAdv, err := s.personalLoansAdvanced(f, from, to)
	if err != nil {
		return nil, err
	}
	goldRed, err := s.goldLoansRedeemed(f, from, to)
	if err != nil {
		return nil, err
	}
	personalRed, err := s.personalLoansRedeemed(f, from, to)
	if err != nil {
		return nil, err
	}

	spans, err := s.loanSpansForMaxOutstanding(f, from, to)
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

	stmt := &FormGStatement{
		PeriodLabel:   formGPeriodLabel(f),
		LenderName:    formGLenderName,
		LenderAddress: formGLenderAddress,
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

// parseFormGOverrides reads the Section-3/Section-4 manual override query
// params — see FormGOverrides' doc comment for the whole editable-before-
// export mechanism. Every param is optional and defaults to 0.
func parseFormGOverrides(c *gin.Context) FormGOverrides {
	i := func(name string) int {
		n, _ := strconv.Atoi(c.Query(name))
		return n
	}
	fl := func(name string) float64 {
		v, _ := strconv.ParseFloat(c.Query(name), 64)
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

// FormG handles GET /reports/form-g — the on-screen JSON view. Overrides
// are NOT accepted here; this always shows the system's own computed
// figures (with Section 3 / assets / liabilities at their default 0), and
// the frontend applies any manual overrides purely for the export request
// (see FormGOverrides).
func (h *Handler) FormG(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	stmt, err := h.svc.BuildFormGStatement(f, FormGOverrides{})
	if err != nil {
		serverError(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, stmt)
}

// exportFormG handles the "form-g" branch of GET /reports/export/:key,
// applying any manual overrides (see FormGOverrides) and dispatching to the
// dedicated buildFormGXLSX/buildFormGPDF builders instead of export.go's
// generic reflection-based toTable path.
func (h *Handler) exportFormG(c *gin.Context, f Filter, format string) {
	overrides := parseFormGOverrides(c)
	stmt, err := h.svc.BuildFormGStatement(f, overrides)
	if err != nil {
		serverError(c, err)
		return
	}
	filename := fmt.Sprintf("form-g-%s.%s", time.Now().Format("20060102-150405"), format)
	switch format {
	case "xlsx":
		buf, err := buildFormGXLSX(stmt)
		if err != nil {
			serverError(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := buildFormGPDF(stmt)
		if err != nil {
			serverError(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
}

// ---- Export: dedicated fixed-layout XLSX/PDF builders ----

// formG* style constants mirror the house palette buildXLSX/buildPDF use
// elsewhere in export.go, kept local to this file since Form G's layout
// needs several more distinct styles (section headers, sub-table headers)
// than the generic single-header-row table does.
const (
	formGTitleFontSize  = 14
	formGHeaderFontSize = 11
)

// buildFormGXLSX lays the statement out on one sheet: header particulars,
// Section 1/2 as bordered 4-column tables with bold section titles, Section
// 3/4 as label/value pairs, and a blank declaration block at the bottom —
// matching the client's reference Form G template's section order.
func buildFormGXLSX(stmt *FormGStatement) ([]byte, error) {
	f := excelize.NewFile()
	sheet := "Form G"
	f.SetSheetName(f.GetSheetName(0), sheet)
	f.SetColWidth(sheet, "A", "A", 42)
	f.SetColWidth(sheet, "B", "D", 22)

	titleStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: formGTitleFontSize}})
	sectionStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: formGHeaderFontSize}, Fill: excelize.Fill{Type: "pattern", Color: []string{"#F0E6D2"}, Pattern: 1}})
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

// buildFormGPDF mirrors buildFormGXLSX's section order in a single-column
// PDF layout — plain and functional, same tone as buildPDF's generic table
// export elsewhere in this package.
func buildFormGPDF(stmt *FormGStatement) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("") // see buildPDF's comment on why this is needed
	pdf.AddPage()

	pdf.SetFont("Arial", "B", formGTitleFontSize)
	pdf.MultiCell(0, 8, tr("CloudHouse Gold Finance — FORM G: Statement of Accounts (Kerala Money-Lenders Rules, 1964 — Rule 15(3))"), "", "L", false)
	pdf.Ln(2)

	kv := func(k, v string) {
		pdf.SetFont("Arial", "B", 9)
		pdf.CellFormat(75, 6, tr(k), "", 0, "L", false, 0, "")
		pdf.SetFont("Arial", "", 9)
		pdf.MultiCell(0, 6, tr(v), "", "L", false)
	}
	section := func(title string) {
		pdf.Ln(2)
		pdf.SetFont("Arial", "B", formGHeaderFontSize)
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
	// Blank signature block — left for manual completion, matching
	// internal/loan/indemnitybond.go's own blank Place/Date/Signature lines.
	for _, label := range []string{"Place:", "Date:", "Name:", "Signature:", "Status (Proprietor/Partner/Manager):"} {
		pdf.CellFormat(0, 8, tr(label+" ________________________________"), "", 1, "L", false, 0, "")
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

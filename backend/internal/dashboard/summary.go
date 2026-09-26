package dashboard

import (
	"context"
	"errors"
	"math"
	"sort"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/platform"
)

// collectionPaymentTypes are the LoanPayment types that represent money
// actually received from the customer — the "collections" figure on the
// dashboard and the "payment" rows of the activity feed. Non-cash ledger
// entries (Adjustment, Waiver, Discount, Auction Sale/Write-Off) are
// excluded: they move a balance without any money changing hands at the
// counter.
var collectionPaymentTypes = []string{
	loan.PaymentTypeInterest,
	loan.PaymentTypePenalInterest,
	loan.PaymentTypePrincipal,
	loan.PaymentTypePartial,
	loan.PaymentTypeFullSettlement,
}

// notIssuedStatuses are loan statuses whose money has not gone out (still
// awaiting sanction, or turned down) — excluded from "loans issued" and
// from the activity feed's "loan" rows.
var notIssuedStatuses = []string{loan.StatusPendingApproval, loan.StatusRejected}

// overdueActivityStatuses are the ordinary open statuses a loan can be past
// its due date in — the activity feed's "overdue" rows (same set
// loan.enrichStatusFlags's IsOverdue ultimately applies to for servicing
// loans).
var overdueActivityStatuses = []string{loan.StatusActive, loan.StatusDueSoon, loan.StatusOverdue}

// cashFlowDays is how many days GET /dashboard/summary's cashFlow7d covers.
const cashFlowDays = 7

// Activity feed paging bounds (GET /dashboard/activity).
const (
	ActivityDefaultLimit = 20
	ActivityMaxLimit     = 100
)

// TodaySummary is GET /dashboard/summary's "today" block.
type TodaySummary struct {
	// LoansIssued counts loans opened today, excluding Pending Approval/
	// Rejected (no money has gone out on those).
	LoansIssued int64 `json:"loansIssued"`
	// LoansIssuedAmount is the principal total of LoansIssued.
	LoansIssuedAmount float64 `json:"loansIssuedAmount"`
	// Collections is the rupee total of today's customer payments (see
	// collectionPaymentTypes).
	Collections float64 `json:"collections"`
	// CollectionsCount is how many payments make up Collections.
	CollectionsCount int64 `json:"collectionsCount"`
	// NewCustomers counts customers created today.
	NewCustomers int64 `json:"newCustomers"`
}

// CashFlowDay is one day of GET /dashboard/summary's cashFlow7d.
type CashFlowDay struct {
	Date string  `json:"date"` // YYYY-MM-DD
	Net  float64 `json:"net"`  // SUM(cash in) − SUM(cash out) that day
}

// Summary is GET /dashboard/summary's response.
type Summary struct {
	// CashInHand is the all-time net of every cash movement (see
	// cash.MovementRepository.SumNet) — the same figure the dashboards used
	// to compute client-side from the full movement list.
	CashInHand float64 `json:"cashInHand"`
	// Rate22k/Rate24k are the latest published gold rate per gram (0 when
	// no rate has been published yet — HasGoldRate says which).
	Rate22k     float64 `json:"rate22k"`
	Rate24k     float64 `json:"rate24k"`
	HasGoldRate bool    `json:"hasGoldRate"`
	// RateChangePct is the 24K rate's % change vs the previously published
	// rate, rounded to 2 decimals; 0 when there is no previous rate.
	RateChangePct float64       `json:"rateChangePct"`
	RateDate      *time.Time    `json:"rateDate"`
	Today         TodaySummary  `json:"today"`
	CashFlow7d    []CashFlowDay `json:"cashFlow7d"`
}

// ActivityItem is one row of GET /dashboard/activity.
type ActivityItem struct {
	Type         string    `json:"type"` // "loan" | "payment" | "overdue"
	CustomerName string    `json:"customerName"`
	CustomerCode string    `json:"customerCode,omitempty"`
	LoanNumber   string    `json:"loanNumber"`
	LoanID       uint      `json:"loanId"`
	Amount       float64   `json:"amount"`
	Date         time.Time `json:"date"`
	Label        string    `json:"label"`

	// sourceID tie-breaks rows sharing a Date so paging is stable.
	sourceID uint
}

// ActivityResult is GET /dashboard/activity's response — the house
// {items, hasMore, total} pagination shape.
type ActivityResult struct {
	Items   []ActivityItem `json:"items"`
	HasMore bool           `json:"hasMore"`
	Total   int64          `json:"total"`
}

func dayStart(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

// GetSummary builds GET /dashboard/summary for branchScope (nil = every
// branch, Administrator only — see platform.GetBranchScope).
func (s *Service) GetSummary(ctx context.Context, branchScope *uint) (*Summary, error) {
	now := time.Now()
	today := dayStart(now)
	tomorrow := today.AddDate(0, 0, 1)

	out := &Summary{}

	cashInHand, err := s.movementRepo.SumNet(ctx, branchScope)
	if err != nil {
		return nil, err
	}
	out.CashInHand = platform.RoundMoney(cashInHand)

	// [latest, previous] — same limit:2 read the mobile dashboard's trend
	// badge used (GET /gold-rates?limit=2).
	rates, _, err := s.goldRateRepo.FindAll(ctx, 2, 0)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if len(rates) > 0 {
		latest := rates[0]
		out.HasGoldRate = true
		out.Rate24k = latest.K24
		// Same fallback as loan.rateForPurity: a stored zero 22K (never
		// independently published) is derived off 24K, never quoted as 0.
		out.Rate22k = latest.K22
		if out.Rate22k <= 0 {
			out.Rate22k = math.Round(latest.K24 * 22 / 24)
		}
		d := latest.Date
		out.RateDate = &d
		if len(rates) > 1 && rates[1].K24 > 0 {
			out.RateChangePct = math.Round((latest.K24-rates[1].K24)/rates[1].K24*100*100) / 100
		}
	}

	// Today: loans issued.
	type sumRow struct {
		Count int64
		Total float64
	}
	var issued sumRow
	lq := s.db.WithContext(ctx).Model(&loan.Loan{}).
		Where("opened_date >= ? AND opened_date < ?", today, tomorrow).
		Where("status NOT IN ?", notIssuedStatuses)
	if branchScope != nil {
		lq = lq.Where("branch_id = ?", *branchScope)
	}
	if err := lq.Select("COUNT(*) AS count, COALESCE(SUM(principal_amount), 0) AS total").Scan(&issued).Error; err != nil {
		return nil, err
	}
	out.Today.LoansIssued = issued.Count
	out.Today.LoansIssuedAmount = platform.RoundMoney(issued.Total)

	// Today: collections (branch comes from the parent loan).
	var coll sumRow
	pq := s.db.WithContext(ctx).Model(&loan.LoanPayment{}).
		Joins("JOIN loans ON loans.id = loan_payments.loan_id AND loans.deleted_at IS NULL").
		Where("loan_payments.paid_on >= ? AND loan_payments.paid_on < ?", today, tomorrow).
		Where("loan_payments.type IN ?", collectionPaymentTypes)
	if branchScope != nil {
		pq = pq.Where("loans.branch_id = ?", *branchScope)
	}
	if err := pq.Select("COUNT(*) AS count, COALESCE(SUM(loan_payments.amount), 0) AS total").Scan(&coll).Error; err != nil {
		return nil, err
	}
	out.Today.Collections = platform.RoundMoney(coll.Total)
	out.Today.CollectionsCount = coll.Count

	// Today: new customers.
	cq := s.db.WithContext(ctx).Model(&customer.Customer{}).
		Where("created_at >= ? AND created_at < ?", today, tomorrow)
	if branchScope != nil {
		cq = cq.Where("branch_id = ?", *branchScope)
	}
	if err := cq.Count(&out.Today.NewCustomers).Error; err != nil {
		return nil, err
	}

	// 7-day cash flow, oldest -> newest, every day present (0 when quiet).
	from := today.AddDate(0, 0, -(cashFlowDays - 1))
	byDay, err := s.movementRepo.NetByDay(ctx, branchScope, from, tomorrow)
	if err != nil {
		return nil, err
	}
	out.CashFlow7d = make([]CashFlowDay, 0, cashFlowDays)
	for i := 0; i < cashFlowDays; i++ {
		key := from.AddDate(0, 0, i).Format("2006-01-02")
		out.CashFlow7d = append(out.CashFlow7d, CashFlowDay{Date: key, Net: platform.RoundMoney(byDay[key])})
	}

	return out, nil
}

// activityRow is the shared scan target of the three activity sources.
type activityRow struct {
	SourceID     uint
	LoanID       uint
	LoanNumber   string
	CustomerName string
	CustomerCode string
	Amount       float64
	Date         time.Time
	PaymentType  string
}

// activitySource is one of the feed's three streams: a base query (already
// filtered/branch-scoped, primary table set so the tenant scope applies)
// plus how to project and order it.
type activitySource struct {
	base   func() *gorm.DB
	sel    string
	order  string
	toItem func(activityRow) ActivityItem
}

func (s *Service) activitySources(ctx context.Context, branchScope *uint, now time.Time) []activitySource {
	scopeLoans := func(q *gorm.DB) *gorm.DB {
		if branchScope != nil {
			q = q.Where("loans.branch_id = ?", *branchScope)
		}
		return q
	}
	return []activitySource{
		{
			base: func() *gorm.DB {
				return scopeLoans(s.db.WithContext(ctx).Model(&loan.Loan{}).
					Joins("JOIN customers ON customers.id = loans.customer_id").
					Where("loans.status NOT IN ?", notIssuedStatuses))
			},
			sel:   "loans.id AS source_id, loans.id AS loan_id, loans.loan_number, customers.name AS customer_name, customers.code AS customer_code, loans.principal_amount AS amount, loans.opened_date AS date",
			order: "loans.opened_date desc, loans.id desc",
			toItem: func(r activityRow) ActivityItem {
				return ActivityItem{Type: "loan", Amount: r.Amount, Date: r.Date, Label: "New loan"}
			},
		},
		{
			base: func() *gorm.DB {
				return scopeLoans(s.db.WithContext(ctx).Model(&loan.LoanPayment{}).
					Joins("JOIN loans ON loans.id = loan_payments.loan_id AND loans.deleted_at IS NULL").
					Joins("JOIN customers ON customers.id = loans.customer_id").
					Where("loan_payments.type IN ?", collectionPaymentTypes))
			},
			sel:   "loan_payments.id AS source_id, loans.id AS loan_id, loans.loan_number, customers.name AS customer_name, customers.code AS customer_code, loan_payments.amount AS amount, loan_payments.paid_on AS date, loan_payments.type AS payment_type",
			order: "loan_payments.paid_on desc, loan_payments.id desc",
			toItem: func(r activityRow) ActivityItem {
				return ActivityItem{Type: "payment", Amount: r.Amount, Date: r.Date, Label: r.PaymentType + " payment"}
			},
		},
		{
			base: func() *gorm.DB {
				return scopeLoans(s.db.WithContext(ctx).Model(&loan.Loan{}).
					Joins("JOIN customers ON customers.id = loans.customer_id").
					Where("loans.status IN ?", overdueActivityStatuses).
					Where("loans.due_date < ?", now))
			},
			sel:   "loans.id AS source_id, loans.id AS loan_id, loans.loan_number, customers.name AS customer_name, customers.code AS customer_code, loans.principal_amount AS amount, loans.due_date AS date",
			order: "loans.due_date desc, loans.id desc",
			toItem: func(r activityRow) ActivityItem {
				return ActivityItem{Type: "overdue", Amount: r.Amount, Date: r.Date, Label: "Overdue"}
			},
		},
	}
}

// GetActivity returns one page of the merged recent-activity feed — new
// loans (dated by OpenedDate), customer payments (PaidOn) and overdue loans
// (DueDate) — newest first, for branchScope.
//
// The three streams live in different tables, so rather than a raw UNION
// (which would bypass the per-model tenant scope — see
// platform.RegisterTenantScope) each stream is queried on its own model:
// Total is the sum of three COUNTs, and the page is a k-way merge of each
// stream's own newest offset+limit rows (any row on the requested page must
// be within the first offset+limit rows of its own stream), so the result
// is exact without loading whole tables.
func (s *Service) GetActivity(ctx context.Context, branchScope *uint, limit, offset int) (*ActivityResult, error) {
	if limit <= 0 {
		limit = ActivityDefaultLimit
	}
	if limit > ActivityMaxLimit {
		limit = ActivityMaxLimit
	}
	if offset < 0 {
		offset = 0
	}
	now := time.Now()

	var total int64
	merged := make([]ActivityItem, 0, 3*(offset+limit))
	for _, src := range s.activitySources(ctx, branchScope, now) {
		var n int64
		if err := src.base().Count(&n).Error; err != nil {
			return nil, err
		}
		total += n
		if n == 0 {
			continue
		}
		var rows []activityRow
		if err := src.base().Select(src.sel).Order(src.order).Limit(offset + limit).Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			it := src.toItem(r)
			it.LoanID, it.LoanNumber = r.LoanID, r.LoanNumber
			it.CustomerName, it.CustomerCode = r.CustomerName, r.CustomerCode
			it.sourceID = r.SourceID
			merged = append(merged, it)
		}
	}

	sort.SliceStable(merged, func(i, j int) bool {
		if !merged[i].Date.Equal(merged[j].Date) {
			return merged[i].Date.After(merged[j].Date)
		}
		if merged[i].Type != merged[j].Type {
			return merged[i].Type < merged[j].Type
		}
		return merged[i].sourceID > merged[j].sourceID
	})

	start := offset
	if start > len(merged) {
		start = len(merged)
	}
	end := start + limit
	if end > len(merged) {
		end = len(merged)
	}
	items := merged[start:end]
	return &ActivityResult{
		Items:   items,
		HasMore: int64(offset+len(items)) < total,
		Total:   total,
	}, nil
}

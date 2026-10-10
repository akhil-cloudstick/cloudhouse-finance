package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cash "cloudhouse/backend/modules/Cash/controllers"
	loanModels "cloudhouse/backend/modules/Loan/models"
	"context"
	"errors"
	"math"
	"sort"
	"time"

	"gorm.io/gorm"
)

var collectionPaymentTypes = []string{
	loanModels.PaymentTypeInterest,
	loanModels.PaymentTypePenalInterest,
	loanModels.PaymentTypePrincipal,
	loanModels.PaymentTypePartial,
	loanModels.PaymentTypeFullSettlement,
}

var notIssuedStatuses = []string{loanModels.StatusPendingApproval, loanModels.StatusRejected}

var overdueActivityStatuses = []string{loanModels.StatusActive, loanModels.StatusDueSoon, loanModels.StatusOverdue}

const (
	ActivityMaxLimit = 100
)

type TodaySummary struct {
	LoansIssued       int64   `json:"loans_issued"`
	LoansIssuedAmount float64 `json:"loans_issued_amount"`
	Collections       float64 `json:"collections"`
	CollectionsCount  int64   `json:"collections_count"`
	NewCustomers      int64   `json:"new_customers"`
}

type CashFlowDay struct {
	Date string  `json:"date"`
	Net  float64 `json:"net"`
}

type Summary struct {
	CashInHand    float64       `json:"cash_in_hand"`
	Rate22k       float64       `json:"rate22k"`
	Rate24k       float64       `json:"rate24k"`
	HasGoldRate   bool          `json:"has_gold_rate"`
	RateChangePct float64       `json:"rate_change_pct"`
	RateDate      *time.Time    `json:"rate_date"`
	Today         TodaySummary  `json:"today"`
	CashFlow7d    []CashFlowDay `json:"cash_flow7d"`
}

type ActivityItem struct {
	Type         string    `json:"type"`
	CustomerName string    `json:"customer_name"`
	CustomerCode string    `json:"customer_code,omitempty"`
	LoanNumber   string    `json:"loan_number"`
	LoanID       uint      `json:"loan_id"`
	Amount       float64   `json:"amount"`
	Date         time.Time `json:"date"`
	Label        string    `json:"label"`
	sourceID     uint
}

type ActivityResult struct {
	Items   []ActivityItem `json:"items"`
	HasMore bool           `json:"has_more"`
	Total   int64          `json:"total"`
}

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

type activitySource struct {
	base   func() *gorm.DB
	sel    string
	order  string
	toItem func(activityRow) ActivityItem
}

func dayStart(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func getSummary(ctx context.Context, branchScope *uint) (*Summary, error) {
	now := time.Now()
	today := dayStart(now)
	tomorrow := today.AddDate(0, 0, 1)
	out := &Summary{}
	cashInHand, err := cash.SumNet(ctx, branchScope)
	if err != nil {
		return nil, err
	}
	out.CashInHand = common.RoundMoney(cashInHand)
	rates, _, err := common.FindGoldRates(ctx, 2, 0)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if len(rates) > 0 {
		latest := rates[0]
		out.HasGoldRate = true
		out.Rate24k = latest.K24
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
	type sumRow struct {
		Count int64
		Total float64
	}
	var issued sumRow
	lq := config.DB.
		WithContext(ctx).Model(&loanModels.Loan{}).
		Where("opened_date >= ? AND opened_date < ?", today, tomorrow).
		Where("status NOT IN ?", notIssuedStatuses)
	if branchScope != nil {
		lq = lq.Where("branch_id = ?", *branchScope)
	}
	if err := lq.Select("COUNT(*) AS count, COALESCE(SUM(principal_amount), 0) AS total").Scan(&issued).Error; err != nil {
		return nil, err
	}
	out.Today.LoansIssued = issued.Count
	out.Today.LoansIssuedAmount = common.RoundMoney(issued.Total)
	var coll sumRow
	pq := config.DB.
		WithContext(ctx).Model(&loanModels.LoanPayment{}).
		Joins("JOIN loans ON loans.id = loan_payments.loan_id AND loans.deleted_at IS NULL").
		Where("loan_payments.paid_on >= ? AND loan_payments.paid_on < ?", today, tomorrow).
		Where("loan_payments.type IN ?", collectionPaymentTypes)
	if branchScope != nil {
		pq = pq.Where("loans.branch_id = ?", *branchScope)
	}
	if err := pq.Select("COUNT(*) AS count, COALESCE(SUM(loan_payments.amount), 0) AS total").Scan(&coll).Error; err != nil {
		return nil, err
	}
	out.Today.Collections = common.RoundMoney(coll.Total)
	out.Today.CollectionsCount = coll.Count
	cq := config.DB.
		WithContext(ctx).Model(&commonModels.Customer{}).
		Where("created_at >= ? AND created_at < ?", today, tomorrow)
	if branchScope != nil {
		cq = cq.Where("branch_id = ?", *branchScope)
	}
	if err := cq.Count(&out.Today.NewCustomers).Error; err != nil {
		return nil, err
	}
	from := today.AddDate(0, 0, -(7 - 1))
	byDay, err := cash.NetByDay(ctx, branchScope, from, tomorrow)
	if err != nil {
		return nil, err
	}
	out.CashFlow7d = make([]CashFlowDay, 0, 7)
	for i := 0; i < 7; i++ {
		key := from.AddDate(0, 0, i).Format("2006-01-02")
		out.CashFlow7d = append(out.CashFlow7d, CashFlowDay{Date: key, Net: common.RoundMoney(byDay[key])})
	}
	return out, nil
}

func activitySources(ctx context.Context, branchScope *uint, now time.Time) []activitySource {
	scopeLoans := func(q *gorm.DB) *gorm.DB {
		if branchScope != nil {
			q = q.Where("loans.branch_id = ?", *branchScope)
		}
		return q
	}
	return []activitySource{
		{
			base: func() *gorm.DB {
				return scopeLoans(config.DB.
					WithContext(ctx).Model(&loanModels.Loan{}).
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
				return scopeLoans(config.DB.
					WithContext(ctx).Model(&loanModels.LoanPayment{}).
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
				return scopeLoans(config.DB.
					WithContext(ctx).Model(&loanModels.Loan{}).
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

func getActivity(ctx context.Context, branchScope *uint, limit, offset int) (*ActivityResult, error) {
	if limit <= 0 {
		limit = 20
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
	for _, src := range activitySources(ctx, branchScope, now) {
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

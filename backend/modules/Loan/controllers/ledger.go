package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

const accrualTriggerWindow = 10 * time.Second

var ledgerCreditTypes = map[string]bool{
	models.PaymentTypeInterest:        true,
	models.PaymentTypePenalInterest:   true,
	models.PaymentTypePrincipal:       true,
	models.PaymentTypePartial:         true,
	models.PaymentTypeFullSettlement:  true,
	models.PaymentTypeAuctionSale:     true,
	models.PaymentTypeAuctionWriteOff: true,
	models.PaymentTypeWaiver:          true,
	"Adjustment":                      true,
	models.PaymentTypeDiscount:        true,
}

type LoanLedgerPart struct {
	Mode   string  `json:"mode"`
	Amount float64 `json:"amount"`
	Index  int     `json:"index"`
	Count  int     `json:"count"`
}

type LoanLedgerEntry struct {
	Kind    string                `json:"kind"`
	Key     string                `json:"key"`
	Date    string                `json:"date"`
	Amount  float64               `json:"amount"`
	Balance *float64              `json:"balance"`
	Part    *LoanLedgerPart       `json:"part,omitempty"`
	Payment *models.LoanPayment   `json:"payment,omitempty"`
	TopUp   *models.LoanTopUp     `json:"top_up,omitempty"`
	Auction *models.AuctionRecord `json:"auction,omitempty"`
	Note    string                `json:"note,omitempty"`
}

type LoanLedgerQuery struct {
	From        string
	To          string
	Kinds       []string
	Limit       int
	Offset      int
	FocusKey    string
	FocusDate   string
	FocusAmount *float64
}

type LoanLedgerPage struct {
	Items       []LoanLedgerEntry `json:"items"`
	Total       int               `json:"total"`
	Limit       int               `json:"limit"`
	Offset      int               `json:"offset"`
	TotalDebit  float64           `json:"total_debit"`
	TotalCredit float64           `json:"total_credit"`
}

type ledgerSource struct {
	kind          string
	date          string
	sortKey       string
	rank          int
	payment       *models.LoanPayment
	topUp         *models.LoanTopUp
	auction       *models.AuctionRecord
	accrualAmount float64
	note          string
}

func ledgerColumnTotals(rows []LoanLedgerEntry) (debit, credit float64) {
	for _, r := range rows {
		switch r.Kind {
		case "sanction", "topup", "interest", "penal":
			debit += r.Amount
		case "payment":
			credit += r.Amount
		case "auction-surplus":
			if r.Auction != nil && r.Auction.SurplusDisposition == "RefundedToCustomer" {
				debit += r.Amount
			}
		}
	}
	return debit, credit
}

func ledgerDate(t time.Time) string {
	return t.Format("2006-01-02")
}

func ledgerSortKey(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000000000")
}

func ledgerSplitParts(cash, upi, bankTransfer, cheque float64) []LoanLedgerPart {
	modes := []LoanLedgerPart{{Mode: "Cash", Amount: cash}, {Mode: "UPI", Amount: upi}, {Mode: "Bank Transfer", Amount: bankTransfer}, {Mode: "Cheque", Amount: cheque}}
	parts := make([]LoanLedgerPart, 0, len(modes))
	for _, m := range modes {
		if m.Amount > 0 {
			parts = append(parts, m)
		}
	}
	if len(parts) < 2 {
		return nil
	}
	for i := range parts {
		parts[i].Index = i
		parts[i].Count = len(parts)
	}
	return parts
}

func auctionLedgerSaleDate(a *models.AuctionRecord) string {
	for _, e := range a.Events {
		if e.Action == "SaleRecorded" {
			return ledgerDate(e.CreatedAt)
		}
	}
	if a.AuctionDate != nil {
		return ledgerDate(*a.AuctionDate)
	}
	return ledgerDate(a.AuctionEligibleDate)
}

func auctionLedgerSurplusDate(a *models.AuctionRecord) string {
	for _, e := range a.Events {
		if e.Action == "Settled" {
			return ledgerDate(e.CreatedAt)
		}
	}
	return auctionLedgerSaleDate(a)
}

func auctionSalePayment(a *models.AuctionRecord, payments []models.LoanPayment) *models.LoanPayment {
	for i := range payments {
		p := &payments[i]
		if p.Type == models.PaymentTypeAuctionSale && (a.AuctionReferenceNumber == "" || p.Reference == a.AuctionReferenceNumber) {
			return p
		}
	}
	return nil
}

func ledgerBalance(v float64) *float64 {
	return &v
}

func ledgerEntryKey(base string, part *LoanLedgerPart) string {
	if part == nil {
		return base
	}
	return base + "-" + part.Mode
}

func expandLedgerParts(e LoanLedgerEntry, total float64, parts []LoanLedgerPart, base string, balanceAt func(later float64, part LoanLedgerPart) float64) []LoanLedgerEntry {
	if len(parts) == 0 {
		e.Key = base
		e.Amount = total
		return []LoanLedgerEntry{e}
	}
	later := 0.0
	for _, pt := range parts {
		later += pt.Amount
	}
	out := make([]LoanLedgerEntry, 0, len(parts))
	for _, pt := range parts {
		pt := pt
		later -= pt.Amount
		row := e
		row.Part = &pt
		row.Key = ledgerEntryKey(base, &pt)
		row.Amount = pt.Amount
		row.Balance = ledgerBalance(balanceAt(later, pt))
		out = append(out, row)
	}
	return out
}

func buildLoanLedger(l *models.Loan, payments []models.LoanPayment, topUps []models.LoanTopUp, auctions []models.AuctionRecord, accruals []models.LoanAccrual) []LoanLedgerEntry {
	var disbursement *models.LoanPayment
	disbursementCount := 0
	sources := make([]ledgerSource, 0, len(payments)+len(topUps)+2*len(auctions))
	for i := range payments {
		p := &payments[i]
		if p.Type == models.PaymentTypeDisbursement {
			disbursementCount++
			if disbursement == nil {
				disbursement = p
			} else {
				sources = append(sources, ledgerSource{kind: "redisbursement", date: ledgerDate(p.PaidOn), sortKey: ledgerSortKey(p.PaidOn), rank: 0, payment: p})
			}
			continue
		}
		sources = append(sources, ledgerSource{kind: "payment", date: ledgerDate(p.PaidOn), sortKey: ledgerSortKey(p.PaidOn), rank: 1, payment: p})
	}
	for i := range topUps {
		t := &topUps[i]
		if t.Status == models.TopUpStatusPending || t.Status == "Rejected" {
			continue
		}
		sources = append(sources, ledgerSource{kind: "topup", date: ledgerDate(t.OccurredOn), sortKey: ledgerSortKey(t.OccurredOn), rank: 0, topUp: t})
	}
	var recordedInterest, recordedPenal float64
	for _, a := range accruals {
		recordedInterest += a.Interest
		recordedPenal += a.PenalInterest
		at := a.AccruedOn
		if p := accrualTriggerPayment(a.CreatedAt, payments); p != nil {
			at = a.CreatedAt
			if !at.Before(p.PaidOn) {
				at = p.PaidOn.Add(-time.Millisecond)
			}
		} else if at.After(time.Now()) {
			continue
		}
		if a.Interest > 0.004 {
			sources = append(sources, ledgerSource{kind: "interest", date: ledgerDate(at), sortKey: ledgerSortKey(at), rank: 2, accrualAmount: a.Interest, note: fmt.Sprintf("interest-%d", a.ID)})
		}
		if a.PenalInterest > 0.004 {
			sources = append(sources, ledgerSource{kind: "penal", date: ledgerDate(at), sortKey: ledgerSortKey(at), rank: 3, accrualAmount: a.PenalInterest, note: fmt.Sprintf("penal-%d", a.ID)})
		}
	}
	catchUpAt := l.LastAccrualDate
	if now := time.Now(); catchUpAt.After(now) {
		if !l.CreatedAt.IsZero() && l.CreatedAt.Before(now) {
			catchUpAt = l.CreatedAt
		} else {
			catchUpAt = now
		}
	}
	catchUpFor := func(applied func(*models.LoanPayment) float64) time.Time {
		at := catchUpAt
		for i := range payments {
			p := &payments[i]
			if p.Type == models.PaymentTypeDisbursement || applied(p) <= 0 {
				continue
			}
			if before := p.PaidOn.Add(-time.Millisecond); before.Before(at) {
				at = before
			}
		}
		return at
	}
	interestAt := catchUpFor(func(p *models.LoanPayment) float64 { return p.InterestApplied })
	penalAt := catchUpFor(func(p *models.LoanPayment) float64 { return p.PenalInterestApplied })
	if missing := l.AccruedInterest - recordedInterest; missing > 0.01 {
		sources = append(sources, ledgerSource{kind: "interest", date: ledgerDate(interestAt), sortKey: ledgerSortKey(interestAt), rank: 2, accrualAmount: common.RoundMoney(missing), note: "interest-earlier"})
	}
	if missing := l.AccruedPenalInterest - recordedPenal; missing > 0.01 {
		sources = append(sources, ledgerSource{kind: "penal", date: ledgerDate(penalAt), sortKey: ledgerSortKey(penalAt), rank: 3, accrualAmount: common.RoundMoney(missing), note: "penal-earlier"})
	}
	for i := range auctions {
		a := &auctions[i]
		if a.SaleAmount <= 0 {
			continue
		}
		if auctionSalePayment(a, payments) == nil {
			d := auctionLedgerSaleDate(a)
			sources = append(sources, ledgerSource{kind: "auction-sale", date: d, sortKey: d, rank: 1, auction: a})
		}
		if a.SurplusPayableAmount > 0.01 {
			d := auctionLedgerSurplusDate(a)
			sources = append(sources, ledgerSource{kind: "auction-surplus", date: d, sortKey: d + "~", rank: 1, auction: a})
		}
	}
	sort.SliceStable(sources, func(i, j int) bool {
		if sources[i].sortKey != sources[j].sortKey {
			return sources[i].sortKey < sources[j].sortKey
		}
		return sources[i].rank < sources[j].rank
	})
	balance := l.SanctionedAmount
	owedModel := false
	for _, src := range sources {
		if src.kind == "interest" || src.kind == "penal" {
			owedModel = true
			break
		}
	}
	out := make([]LoanLedgerEntry, 0, len(sources)+1)
	if l.DisbursementDate != nil || disbursement != nil {
		var parts []LoanLedgerPart
		date, amount := time.Time{}, l.DisbursedAmount
		if l.DisbursementDate != nil {
			date = *l.DisbursementDate
		}
		if disbursement != nil {
			parts = ledgerSplitParts(disbursement.CashAmount, disbursement.UpiAmount, disbursement.BankTransferAmount, disbursement.ChequeAmount)
			if disbursementCount > 1 || l.DisbursementDate == nil {
				date, amount = disbursement.PaidOn, disbursement.Amount
				balance = disbursement.RunningBalance
				if balance <= 0 {
					balance = amount
				}
			}
		}
		e := LoanLedgerEntry{Kind: "sanction", Date: ledgerDate(date), Balance: ledgerBalance(balance), Payment: disbursement}
		first := balance
		out = append(out, expandLedgerParts(e, amount, parts, "sanction", func(later float64, _ LoanLedgerPart) float64 { return first - later })...)
	}
	for _, src := range sources {
		switch src.kind {
		case "redisbursement":
			p := src.payment
			balance = p.RunningBalance
			e := LoanLedgerEntry{Kind: "sanction", Date: src.date, Balance: ledgerBalance(balance), Payment: p}
			parts := ledgerSplitParts(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
			out = append(out, expandLedgerParts(e, p.Amount, parts, fmt.Sprintf("sanction-%d", p.ID), func(later float64, _ LoanLedgerPart) float64 { return balance - later })...)
		case "payment":
			p := src.payment
			if owedModel {
				balance = balance + p.ProcessingFee - p.Amount
			} else {
				balance = p.RunningBalance
			}
			e := LoanLedgerEntry{Kind: "payment", Date: src.date, Balance: ledgerBalance(balance), Payment: p}
			if p.Type == models.PaymentTypeAuctionSale {
				for i := range auctions {
					if auctions[i].SaleAmount > 0 && auctionSalePayment(&auctions[i], []models.LoanPayment{*p}) != nil {
						e.Auction = &auctions[i]
						break
					}
				}
			}
			parts := ledgerSplitParts(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
			out = append(out, expandLedgerParts(e, p.Amount, parts, fmt.Sprintf("payment-%d", p.ID), func(later float64, _ LoanLedgerPart) float64 { return balance + later })...)
		case "topup":
			t := src.topUp
			active := t.Status == models.TopUpStatusActive
			parts := ledgerSplitParts(t.CashAmount, t.UpiAmount, t.BankTransferAmount, t.ChequeAmount)
			if len(parts) == 0 && active {
				balance += t.Amount
			}
			e := LoanLedgerEntry{Kind: "topup", Date: src.date, Balance: ledgerBalance(balance), TopUp: t}
			out = append(out, expandLedgerParts(e, t.Amount, parts, fmt.Sprintf("topup-%d", t.ID), func(_ float64, pt LoanLedgerPart) float64 {
				if active {
					balance += pt.Amount
				}
				return balance
			})...)
		case "interest", "penal":
			balance += src.accrualAmount
			out = append(out, LoanLedgerEntry{Kind: src.kind, Key: src.note, Date: src.date, Amount: src.accrualAmount, Balance: ledgerBalance(balance), Note: src.note})
		case "auction-sale":
			out = append(out, LoanLedgerEntry{Kind: src.kind, Key: fmt.Sprintf("auction-sale-%d", src.auction.ID), Date: src.date, Amount: src.auction.SaleAmount, Auction: src.auction})
		case "auction-surplus":
			out = append(out, LoanLedgerEntry{Kind: src.kind, Key: fmt.Sprintf("auction-surplus-%d", src.auction.ID), Date: src.date, Amount: src.auction.SurplusPayableAmount, Auction: src.auction})
		}
	}
	return out
}

func ledgerKindWanted(kind string, wanted []string) bool {
	if len(wanted) == 0 {
		return true
	}
	for _, w := range wanted {
		if w == kind || (w == "auction" && (kind == "auction-sale" || kind == "auction-surplus")) {
			return true
		}
	}
	return false
}

func ledgerFocusIndex(rows []LoanLedgerEntry, q LoanLedgerQuery) int {
	if q.FocusKey != "" {
		for i, r := range rows {
			if r.Key == q.FocusKey {
				return i
			}
		}
		return -1
	}
	if q.FocusAmount == nil {
		return -1
	}
	same := func(a float64) bool { return math.Abs(a-*q.FocusAmount) < 0.005 }
	for i, r := range rows {
		if r.Date == q.FocusDate && same(r.Amount) {
			return i
		}
	}
	for i, r := range rows {
		if same(r.Amount) {
			return i
		}
	}
	return -1
}

func getLoanLedger(ctx context.Context, loanID uint, branchID *uint, q LoanLedgerQuery) (*LoanLedgerPage, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	payments, _, err := findByLoanIDPaged(ctx, loanID, 0, 0)
	if err != nil {
		return nil, err
	}
	topUps, err := findLoanTopUpByLoanID(ctx, loanID)
	if err != nil {
		return nil, err
	}
	auctions, err := findAuctionHistoryByLoanID(ctx, loanID)
	if err != nil {
		return nil, err
	}
	var accruals []models.LoanAccrual
	if err := config.DB.
		WithContext(ctx).Where("loan_id = ?", loanID).Order("accrued_on asc, id asc").Find(&accruals).Error; err != nil {
		return nil, err
	}
	all := buildLoanLedger(l, payments, topUps, auctions, accruals)
	rows := make([]LoanLedgerEntry, 0, len(all))
	for _, r := range all {
		if (q.From == "" || r.Date >= q.From) && (q.To == "" || r.Date <= q.To) && ledgerKindWanted(r.Kind, q.Kinds) {
			rows = append(rows, r)
		}
	}
	limit := q.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	offset := q.Offset
	if i := ledgerFocusIndex(rows, q); i >= 0 {
		offset = (i / limit) * limit
	}
	if offset < 0 || offset >= len(rows) {
		offset = 0
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	totalDebit, totalCredit := ledgerColumnTotals(rows)
	return &LoanLedgerPage{Items: rows[offset:end], Total: len(rows), Limit: limit, Offset: offset, TotalDebit: common.RoundMoney(totalDebit), TotalCredit: common.RoundMoney(totalCredit)}, nil
}

func accrualTriggerPayment(accruedAt time.Time, payments []models.LoanPayment) *models.LoanPayment {
	if accruedAt.IsZero() {
		return nil
	}
	var best *models.LoanPayment
	for i := range payments {
		p := &payments[i]
		if p.Type == models.PaymentTypeDisbursement || p.CreatedAt.Before(accruedAt) || p.CreatedAt.Sub(accruedAt) > accrualTriggerWindow {
			continue
		}
		if best == nil || p.CreatedAt.Before(best.CreatedAt) {
			best = p
		}
	}
	return best
}

func GetLoanLedger(c echo.Context) error {
	ctx := auth.RequestContext(c)
	from := c.QueryParam("from")
	to := c.QueryParam("to")
	focusAmountParam := c.QueryParam("focus_amount")
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	q := LoanLedgerQuery{From: from, To: to, FocusKey: c.QueryParam("focus_key"), FocusDate: c.QueryParam("focus_date")}
	for _, k := range strings.Split(c.QueryParam("kinds"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			q.Kinds = append(q.Kinds, k)
		}
	}
	_, q.Limit, q.Offset = common.PageParams(c)
	for _, d := range []string{from, to} {
		if _, err := time.Parse("2006-01-02", d); d != "" && err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Dates must be in YYYY-MM-DD format"})
		}
	}
	if v, err := strconv.ParseFloat(focusAmountParam, 64); focusAmountParam != "" && err == nil {
		q.FocusAmount = &v
	}
	led, err := getLoanLedger(ctx, loanID, auth.GetBranchScope(c), q)
	if err != nil {
		return common.FailErr(c, err)
	}
	page := 1
	if led.Limit > 0 {
		page = led.Offset/led.Limit + 1
	}
	return common.SuccessPage(c, page, led.Limit, int64(led.Total), led.Items, echo.Map{
		"total_debit": led.TotalDebit, "total_credit": led.TotalCredit,
	})
}

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
	// Accruing marks interest worked out for this view and not saved to the loan's accruals: the days since the last
	// charge, up to the day the ledger is opened.
	Accruing bool `json:"accruing,omitempty"`
	// Component names what a split repayment row was applied to (Interest, Penal Interest, Service Charge,
	// Principal); empty for a payment shown as one row.
	Component string `json:"component,omitempty"`
	// Mode is the payment mode of a split repayment row (Cash, UPI, Bank Transfer).
	Mode string `json:"mode,omitempty"`
	// PaidThrough is the date (YYYY-MM-DD) the loan's interest is paid up to once this payment is counted; set on
	// a payment that paid interest.
	PaidThrough string `json:"paid_through,omitempty"`
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
	accruing      bool
}

func ledgerColumnTotals(rows []LoanLedgerEntry) (debit, credit float64) {
	for _, r := range rows {
		switch r.Kind {
		case "sanction", "topup", "interest", "penal", "service-charge":
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
	paidThrough := interestPaidThroughDates(l, payments, accruals)
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
	// rows charged on the same day, such as a payment's charge for the part period after the first one, keep the order
	// of the periods they cover
	accruals = append([]models.LoanAccrual(nil), accruals...)
	sort.SliceStable(accruals, func(i, j int) bool {
		if !accruals[i].AccruedOn.Equal(accruals[j].AccruedOn) {
			return accruals[i].AccruedOn.Before(accruals[j].AccruedOn)
		}
		return accruals[i].ID < accruals[j].ID
	})
	for i, a := range accruals {
		recordedInterest += a.Interest
		recordedPenal += a.PenalInterest
		at := a.AccruedOn
		// a row with no id is interest worked out for this view and not saved: it is shown on its own date and
		// marked, and has no saved row to key on
		accruing := a.ID == 0
		interestKey, penalKey := fmt.Sprintf("interest-%d", a.ID), fmt.Sprintf("penal-%d", a.ID)
		if accruing {
			interestKey, penalKey = fmt.Sprintf("interest-accruing-%d", i), fmt.Sprintf("penal-accruing-%d", i)
		}
		if p := accrualTriggerPayment(a.CreatedAt, payments); p != nil && ledgerDate(a.AccruedOn) >= ledgerDate(p.PaidOn) {
			// only the charge that runs up to the payment moves onto the payment's date; a month completed earlier
			// stays on its own month-end date instead of piling onto the payment day
			at = a.CreatedAt
			if !at.Before(p.PaidOn) {
				at = p.PaidOn.Add(-time.Millisecond)
			}
		} else if now := time.Now(); at.After(now) {
			// interest charged ahead (the first month of a new loan): shown from when it was charged, not skipped
			at = now
			if !a.CreatedAt.IsZero() && a.CreatedAt.Before(now) {
				at = a.CreatedAt
			}
		}
		if a.Interest > 0.004 {
			sources = append(sources, ledgerSource{kind: "interest", date: ledgerDate(at), sortKey: ledgerSortKey(at), rank: 2, accrualAmount: a.Interest, note: interestKey, accruing: accruing})
		}
		if a.PenalInterest > 0.004 {
			sources = append(sources, ledgerSource{kind: "penal", date: ledgerDate(at), sortKey: ledgerSortKey(at), rank: 3, accrualAmount: a.PenalInterest, note: penalKey, accruing: accruing})
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
	// whole rupees only: a gap of a few paise would show as a ₹0 row
	if missing := l.AccruedInterest - recordedInterest; common.RoundMoney(missing) >= 1 {
		sources = append(sources, ledgerSource{kind: "interest", date: ledgerDate(interestAt), sortKey: ledgerSortKey(interestAt), rank: 2, accrualAmount: common.RoundMoney(missing), note: "interest-earlier"})
	}
	if missing := l.AccruedPenalInterest - recordedPenal; common.RoundMoney(missing) >= 1 {
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
			// A loan opened on a past date is sanctioned on that date, not the day it was recorded.
			if o := l.OpenedDate.In(time.Local); !l.OpenedDate.IsZero() && o.Format("2006-01-02") < date.In(time.Local).Format("2006-01-02") {
				date = l.OpenedDate
			}
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
		// The service charge is part of the principal (withheld from the payout, or added to it), so it
		// shows as its own debit row with no mode and leaves the balance as it is.
		if l.ServiceChargeAmount > 0 {
			out = append(out, LoanLedgerEntry{Kind: "service-charge", Key: "service-charge", Date: ledgerDate(date), Amount: l.ServiceChargeAmount, Balance: ledgerBalance(first)})
		}
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
			e := LoanLedgerEntry{Kind: "payment", Date: src.date, Balance: ledgerBalance(balance), Payment: p, PaidThrough: paidThrough[p.ID]}
			if p.Type == models.PaymentTypeAuctionSale {
				for i := range auctions {
					if auctions[i].SaleAmount > 0 && auctionSalePayment(&auctions[i], []models.LoanPayment{*p}) != nil {
						e.Auction = &auctions[i]
						break
					}
				}
			}
			// A repayment is shown the way it paid the loan down: one credit row per component (processing fee,
				// penal interest, interest, principal), each in the mode it was paid by. Components are met from
				// the modes in order: cash first, then UPI, then bank transfer, and a mode that was not used is
				// skipped, so the next one covers that part.
				if comps := ledgerPaymentComponents(p); comps != nil {
				type modePart struct {
					mode   string
					amount float64
				}
				var modes []modePart
				for _, m := range []modePart{{"Cash", p.CashAmount}, {"UPI", p.UpiAmount}, {"Bank Transfer", p.BankTransferAmount}} {
					if m.amount > 0.004 {
						modes = append(modes, m)
					}
				}
				if len(modes) == 0 {
					modes = []modePart{{"", p.Amount}}
				}
				type row struct {
					component, mode string
					amount          float64
				}
				var rows []row
				mi, left := 0, modes[0].amount
				for _, c := range comps {
					need := c.amount
					for need > 0.004 && mi < len(modes) {
						take := math.Min(need, left)
						rows = append(rows, row{c.label, modes[mi].mode, common.RoundMoney(take)})
						need -= take
						left -= take
						if left <= 0.004 {
							mi++
							if mi < len(modes) {
								left = modes[mi].amount
							}
						}
					}
				}
				end := balance
				later := 0.0
				for _, r := range rows {
					later += r.amount
				}
				for i, r := range rows {
					later -= r.amount
					ce := LoanLedgerEntry{Kind: "payment", Key: fmt.Sprintf("payment-%d-%d", p.ID, i), Date: src.date, Amount: r.amount, Balance: ledgerBalance(end + later), Payment: p, Component: r.component, Mode: r.mode, PaidThrough: paidThrough[p.ID]}
					if i == 0 {
						ce.Auction = e.Auction
					}
					out = append(out, ce)
				}
				continue
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
			out = append(out, LoanLedgerEntry{Kind: src.kind, Key: src.note, Date: src.date, Amount: src.accrualAmount, Balance: ledgerBalance(balance), Note: src.note, Accruing: src.accruing})
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
		// "payment-<id>" (from a cash ledger row) names a payment, not one of its component rows.
		for i, r := range rows {
			if strings.HasPrefix(r.Key, q.FocusKey+"-") {
				return i
			}
		}
		return -1
	}
	if q.FocusAmount == nil {
		return -1
	}
	same := func(a float64) bool { return math.Abs(a-*q.FocusAmount) < 0.005 }
	// A repayment shown as component rows (interest, principal, ...) is looked for by its whole amount, or by what
	// one mode paid, since that is what the main ledger's row carries.
	modePaid := map[string]float64{}
	for _, r := range rows {
		if r.Payment != nil && r.Component != "" {
			modePaid[fmt.Sprintf("%d|%s", r.Payment.ID, r.Mode)] += r.Amount
		}
	}
	matches := func(r LoanLedgerEntry) bool {
		if same(r.Amount) {
			return true
		}
		if r.Payment != nil && r.Component != "" {
			return same(r.Payment.Amount) || same(modePaid[fmt.Sprintf("%d|%s", r.Payment.ID, r.Mode)])
		}
		return false
	}
	for i, r := range rows {
		if r.Date == q.FocusDate && matches(r) {
			return i
		}
	}
	for i, r := range rows {
		if matches(r) {
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
	l, accruals = withInterestToDate(ctx, l, accruals)
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

// withInterestToDate adds to a loan's saved interest rows the interest owed between its last charge and today, so
// the ledger always runs up to the day it is opened. It is worked out on a copy, in the same two steps a payment
// takes, and is never saved: opening the ledger on another day gives a different figure from that day's date.
// A rate step passed on the way also raises the saved rows it restates, in the returned list only. The returned
// loan is a copy that carries the interest to date; the one passed in is not changed.
func withInterestToDate(ctx context.Context, l *models.Loan, saved []models.LoanAccrual) (*models.Loan, []models.LoanAccrual) {
	owing := *l
	shown := append([]models.LoanAccrual(nil), saved...)
	asOf := sameClockAsOpened(&owing, time.Now())
	for pass := 0; pass < 2; pass++ {
		rows, restated, _ := accrueStep(ctx, &owing, asOf, true)
		for _, r := range restated {
			for i := range shown {
				if shown[i].ID == r.SavedID {
					shown[i].Interest += r.Interest
				}
			}
		}
		for _, r := range rows {
			r.ID = 0
			shown = append(shown, r)
		}
	}
	return &owing, shown
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

type ledgerComponent struct {
	label  string
	amount float64
}

// interestPaidThroughDates works out, for each payment that paid interest, the date the loan's interest is paid up
// to once that payment is counted. The interest charged so far is laid out period by period from the opening date
// (each saved charge covers the days since the one before); the interest paid in all the payments up to and
// including this one is then placed along those periods, so paying half of a month's interest lands half way through
// that month. A payment that clears a period lands on its last day.
func interestPaidThroughDates(l *models.Loan, payments []models.LoanPayment, accruals []models.LoanAccrual) map[uint]string {
	type period struct {
		start, end time.Time
		interest   float64
	}
	var saved []models.LoanAccrual
	for _, a := range accruals {
		if a.ID != 0 && a.Interest > 0.004 {
			saved = append(saved, a)
		}
	}
	sort.SliceStable(saved, func(i, j int) bool {
		if !saved[i].AccruedOn.Equal(saved[j].AccruedOn) {
			return saved[i].AccruedOn.Before(saved[j].AccruedOn)
		}
		return saved[i].ID < saved[j].ID
	})
	out := map[uint]string{}
	if len(saved) == 0 {
		return out
	}
	periods := make([]period, 0, len(saved))
	prevEnd := l.OpenedDate
	for _, a := range saved {
		end := a.AccruedOn
		if end.Before(prevEnd) {
			end = prevEnd
		}
		periods = append(periods, period{start: prevEnd, end: end, interest: a.Interest})
		prevEnd = end
	}
	// whole rupees: a period counts as cleared when what is left of it is under half a rupee
	const slack = 0.51
	dateFor := func(paid float64) (string, bool) {
		if paid <= slack {
			return "", false
		}
		var before float64
		for _, pr := range periods {
			if paid <= before+pr.interest+slack {
				left := paid - before
				if left <= slack {
					return ledgerDate(pr.start), true
				}
				if left >= pr.interest-slack {
					return ledgerDate(pr.end), true
				}
				days := math.Round(pr.end.Sub(pr.start).Hours() / 24 * left / pr.interest)
				return ledgerDate(pr.start.AddDate(0, 0, int(days))), true
			}
			before += pr.interest
		}
		return ledgerDate(periods[len(periods)-1].end), true
	}
	ordered := make([]*models.LoanPayment, 0, len(payments))
	for i := range payments {
		if payments[i].Type != models.PaymentTypeDisbursement {
			ordered = append(ordered, &payments[i])
		}
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		if !ordered[i].PaidOn.Equal(ordered[j].PaidOn) {
			return ordered[i].PaidOn.Before(ordered[j].PaidOn)
		}
		return ordered[i].ID < ordered[j].ID
	})
	var paid float64
	for _, p := range ordered {
		if p.InterestApplied <= 0.004 {
			continue
		}
		paid += p.InterestApplied
		if d, ok := dateFor(paid); ok {
			out[p.ID] = d
		}
	}
	return out
}

// ledgerPaymentComponents lists what a repayment was applied to, or nil when it is shown as one row (not a
// repayment, or an older row whose parts do not add up).
func ledgerPaymentComponents(p *models.LoanPayment) []ledgerComponent {
	switch p.Type {
	case models.PaymentTypeInterest, models.PaymentTypePenalInterest, models.PaymentTypePrincipal,
		models.PaymentTypePartial, models.PaymentTypeFullSettlement, models.PaymentTypeAuctionSale:
	default:
		return nil
	}
	comps := auctionPaymentComponents(p)
	if p.Type != models.PaymentTypeAuctionSale {
		for i := range comps {
			if comps[i].label == "Service Charge" {
				comps[i].label = "Processing Fee"
			}
		}
	}
	return comps
}

// auctionPaymentComponents lists what an auction's proceeds were applied to, in the order the loan is
// paid down. It returns nil when the parts do not add up to the payment (an older row), so the payment is
// shown as one row as before.
func auctionPaymentComponents(p *models.LoanPayment) []ledgerComponent {
	var comps []ledgerComponent
	var sum float64
	for _, c := range []ledgerComponent{
		{"Service Charge", p.ProcessingFeeApplied},
		{"Penal Interest", p.PenalInterestApplied},
		{"Interest", p.InterestApplied},
		{"Principal", p.PrincipalApplied},
	} {
		if c.amount > 0.004 {
			comps = append(comps, c)
			sum += c.amount
		}
	}
	if len(comps) == 0 || sum < p.Amount-0.01 || sum > p.Amount+0.01 {
		return nil
	}
	return comps
}

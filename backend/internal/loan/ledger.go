package loan

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"cloudhouse/backend/internal/platform"
)

// LoanLedgerMaxPageSize caps one page of GET /loans/:id/ledger.
const LoanLedgerMaxPageSize = 100

// LoanLedgerPart is one mode's share of a payment, payout or top-up split
// across modes (Cash + UPI, …) — the ledger books it as one row per mode.
type LoanLedgerPart struct {
	Mode   string  `json:"mode"`
	Amount float64 `json:"amount"`
	Index  int     `json:"index"`
	Count  int     `json:"count"`
}

// LoanLedgerEntry is one row of a loan's Payment Ledger. Kind is "sanction",
// "payment", "topup", "interest", "penal", "auction-sale" or "auction-surplus"; the record it was
// built from rides along so the client renders it exactly as before.
// Balance is nil for auction rows, which carry no running balance.
type LoanLedgerEntry struct {
	Kind    string          `json:"kind"`
	Key     string          `json:"key"`
	Date    string          `json:"date"`
	Amount  float64         `json:"amount"`
	Balance *float64        `json:"balance"`
	Part    *LoanLedgerPart `json:"part,omitempty"`
	Payment *LoanPayment    `json:"payment,omitempty"`
	TopUp   *LoanTopUp      `json:"topUp,omitempty"`
	Auction *AuctionRecord  `json:"auction,omitempty"`
	// Note describes an interest/penal accrual row.
	Note string `json:"note,omitempty"`
}

// LoanLedgerQuery narrows and pages GET /loans/:id/ledger. From/To are
// inclusive "YYYY-MM-DD" bounds. A focus (FocusKey, else FocusDate +
// FocusAmount) overrides Offset with the page holding that row.
type LoanLedgerQuery struct {
	From        string
	To          string
	// Kinds, when set, keeps only these entry kinds ("sanction", "payment",
	// "topup", "interest", "penal"; "auction" covers both auction rows).
	Kinds       []string
	Limit       int
	Offset      int
	FocusKey    string
	FocusDate   string
	FocusAmount *float64
}

// LoanLedgerPage is GET /loans/:id/ledger's response.
type LoanLedgerPage struct {
	Items  []LoanLedgerEntry `json:"items"`
	Total  int               `json:"total"`
	Limit  int               `json:"limit"`
	Offset int               `json:"offset"`
	// TotalDebit/TotalCredit sum the Debit and Credit columns over every row in
	// the filtered range (not just this page) — the ledger footer's Total row.
	TotalDebit  float64 `json:"totalDebit"`
	TotalCredit float64 `json:"totalCredit"`
}

// ledgerColumnTotals sums the Debit and Credit columns the way the ledger
// table shows them: a sanction, top-up or refunded auction surplus is a debit,
// a payment a credit; the auction sale and a non-refunded surplus carry no
// cash column.
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

type ledgerSource struct {
	kind    string
	date    string
	sortKey string
	// rank breaks a sortKey tie: a payout (top-up, re-disbursement) lands
	// before a collection booked at the same instant — e.g. the interest
	// withheld from a top-up, which is stamped with the top-up's own time.
	rank    int
	payment *LoanPayment
	topUp   *LoanTopUp
	auction *AuctionRecord
	// accrual rows: amount is the interest or penal charge itself.
	accrualAmount float64
	note          string
}

func ledgerDate(t time.Time) string {
	return t.Format("2006-01-02")
}

// ledgerSortKey is a fixed-width UTC timestamp, so payments (stamped with a
// PaidOn) and top-ups (stamped with an OccurredOn) order against each other
// within a day instead of every payment sorting ahead of every top-up.
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

func auctionLedgerSaleDate(a *AuctionRecord) string {
	for _, e := range a.Events {
		if e.Action == AuctionEventSaleRecorded {
			return ledgerDate(e.CreatedAt)
		}
	}
	if a.AuctionDate != nil {
		return ledgerDate(*a.AuctionDate)
	}
	return ledgerDate(a.AuctionEligibleDate)
}

func auctionLedgerSurplusDate(a *AuctionRecord) string {
	for _, e := range a.Events {
		if e.Action == AuctionEventSettled {
			return ledgerDate(e.CreatedAt)
		}
	}
	return auctionLedgerSaleDate(a)
}

// auctionSalePayment is the Auction Sale payment RecordAuctionSale wrote for
// this case's proceeds, matched on the auction reference when it has one.
func auctionSalePayment(a *AuctionRecord, payments []LoanPayment) *LoanPayment {
	for i := range payments {
		p := &payments[i]
		if p.Type == PaymentTypeAuctionSale && (a.AuctionReferenceNumber == "" || p.Reference == a.AuctionReferenceNumber) {
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

// expandLedgerParts books one event as a row per mode (or one row when it
// isn't split). balanceAt gives each row's balance from the amount still to
// come after it within the same event.
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

// buildLoanLedger merges the sanction, payments, top-ups and auction rows
// into one chronological timeline with running balances carried over the
// WHOLE history — callers filter/page afterwards so a later page still shows
// the true figure. Mirrors what LoanDetail.tsx used to assemble itself.
func buildLoanLedger(l *Loan, payments []LoanPayment, topUps []LoanTopUp, auctions []AuctionRecord, accruals []LoanAccrual) []LoanLedgerEntry {
	var disbursement *LoanPayment
	disbursementCount := 0
	sources := make([]ledgerSource, 0, len(payments)+len(topUps)+2*len(auctions))
	for i := range payments {
		p := &payments[i]
		if p.Type == PaymentTypeDisbursement {
			disbursementCount++
			if disbursement == nil {
				disbursement = p
			} else {
				// An edit retracts the first payout (see UpdateLoan) and the
				// re-sanction pays out again — the earlier row stays, this
				// later one follows it.
				sources = append(sources, ledgerSource{kind: "redisbursement", date: ledgerDate(p.PaidOn), sortKey: ledgerSortKey(p.PaidOn), rank: 0, payment: p})
			}
			continue
		}
		sources = append(sources, ledgerSource{kind: "payment", date: ledgerDate(p.PaidOn), sortKey: ledgerSortKey(p.PaidOn), rank: 1, payment: p})
	}
	for i := range topUps {
		t := &topUps[i]
		if t.Status == TopUpStatusPending || t.Status == TopUpStatusRejected {
			continue
		}
		sources = append(sources, ledgerSource{kind: "topup", date: ledgerDate(t.OccurredOn), sortKey: ledgerSortKey(t.OccurredOn), rank: 0, topUp: t})
	}
	// Interest and penal interest charged to the loan, one row each per accrual
	// run. Accruals from before runs were recorded are covered by one catch-up
	// row per kind, dated at the loan's last accrual, so the ledger's totals
	// still agree with what the loan has accrued.
	var recordedInterest, recordedPenal float64
	for _, a := range accruals {
		recordedInterest += a.Interest
		recordedPenal += a.PenalInterest
		// AccruedOn is the billing anchor — for a loan's first month a whole
		// month AHEAD of the day the charge was booked. The charge shows when
		// that date arrives, not before (its amount is already in
		// recordedInterest, so the catch-up row below never double-books it).
		at := a.AccruedOn
		// A charge booked by a payment (RecordPayment accrues first) reads
		// as the debit that payment settles, so it goes just before it.
		if p := accrualTriggerPayment(a.CreatedAt, payments); p != nil {
			// When the charge was actually booked; never later than the
			// payment it belongs to (older rows stamped the payment first).
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
		// The last accrual date is a billing anchor ahead of today (a first
		// month is charged up front), so the charge was booked when the loan
		// was created — the only time recorded for it — not on that future date.
		if !l.CreatedAt.IsZero() && l.CreatedAt.Before(now) {
			catchUpAt = l.CreatedAt
		} else {
			catchUpAt = now
		}
	}
	// Interest can only be paid once it has accrued, so a catch-up charge (one
	// with no history row of its own) belongs before the first payment that
	// settled any of that kind — time order, not a fixed position.
	catchUpFor := func(applied func(*LoanPayment) float64) time.Time {
		at := catchUpAt
		for i := range payments {
			p := &payments[i]
			if p.Type == PaymentTypeDisbursement || applied(p) <= 0 {
				continue
			}
			if before := p.PaidOn.Add(-time.Millisecond); before.Before(at) {
				at = before
			}
		}
		return at
	}
	interestAt := catchUpFor(func(p *LoanPayment) float64 { return p.InterestApplied })
	penalAt := catchUpFor(func(p *LoanPayment) float64 { return p.PenalInterestApplied })
	if missing := l.AccruedInterest - recordedInterest; missing > 0.01 {
		sources = append(sources, ledgerSource{kind: "interest", date: ledgerDate(interestAt), sortKey: ledgerSortKey(interestAt), rank: 2, accrualAmount: platform.RoundMoney(missing), note: "interest-earlier"})
	}
	if missing := l.AccruedPenalInterest - recordedPenal; missing > 0.01 {
		sources = append(sources, ledgerSource{kind: "penal", date: ledgerDate(penalAt), sortKey: ledgerSortKey(penalAt), rank: 3, accrualAmount: platform.RoundMoney(missing), note: "penal-earlier"})
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
	// With interest/penal rows in the ledger the Balance column is what the
	// customer owes in total: charges add to it and every payment (whatever
	// bucket it clears) comes off it. Without any, it stays the principal
	// balance each payment recorded.
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
			// More than one payout, or none current, means the loan was
			// edited after disbursing: this first row describes the
			// ORIGINAL payout, not the loan's current figures.
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
			if p.Type == PaymentTypeAuctionSale {
				for i := range auctions {
					if auctions[i].SaleAmount > 0 && auctionSalePayment(&auctions[i], []LoanPayment{*p}) != nil {
						e.Auction = &auctions[i]
						break
					}
				}
			}
			parts := ledgerSplitParts(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
			out = append(out, expandLedgerParts(e, p.Amount, parts, fmt.Sprintf("payment-%d", p.ID), func(later float64, _ LoanLedgerPart) float64 { return balance + later })...)
		case "topup":
			t := src.topUp
			active := t.Status == TopUpStatusActive
			parts := ledgerSplitParts(t.CashAmount, t.UpiAmount, t.BankTransferAmount, t.ChequeAmount)
			if len(parts) == 0 && active {
				balance += t.Amount
			}
			e := LoanLedgerEntry{Kind: "topup", Date: src.date, Balance: ledgerBalance(balance), TopUp: t}
			// A top-up's balance grows part by part, so it is accumulated here
			// rather than derived from what's still to come.
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

// ledgerFocusIndex is the index of the row to open the ledger on: the row
// with focusKey, else the same transaction by date and amount, else by
// amount alone — the same matching useLedgerFocus.ts highlights with.
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

// GetLoanLedger returns one page of a loan's Payment Ledger, oldest first —
// backs GET /loans/:id/ledger. The timeline is built from the loan's whole
// history (one query per source, no per-row lookups) because every row's
// running balance depends on all the rows before it.
func (s *Service) GetLoanLedger(ctx context.Context, loanID uint, branchID *uint, q LoanLedgerQuery) (*LoanLedgerPage, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, ErrNotFound
	}
	payments, _, err := s.paymentRepo.FindByLoanIDPaged(ctx, loanID, 0, 0)
	if err != nil {
		return nil, err
	}
	topUps, err := s.topUpRepo.FindByLoanID(ctx, loanID)
	if err != nil {
		return nil, err
	}
	auctions, err := s.auctionRepo.FindHistoryByLoanID(ctx, loanID)
	if err != nil {
		return nil, err
	}
	var accruals []LoanAccrual
	if err := s.db.WithContext(ctx).Where("loan_id = ?", loanID).Order("accrued_on asc, id asc").Find(&accruals).Error; err != nil {
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
	if limit <= 0 || limit > LoanLedgerMaxPageSize {
		limit = LoanLedgerMaxPageSize
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
	return &LoanLedgerPage{Items: rows[offset:end], Total: len(rows), Limit: limit, Offset: offset, TotalDebit: platform.RoundMoney(totalDebit), TotalCredit: platform.RoundMoney(totalCredit)}, nil
}

// accrualTriggerWindow is how soon after an accrual was booked a payment must
// have been saved to count as the payment that triggered it (RecordPayment
// accrues, then saves the payment moments later in the same request).
const accrualTriggerWindow = 10 * time.Second

// accrualTriggerPayment returns the payment saved within accrualTriggerWindow
// after an accrual was booked, nil when none was (a scheduled accrual run).
func accrualTriggerPayment(accruedAt time.Time, payments []LoanPayment) *LoanPayment {
	if accruedAt.IsZero() {
		return nil
	}
	var best *LoanPayment
	for i := range payments {
		p := &payments[i]
		if p.Type == PaymentTypeDisbursement || p.CreatedAt.Before(accruedAt) || p.CreatedAt.Sub(accruedAt) > accrualTriggerWindow {
			continue
		}
		if best == nil || p.CreatedAt.Before(best.CreatedAt) {
			best = p
		}
	}
	return best
}

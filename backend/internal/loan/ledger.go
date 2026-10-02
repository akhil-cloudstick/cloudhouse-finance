package loan

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"
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
// "payment", "topup", "auction-sale" or "auction-surplus"; the record it was
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
}

// LoanLedgerQuery narrows and pages GET /loans/:id/ledger. From/To are
// inclusive "YYYY-MM-DD" bounds. A focus (FocusKey, else FocusDate +
// FocusAmount) overrides Offset with the page holding that row.
type LoanLedgerQuery struct {
	From        string
	To          string
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
}

type ledgerSource struct {
	kind    string
	date    string
	sortKey string
	payment *LoanPayment
	topUp   *LoanTopUp
	auction *AuctionRecord
}

func ledgerDate(t time.Time) string {
	return t.Format("2006-01-02")
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
func buildLoanLedger(l *Loan, payments []LoanPayment, topUps []LoanTopUp, auctions []AuctionRecord) []LoanLedgerEntry {
	var disbursement *LoanPayment
	sources := make([]ledgerSource, 0, len(payments)+len(topUps)+2*len(auctions))
	for i := range payments {
		p := &payments[i]
		if p.Type == PaymentTypeDisbursement {
			if disbursement == nil {
				disbursement = p
			}
			continue
		}
		sources = append(sources, ledgerSource{kind: "payment", date: ledgerDate(p.PaidOn), sortKey: ledgerDate(p.PaidOn), payment: p})
	}
	for i := range topUps {
		t := &topUps[i]
		if t.Status == TopUpStatusPending || t.Status == TopUpStatusRejected {
			continue
		}
		sources = append(sources, ledgerSource{kind: "topup", date: ledgerDate(t.OccurredOn), sortKey: t.OccurredOn.Format(time.RFC3339Nano), topUp: t})
	}
	for i := range auctions {
		a := &auctions[i]
		if a.SaleAmount <= 0 {
			continue
		}
		if auctionSalePayment(a, payments) == nil {
			d := auctionLedgerSaleDate(a)
			sources = append(sources, ledgerSource{kind: "auction-sale", date: d, sortKey: d, auction: a})
		}
		if a.SurplusPayableAmount > 0.01 {
			d := auctionLedgerSurplusDate(a)
			sources = append(sources, ledgerSource{kind: "auction-surplus", date: d, sortKey: d + "~", auction: a})
		}
	}
	sort.SliceStable(sources, func(i, j int) bool { return sources[i].sortKey < sources[j].sortKey })
	balance := l.SanctionedAmount
	out := make([]LoanLedgerEntry, 0, len(sources)+1)
	if l.DisbursementDate != nil {
		var parts []LoanLedgerPart
		if disbursement != nil {
			parts = ledgerSplitParts(disbursement.CashAmount, disbursement.UpiAmount, disbursement.BankTransferAmount, disbursement.ChequeAmount)
		}
		e := LoanLedgerEntry{Kind: "sanction", Date: ledgerDate(*l.DisbursementDate), Balance: ledgerBalance(balance), Payment: disbursement}
		out = append(out, expandLedgerParts(e, l.DisbursedAmount, parts, "sanction", func(later float64, _ LoanLedgerPart) float64 { return balance - later })...)
	}
	for _, src := range sources {
		switch src.kind {
		case "payment":
			p := src.payment
			balance = p.RunningBalance
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
		case "auction-sale":
			out = append(out, LoanLedgerEntry{Kind: src.kind, Key: fmt.Sprintf("auction-sale-%d", src.auction.ID), Date: src.date, Amount: src.auction.SaleAmount, Auction: src.auction})
		case "auction-surplus":
			out = append(out, LoanLedgerEntry{Kind: src.kind, Key: fmt.Sprintf("auction-surplus-%d", src.auction.ID), Date: src.date, Amount: src.auction.SurplusPayableAmount, Auction: src.auction})
		}
	}
	return out
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
	all := buildLoanLedger(l, payments, topUps, auctions)
	rows := make([]LoanLedgerEntry, 0, len(all))
	for _, r := range all {
		if (q.From == "" || r.Date >= q.From) && (q.To == "" || r.Date <= q.To) {
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
	return &LoanLedgerPage{Items: rows[offset:end], Total: len(rows), Limit: limit, Offset: offset}, nil
}

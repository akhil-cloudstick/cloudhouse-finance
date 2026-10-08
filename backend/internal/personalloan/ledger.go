package personalloan

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"cloudhouse/backend/internal/bank"
	"cloudhouse/backend/internal/platform"
)

// Ledger row kinds.
const (
	LedgerKindDisbursement = "disbursement"
	LedgerKindCharge       = "charge" // non-cash debit: upfront interest / balance carried from a renewed loan
	LedgerKindPenal        = "penal"
	LedgerKindPayment      = "payment"
	LedgerKindRollover     = "rollover"
)

// LedgerPart is one mode's share of a split payment — one ledger row per mode.
type LedgerPart struct {
	Mode   string  `json:"mode"`
	Amount float64 `json:"amount"`
	Index  int     `json:"index"`
	Count  int     `json:"count"`
}

// LedgerRow is one row of a personal loan's Payment History ledger. Debit is
// what increases the balance owed (the disbursement, upfront interest, penal
// interest); Credit is what the customer paid back. Balance is the
// outstanding amount after the row. The legacy PersonalLoanPayment JSON
// fields are kept so existing readers of the payments endpoint keep working
// (for split payments amount is the single mode's share).
type LedgerRow struct {
	Key         string  `json:"key"`
	Kind        string  `json:"kind"`
	Date        string  `json:"date"`
	RefNo       string  `json:"refNo"`
	Particulars string  `json:"particulars"`
	Mode        string  `json:"mode"` // Cash | UPI | Bank Transfer | Cheque | "" (non-cash entry)
	BankID      *uint   `json:"bankId"`
	BankName    string  `json:"bankName"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Balance     float64 `json:"balance"`
	// Part is set on a row that is one mode's share of a split payment.
	Part *LedgerPart `json:"part,omitempty"`

	// Legacy PersonalLoanPayment fields.
	ID                 uint       `json:"id"`
	PersonalLoanID     uint       `json:"personalLoanId"`
	Amount             float64    `json:"amount"`
	PaidOn             time.Time  `json:"paidOn"`
	Method             string     `json:"method"`
	Reference          string     `json:"reference"`
	Description        string     `json:"description"`
	CashAmount         float64    `json:"cashAmount"`
	UpiAmount          float64    `json:"upiAmount"`
	BankTransferAmount float64    `json:"bankTransferAmount"`
	ChequeAmount       float64    `json:"chequeAmount"`
	BankRef            *bank.Bank `json:"bankRef,omitempty"`
	NeedsModeReview    bool       `json:"needsModeReview"`
	RunningBalance     float64    `json:"runningBalance"`
	InstallmentID      *uint      `json:"installmentId"`
}

type ledgerEvent struct {
	at   time.Time
	rank int
	id   uint
	rows func(balance float64) []LedgerRow
}

func ledgerModeParts(p *PersonalLoanPayment) []LedgerPart {
	modes := []LedgerPart{{Mode: "Cash", Amount: p.CashAmount}, {Mode: "UPI", Amount: p.UpiAmount}, {Mode: "Bank Transfer", Amount: p.BankTransferAmount}, {Mode: "Cheque", Amount: p.ChequeAmount}}
	parts := make([]LedgerPart, 0, len(modes))
	for _, m := range modes {
		if m.Amount > 0 {
			parts = append(parts, m)
		}
	}
	for i := range parts {
		parts[i].Index = i
		parts[i].Count = len(parts)
	}
	return parts
}

// BuildLedger merges the loan's disbursement, non-cash charges, penal
// interest and payments into one chronological (oldest first) timeline with
// running balances over the WHOLE history. Ties break by event order then id.
func BuildLedger(l *PersonalLoan, payments []PersonalLoanPayment, penal []PersonalLoanHistory) []LedgerRow {
	var events []ledgerEvent
	base := func(kind, key string, at time.Time) LedgerRow {
		return LedgerRow{Key: key, Kind: kind, Date: at.Format("2006-01-02"), RefNo: l.LoanNumber, PersonalLoanID: l.ID, PaidOn: at}
	}
	if l.Status != StatusPendingApproval && l.Status != StatusRejected {
		at := l.DisbursedAt
		if at.IsZero() {
			at = l.OpenedDate
		}
		events = append(events, ledgerEvent{at: at, rank: 0, rows: func(bal float64) []LedgerRow {
			r := base(LedgerKindDisbursement, "disbursement", at)
			r.Particulars, r.Mode, r.Method = "Loan disbursed", "Cash", "Cash"
			r.Debit, r.Amount, r.CashAmount = l.DisbursedAmount, l.DisbursedAmount, l.DisbursedAmount
			r.Balance = bal + l.DisbursedAmount
			r.RunningBalance = r.Balance
			return []LedgerRow{r}
		}})
		extra := l.PrincipalAmount - l.DisbursedAmount
		interestRow := l.InterestAmount
		if interestRow > extra {
			interestRow = extra
		}
		if interestRow > epsilon {
			events = append(events, ledgerEvent{at: at, rank: 1, rows: func(bal float64) []LedgerRow {
				r := base(LedgerKindCharge, "interest", at)
				r.Particulars, r.Debit, r.Amount = "Interest", interestRow, interestRow
				r.Balance = bal + interestRow
				r.RunningBalance = r.Balance
				return []LedgerRow{r}
			}})
			extra -= interestRow
		}
		if extra > epsilon {
			carry := extra
			events = append(events, ledgerEvent{at: at, rank: 2, rows: func(bal float64) []LedgerRow {
				r := base(LedgerKindCharge, "carry-forward", at)
				r.Particulars, r.Debit, r.Amount = "Balance carried from renewed loan", carry, carry
				r.Balance = bal + carry
				r.RunningBalance = r.Balance
				return []LedgerRow{r}
			}})
		}
	}
	for i := range penal {
		h := penal[i]
		if h.Event != EventPenalApplied {
			continue
		}
		events = append(events, ledgerEvent{at: h.OccurredAt, rank: 3, id: h.ID, rows: func(bal float64) []LedgerRow {
			r := base(LedgerKindPenal, fmt.Sprintf("penal-%d", h.ID), h.OccurredAt)
			r.Particulars, r.Debit, r.Amount = "Penal interest", h.Amount, h.Amount
			r.Description = h.Detail
			r.Balance = bal + h.Amount
			r.RunningBalance = r.Balance
			return []LedgerRow{r}
		}})
	}
	for i := range payments {
		p := payments[i]
		events = append(events, ledgerEvent{at: p.PaidOn, rank: 4, id: p.ID, rows: func(bal float64) []LedgerRow {
			mk := func(key string) LedgerRow {
				r := base(LedgerKindPayment, key, p.PaidOn)
				r.ID, r.Credit, r.Amount = p.ID, p.Amount, p.Amount
				r.Method, r.Reference, r.Description = p.Method, p.Reference, p.Description
				r.CashAmount, r.UpiAmount, r.BankTransferAmount, r.ChequeAmount = p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount
				r.NeedsModeReview, r.InstallmentID = p.NeedsModeReview, p.InstallmentID
				r.Balance = bal - p.Amount
				r.RunningBalance = r.Balance
				return r
			}
			if p.Method == PaymentMethodRenewalRollover {
				r := mk(fmt.Sprintf("payment-%d", p.ID))
				r.Kind, r.Particulars = LedgerKindRollover, "Renewal rollover"
				return []LedgerRow{r}
			}
			setBank := func(r *LedgerRow) {
				if r.Mode != "" && r.Mode != "Cash" {
					r.BankID = p.BankID
					if p.BankRef != nil {
						r.BankName = p.BankRef.Name
						r.BankRef = p.BankRef
					}
				}
			}
			parts := ledgerModeParts(&p)
			if len(parts) < 2 {
				r := mk(fmt.Sprintf("payment-%d", p.ID))
				r.Particulars = "Instalment collected"
				r.Mode = p.Method
				if len(parts) == 1 {
					r.Mode = parts[0].Mode
				} else if r.Mode == "" {
					r.Mode = "Cash"
				}
				setBank(&r)
				return []LedgerRow{r}
			}
			out := make([]LedgerRow, 0, len(parts))
			later := p.Amount
			for _, pt := range parts {
				pt := pt
				later -= pt.Amount
				r := mk(fmt.Sprintf("payment-%d-%s", p.ID, strings.ReplaceAll(pt.Mode, " ", "")))
				r.Particulars, r.Mode, r.Part = "Instalment collected", pt.Mode, &pt
				r.Credit, r.Amount = pt.Amount, pt.Amount
				r.Balance = bal - p.Amount + later
				r.RunningBalance = r.Balance
				setBank(&r)
				out = append(out, r)
			}
			return out
		}})
	}
	sort.SliceStable(events, func(i, j int) bool {
		a, b := events[i], events[j]
		if !a.at.Equal(b.at) {
			return a.at.Before(b.at)
		}
		if a.rank != b.rank {
			return a.rank < b.rank
		}
		return a.id < b.id
	})
	rows := make([]LedgerRow, 0, len(events))
	bal := 0.0
	for _, e := range events {
		rs := e.rows(bal)
		rows = append(rows, rs...)
		if len(rs) > 0 {
			bal = rs[len(rs)-1].Balance
		}
	}
	return rows
}

// GetLedger returns one page of the loan's Payment History ledger — backs
// GET /personal-loans/:id/payments. order "desc" reverses (newest first);
// default is oldest first. total counts ledger rows.
func (s *Service) GetLedger(ctx context.Context, loanID uint, branchID *uint, limit, offset int, order string) ([]LedgerRow, bool, int64, LedgerTotals, error) {
	var totals LedgerTotals
	l, err := s.Get(ctx, loanID, branchID)
	if err != nil {
		return nil, false, 0, totals, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	if offset < 0 {
		offset = 0
	}
	var payments []PersonalLoanPayment
	if err := s.repo.DB().WithContext(ctx).Preload("BankRef").Where("personal_loan_id = ?", loanID).Order("id asc").Find(&payments).Error; err != nil {
		return nil, false, 0, totals, err
	}
	var penal []PersonalLoanHistory
	if err := s.repo.DB().WithContext(ctx).Where("personal_loan_id = ? AND event = ?", loanID, EventPenalApplied).Order("id asc").Find(&penal).Error; err != nil {
		return nil, false, 0, totals, err
	}
	rows := BuildLedger(l, payments, penal)
	for _, r := range rows {
		totals.Debit += r.Debit
		totals.Credit += r.Credit
	}
	totals.Debit, totals.Credit = platform.RoundMoney(totals.Debit), platform.RoundMoney(totals.Credit)
	if strings.EqualFold(order, "desc") {
		for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
			rows[i], rows[j] = rows[j], rows[i]
		}
	}
	total := int64(len(rows))
	if offset > len(rows) {
		offset = len(rows)
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	return rows[offset:end], end < len(rows), total, totals, nil
}

// LedgerTotals are the Debit and Credit column sums over the loan's whole
// ledger (every page) — the footer's Total row.
type LedgerTotals struct {
	Debit  float64
	Credit float64
}

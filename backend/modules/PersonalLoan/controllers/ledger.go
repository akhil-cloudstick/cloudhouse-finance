package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

type LedgerPart struct {
	Mode   string  `json:"mode"`
	Amount float64 `json:"amount"`
	Index  int     `json:"index"`
	Count  int     `json:"count"`
}

type LedgerRow struct {
	Key                string             `json:"key"`
	Kind               string             `json:"kind"`
	Date               string             `json:"date"`
	RefNo              string             `json:"ref_no"`
	Particulars        string             `json:"particulars"`
	Mode               string             `json:"mode"`
	BankID             *uint              `json:"bank_id"`
	BankName           string             `json:"bank_name"`
	Debit              float64            `json:"debit"`
	Credit             float64            `json:"credit"`
	Balance            float64            `json:"balance"`
	Part               *LedgerPart        `json:"part,omitempty"`
	ID                 uint               `json:"id"`
	PersonalLoanID     uint               `json:"personal_loan_id"`
	Amount             float64            `json:"amount"`
	PaidOn             time.Time          `json:"paid_on"`
	Method             string             `json:"method"`
	Reference          string             `json:"reference"`
	Description        string             `json:"description"`
	CashAmount         float64            `json:"cash_amount"`
	UpiAmount          float64            `json:"upi_amount"`
	BankTransferAmount float64            `json:"bank_transfer_amount"`
	ChequeAmount       float64            `json:"cheque_amount"`
	BankRef            *commonModels.Bank `json:"bank_ref,omitempty"`
	NeedsModeReview    bool               `json:"needs_mode_review"`
	RunningBalance     float64            `json:"running_balance"`
	InstallmentID      *uint              `json:"installment_id"`
}

type ledgerEvent struct {
	at   time.Time
	rank int
	id   uint
	rows func(balance float64) []LedgerRow
}

type LedgerTotals struct {
	Debit  float64
	Credit float64
}

func ledgerModeParts(p *models.PersonalLoanPayment) []LedgerPart {
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

func BuildLedger(l *models.PersonalLoan, payments []models.PersonalLoanPayment, penal []models.PersonalLoanHistory) []LedgerRow {
	var events []ledgerEvent
	base := func(kind, key string, at time.Time) LedgerRow {
		return LedgerRow{Key: key, Kind: kind, Date: at.Format("2006-01-02"), RefNo: l.LoanNumber, PersonalLoanID: l.ID, PaidOn: at}
	}
	if l.Status != models.StatusPendingApproval && l.Status != "Rejected" {
		at := l.DisbursedAt
		if at.IsZero() {
			at = l.OpenedDate
		}
		events = append(events, ledgerEvent{at: at, rank: 0, rows: func(bal float64) []LedgerRow {
			r := base("disbursement", "disbursement", at)
			// the mode the money really left by; a loan with no split recorded was paid in cash
			cash, upi, bank, cheque := l.DisbursementCashAmount, l.DisbursementUpiAmount, l.DisbursementBankTransferAmount, l.DisbursementChequeAmount
			if common.RoundMoney(cash+upi+bank+cheque) == 0 {
				cash = l.DisbursedAmount
			}
			method := common.DeriveMethod(cash, upi, bank, cheque)
			r.Particulars, r.Mode, r.Method = "Loan disbursed", method, method
			r.Debit, r.Amount = l.DisbursedAmount, l.DisbursedAmount
			r.CashAmount, r.UpiAmount, r.BankTransferAmount, r.ChequeAmount = cash, upi, bank, cheque
			if upi+bank+cheque > 0 {
				r.BankID = l.DisbursementBankID
			}
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
				r := base("charge", "interest", at)
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
				r := base("charge", "carry-forward", at)
				r.Particulars, r.Debit, r.Amount = "Balance carried from renewed loan", carry, carry
				r.Balance = bal + carry
				r.RunningBalance = r.Balance
				return []LedgerRow{r}
			}})
		}
	}
	for i := range penal {
		h := penal[i]
		if h.Event != models.EventPenalApplied {
			continue
		}
		events = append(events, ledgerEvent{at: h.OccurredAt, rank: 3, id: h.ID, rows: func(bal float64) []LedgerRow {
			r := base("penal", fmt.Sprintf("penal-%d", h.ID), h.OccurredAt)
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
				r := base("payment", key, p.PaidOn)
				r.ID, r.Credit, r.Amount = p.ID, p.Amount, p.Amount
				r.Method, r.Reference, r.Description = p.Method, p.Reference, p.Description
				r.CashAmount, r.UpiAmount, r.BankTransferAmount, r.ChequeAmount = p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount
				r.NeedsModeReview, r.InstallmentID = p.NeedsModeReview, p.InstallmentID
				r.Balance = bal - p.Amount
				r.RunningBalance = r.Balance
				return r
			}
			if p.Method == "Renewal Rollover" {
				r := mk(fmt.Sprintf("payment-%d", p.ID))
				r.Kind, r.Particulars = "rollover", "Renewal rollover"
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

func getLedger(ctx context.Context, loanID uint, branchID *uint, limit, offset int, order string) ([]LedgerRow, bool, int64, LedgerTotals, error) {
	var totals LedgerTotals
	l, err := getPersonalLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, false, 0, totals, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	if offset < 0 {
		offset = 0
	}
	var payments []models.PersonalLoanPayment
	if err := personalLoanDB().WithContext(ctx).Preload("BankRef").Where("personal_loan_id = ?", loanID).Order("id asc").Find(&payments).Error; err != nil {
		return nil, false, 0, totals, err
	}
	var penal []models.PersonalLoanHistory
	if err := personalLoanDB().WithContext(ctx).Where("personal_loan_id = ? AND event = ?", loanID, models.EventPenalApplied).Order("id asc").Find(&penal).Error; err != nil {
		return nil, false, 0, totals, err
	}
	rows := BuildLedger(l, payments, penal)
	for _, r := range rows {
		totals.Debit += r.Debit
		totals.Credit += r.Credit
	}
	totals.Debit, totals.Credit = common.RoundMoney(totals.Debit), common.RoundMoney(totals.Credit)
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

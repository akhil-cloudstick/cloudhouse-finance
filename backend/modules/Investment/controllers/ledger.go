package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Investment/models"
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
)

type LedgerRow struct {
	ID             string    `json:"id"`
	Date           time.Time `json:"date"`
	Description    string    `json:"description"`
	Type           string    `json:"type"`
	Method         string    `json:"method"`
	Reference      string    `json:"reference"`
	DebitOrCredit  string    `json:"debit_or_credit"`
	Amount         float64   `json:"amount"`
	PrincipalPart  float64   `json:"principal_amount"`
	InterestPart   float64   `json:"interest_amount"`
	RunningBalance float64   `json:"running_balance"`
	// Fields below let the page offer Edit / Delete on a row (the server re-checks every rule when it is used).
	// EntryKind is opening, deposit, withdrawal or payout; EntryAmount is the whole entry (an opening deposit paid
	// in several modes shows one row per mode, Edit sits on the first).
	EntryKind          string  `json:"entry_kind"`
	EntryAmount        float64 `json:"entry_amount"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
	Editable           bool    `json:"editable"`
	Deletable          bool    `json:"deletable"`
}

func getLedger(ctx context.Context, investmentID uint, branchID *uint) ([]LedgerRow, error) {
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	var rows []LedgerRow
	if inv.Engine == models.EngineLive {
		txs, err := findAllTransactions(ctx, inv.ID)
		if err != nil {
			return nil, err
		}
		opening := inv.PrincipalAmount
		if len(txs) > 0 {
			opening = txs[0].PrincipalBefore
		}
		live := liveEntriesEditable(ctx, inv)
		openRows := openingRows(ctx, inv, opening)
		if len(openRows) > 0 && !live {
			openRows[0].Editable = false
		}
		rows = append(rows, openRows...)
		var ids []*uint
		for _, t := range txs {
			ids = append(ids, t.CashMovementID)
		}
		banks := movementBanks(ctx, ids)
		for _, t := range txs {
			row := LedgerRow{
				ID:                 fmt.Sprintf("tx-%d", t.ID),
				Date:               t.OccurredOn,
				Type:               t.Type,
				Method:             splitMethod(t.CashAmount, t.UpiAmount, t.BankTransferAmount, t.ChequeAmount),
				Reference:          inv.InvestmentNumber,
				Amount:             t.Amount,
				PrincipalPart:      t.PrincipalAmount,
				InterestPart:       t.InterestAmount,
				RunningBalance:     t.PrincipalAfter,
				EntryAmount:        t.Amount,
				CashAmount:         t.CashAmount,
				UpiAmount:          t.UpiAmount,
				BankTransferAmount: t.BankTransferAmount,
				ChequeAmount:       t.ChequeAmount,
				Editable:           live,
				Deletable:          live,
			}
			if t.CashMovementID != nil {
				row.BankID = banks[*t.CashMovementID]
			}
			if t.Type == "Deposit" {
				row.EntryKind = "deposit"
				row.DebitOrCredit = "credit"
				row.Description = "Additional deposit"
			} else {
				row.EntryKind = "withdrawal"
				row.DebitOrCredit = "debit"
				row.Description = withdrawalDescription(t.PrincipalAmount, t.InterestAmount)
			}
			rows = append(rows, row)
		}
		return rows, nil
	}
	payouts, err := findPaidPayouts(ctx, inv.ID)
	if err != nil {
		return nil, err
	}
	balance := inv.PrincipalAmount
	openRows := openingRows(ctx, inv, balance)
	if len(openRows) > 0 && openRows[0].Editable {
		openRows[0].Editable = scheduleOpeningEditable(inv, len(payouts))
	}
	rows = append(rows, openRows...)
	var ids []*uint
	for _, p := range payouts {
		ids = append(ids, p.CashMovementID)
	}
	banks := movementBanks(ctx, ids)
	for _, p := range payouts {
		row := LedgerRow{
			ID:                 fmt.Sprintf("payout-%d", p.ID),
			Type:               "Interest payout",
			Method:             splitMethod(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount),
			Reference:          inv.InvestmentNumber,
			DebitOrCredit:      "debit",
			Amount:             p.Amount,
			InterestPart:       p.Amount,
			Description:        fmt.Sprintf("Interest payout #%d (due %s)", p.SequenceNo, p.DueDate.Format("02-Jan-06")),
			EntryKind:          "payout",
			EntryAmount:        p.Amount,
			CashAmount:         p.CashAmount,
			UpiAmount:          p.UpiAmount,
			BankTransferAmount: p.BankTransferAmount,
			ChequeAmount:       p.ChequeAmount,
			Editable:           true,
			Deletable:          true,
		}
		if p.CashMovementID != nil {
			row.BankID = banks[*p.CashMovementID]
		}
		if p.PaidAt != nil {
			row.Date = *p.PaidAt
		} else {
			row.Date = p.DueDate
		}
		if p.IsPrincipalReturn {
			row.Type = "Principal return"
			row.PrincipalPart = inv.PrincipalAmount
			row.InterestPart = common.RoundMoney(p.Amount - inv.PrincipalAmount)
			row.Description = fmt.Sprintf("Principal + final interest #%d", p.SequenceNo)
			balance = 0
		}
		row.RunningBalance = balance
		rows = append(rows, row)
	}
	tail := rows[len(openRows):]
	sort.SliceStable(tail, func(i, j int) bool { return tail[i].Date.Before(tail[j].Date) })
	return rows, nil
}

// movementBanks returns the bank each cash line group was booked against, keyed by the first line's id (what a
// payout or transaction row stores). Entries paid in cash only have no bank.
func movementBanks(ctx context.Context, ids []*uint) map[uint]*uint {
	out := map[uint]*uint{}
	var want []uint
	for _, id := range ids {
		if id != nil {
			want = append(want, *id)
		}
	}
	if len(want) == 0 {
		return out
	}
	var first []struct {
		ID                 uint
		TransactionGroupID string
	}
	if err := investmentDB().WithContext(ctx).Table("cash_movements").Select("id, transaction_group_id").Where("id IN ?", want).Scan(&first).Error; err != nil {
		return out
	}
	groupOf := map[uint]string{}
	var groups []string
	for _, f := range first {
		if f.TransactionGroupID != "" {
			groupOf[f.ID] = f.TransactionGroupID
			groups = append(groups, f.TransactionGroupID)
		}
	}
	bankOfGroup := map[string]*uint{}
	if len(groups) > 0 {
		var lines []struct {
			TransactionGroupID string
			BankID             *uint
		}
		if err := investmentDB().WithContext(ctx).Table("cash_movements").Select("transaction_group_id, bank_id").
			Where("transaction_group_id IN ? AND bank_id IS NOT NULL", groups).Scan(&lines).Error; err == nil {
			for _, l := range lines {
				bankOfGroup[l.TransactionGroupID] = l.BankID
			}
		}
	}
	for _, f := range first {
		if g, ok := groupOf[f.ID]; ok {
			out[f.ID] = bankOfGroup[g]
		} else {
			var bid *uint
			_ = investmentDB().WithContext(ctx).Table("cash_movements").Select("bank_id").Where("id = ?", f.ID).Scan(&bid).Error
			out[f.ID] = bid
		}
	}
	return out
}

func resolveNumber(ctx context.Context, number string, branchID *uint) (uint, error) {
	id, err := findIDByNumber(ctx, number, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, common.NewNotFound("investment not found")
		}
		return 0, err
	}
	return id, nil
}

func openingRows(ctx context.Context, inv *models.Investment, amount float64) []LedgerRow {
	single := openingRow(inv, amount)
	mv, err := openingCashLines(ctx, investmentDB().WithContext(ctx), inv)
	if err != nil || len(mv) == 0 {
		return []LedgerRow{single}
	}
	var parts []struct {
		Mode   string
		Amount float64
	}
	var sum float64
	for _, m := range mv {
		parts = append(parts, struct {
			Mode   string
			Amount float64
		}{m.Mode, m.Amount})
		sum += m.Amount
		if m.BankID != nil {
			single.BankID = m.BankID
		}
		switch m.Mode {
		case "Cash":
			single.CashAmount += m.Amount
		case "UPI":
			single.UpiAmount += m.Amount
		case "Bank Transfer":
			single.BankTransferAmount += m.Amount
		case "Cheque":
			single.ChequeAmount += m.Amount
		}
	}
	// Only an opening deposit whose cash lines add up to its amount, and that was paid in (not rolled over from a
	// renewal), can be corrected; getLedger narrows this further by the investment's state.
	single.Editable = common.RoundMoney(sum) == common.RoundMoney(amount) && inv.RenewedFromInvestmentID == nil
	if len(parts) < 2 || common.RoundMoney(sum) != common.RoundMoney(amount) {
		if len(parts) == 1 && common.RoundMoney(sum) == common.RoundMoney(amount) {
			single.Method = parts[0].Mode
		}
		return []LedgerRow{single}
	}
	rows := make([]LedgerRow, 0, len(parts))
	var running float64
	for i, p := range parts {
		running = common.RoundMoney(running + p.Amount)
		r := single
		r.ID = fmt.Sprintf("open-%d-%d", inv.ID, i)
		r.Method = p.Mode
		r.Amount, r.PrincipalPart, r.RunningBalance = p.Amount, p.Amount, running
		if i > 0 {
			r.Editable = false
		}
		rows = append(rows, r)
	}
	return rows
}

func openingRow(inv *models.Investment, amount float64) LedgerRow {
	desc := "Investment deposit"
	return LedgerRow{
		ID:             fmt.Sprintf("open-%d", inv.ID),
		Date:           inv.StartDate,
		Description:    desc,
		Type:           "Deposit",
		Reference:      inv.InvestmentNumber,
		DebitOrCredit:  "credit",
		Amount:         amount,
		PrincipalPart:  amount,
		RunningBalance: amount,
		EntryKind:      "opening",
		EntryAmount:    amount,
	}
}

func withdrawalDescription(principal, interest float64) string {
	switch {
	case principal > 0 && interest > 0:
		return "Withdrawal — principal & interest"
	case principal > 0:
		return "Withdrawal — principal"
	default:
		return "Withdrawal — interest"
	}
}

func splitMethod(cash, upi, bankTransfer, cheque float64) string {
	var parts []string
	for _, m := range []struct {
		name string
		amt  float64
	}{{"Cash", cash}, {"UPI", upi}, {"Bank Transfer", bankTransfer}, {"Cheque", cheque}} {
		if m.amt > 0 {
			parts = append(parts, m.name)
		}
	}
	return strings.Join(parts, " + ")
}

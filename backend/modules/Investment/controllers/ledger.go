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
		rows = append(rows, openingRows(ctx, inv, opening)...)
		for _, t := range txs {
			row := LedgerRow{
				ID:             fmt.Sprintf("tx-%d", t.ID),
				Date:           t.OccurredOn,
				Type:           t.Type,
				Method:         splitMethod(t.CashAmount, t.UpiAmount, t.BankTransferAmount, t.ChequeAmount),
				Reference:      inv.InvestmentNumber,
				Amount:         t.Amount,
				PrincipalPart:  t.PrincipalAmount,
				InterestPart:   t.InterestAmount,
				RunningBalance: t.PrincipalAfter,
			}
			if t.Type == "Deposit" {
				row.DebitOrCredit = "credit"
				row.Description = "Additional deposit"
			} else {
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
	rows = append(rows, openRows...)
	for _, p := range payouts {
		row := LedgerRow{
			ID:            fmt.Sprintf("payout-%d", p.ID),
			Type:          "Interest payout",
			Method:        splitMethod(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount),
			Reference:     inv.InvestmentNumber,
			DebitOrCredit: "debit",
			Amount:        p.Amount,
			InterestPart:  p.Amount,
			Description:   fmt.Sprintf("Interest payout #%d (due %s)", p.SequenceNo, p.DueDate.Format("02-Jan-06")),
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
	var mv []struct {
		Mode               string
		Amount             float64
		TransactionGroupID string
	}
	err := investmentDB().WithContext(ctx).Table("cash_movements").
		Select("mode, amount, transaction_group_id").
		Where("source = ? AND type = ? AND purpose = ?", "Investment", "in", "Investment deposit — "+inv.InvestmentNumber).
		Order("id asc").Scan(&mv).Error
	if err != nil || len(mv) == 0 {
		return []LedgerRow{single}
	}
	var parts []struct {
		Mode   string
		Amount float64
	}
	var sum float64
	for _, m := range mv {
		if m.TransactionGroupID != mv[0].TransactionGroupID {
			continue
		}
		parts = append(parts, struct {
			Mode   string
			Amount float64
		}{m.Mode, m.Amount})
		sum += m.Amount
	}
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

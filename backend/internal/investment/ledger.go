package investment

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// LedgerRow is one row of an investment's ledger — GET /investments/:id/
// ledger. Field names mirror loan.LoanLedgerRow/cash.LedgerRow so the
// frontend renders every ledger the same way. From the business's side a
// deposit is money received (credit) and a payout/withdrawal is money paid
// out (debit); RunningBalance is the principal still owed to the investor
// immediately after the row.
type LedgerRow struct {
	ID             string    `json:"id"`
	Date           time.Time `json:"date"`
	Description    string    `json:"description"`
	Type           string    `json:"type"`
	Method         string    `json:"method"`
	Reference      string    `json:"reference"`
	DebitOrCredit  string    `json:"debitOrCredit"` // "debit" | "credit"
	Amount         float64   `json:"amount"`
	PrincipalPart  float64   `json:"principalAmount"`
	InterestPart   float64   `json:"interestAmount"`
	RunningBalance float64   `json:"runningBalance"`
}

// GetLedger builds one investment's full ledger, oldest first: the opening
// deposit, then every Add Cash/Withdraw transaction (Live engine) or every
// paid payout (Schedule engine). Built from the investment's own tables
// rather than cash_movements, since a split-mode payout is several
// movements but one ledger event.
func (s *Service) GetLedger(ctx context.Context, investmentID uint, branchID *uint) ([]LedgerRow, error) {
	inv, err := s.Get(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	var rows []LedgerRow

	if inv.Engine == EngineLive {
		txs, err := s.repo.FindAllTransactions(ctx, inv.ID)
		if err != nil {
			return nil, err
		}
		// PrincipalAmount moves with every Add Cash/Withdraw on a Live
		// investment, so the opening deposit is the first transaction's
		// before-figure, or today's principal when nothing has moved yet.
		opening := inv.PrincipalAmount
		if len(txs) > 0 {
			opening = txs[0].PrincipalBefore
		}
		rows = append(rows, s.openingRows(ctx, inv, opening)...)
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
			if t.Type == TxTypeDeposit {
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

	payouts, err := s.repo.FindPaidPayouts(ctx, inv.ID)
	if err != nil {
		return nil, err
	}
	balance := inv.PrincipalAmount
	openRows := s.openingRows(ctx, inv, balance)
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
			Description:   fmt.Sprintf("Interest payout #%d (due %s)", p.SequenceNo, p.DueDate.Format("02-Jan-2006")),
		}
		if p.PaidAt != nil {
			row.Date = *p.PaidAt
		} else {
			row.Date = p.DueDate
		}
		if p.IsPrincipalReturn {
			// The final row's Amount carries the returned principal on top of
			// that period's interest (see MatureInvestment's Close path).
			row.Type = "Principal return"
			row.PrincipalPart = inv.PrincipalAmount
			row.InterestPart = platform.RoundMoney(p.Amount - inv.PrincipalAmount)
			row.Description = fmt.Sprintf("Principal return with final interest (#%d)", p.SequenceNo)
			balance = 0
		}
		row.RunningBalance = balance
		rows = append(rows, row)
	}
	tail := rows[len(openRows):]
	sort.SliceStable(tail, func(i, j int) bool { return tail[i].Date.Before(tail[j].Date) })
	return rows, nil
}

// ResolveNumber maps an investment number ("INV-00003") to its ID, so a
// ledger reference can link to the investment's own page.
func (s *Service) ResolveNumber(ctx context.Context, number string, branchID *uint) (uint, error) {
	id, err := s.repo.FindIDByNumber(ctx, number, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, ErrInvestmentNotFound
		}
		return 0, err
	}
	return id, nil
}

// openingRows is the opening deposit as ledger rows. When the deposit was paid
// in several modes (Cash + Bank Transfer, …) it is one row per mode, read back
// from the deposit's cash movements — the same shape the bank/cash ledgers
// show. Falls back to the single openingRow for an older deposit with no
// recorded split, or one whose movements don't add up to the amount.
func (s *Service) openingRows(ctx context.Context, inv *Investment, amount float64) []LedgerRow {
	single := openingRow(inv, amount)
	var mv []struct {
		Mode               string
		Amount             float64
		TransactionGroupID string
	}
	err := s.repo.DB().WithContext(ctx).Table("cash_movements").
		Select("mode, amount, transaction_group_id").
		Where("source = ? AND type = ? AND purpose = ?", "Investment", "in", "Investment deposit — "+inv.InvestmentNumber).
		Order("id asc").Scan(&mv).Error
	if err != nil || len(mv) == 0 {
		return []LedgerRow{single}
	}
	// The opening deposit is the first group written; later Add Cash deposits
	// share the purpose but have their own groups (and ledger rows).
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
	if len(parts) < 2 || platform.RoundMoney(sum) != platform.RoundMoney(amount) {
		if len(parts) == 1 && platform.RoundMoney(sum) == platform.RoundMoney(amount) {
			single.Method = parts[0].Mode
		}
		return []LedgerRow{single}
	}
	rows := make([]LedgerRow, 0, len(parts))
	var running float64
	for i, p := range parts {
		running = platform.RoundMoney(running + p.Amount)
		r := single
		r.ID = fmt.Sprintf("open-%d-%d", inv.ID, i)
		r.Method = p.Mode
		r.Amount, r.PrincipalPart, r.RunningBalance = p.Amount, p.Amount, running
		rows = append(rows, r)
	}
	return rows
}

func openingRow(inv *Investment, amount float64) LedgerRow {
	desc := "Investment deposit"
	if inv.Plan.Name != "" {
		desc += " — " + inv.Plan.Name
	}
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

// splitMethod names the payment mode(s) a split-mode row went through —
// "Cash", or "Cash + UPI" when split — "" when no mode was recorded.
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

package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/Investment/models"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// An investment's ledger is its opening deposit, its paid payouts and (for the live-accrual engine) its
// add-cash / withdrawal rows. Correcting or deleting one of them is done inside one transaction:
//
//   - live-engine deposits and withdrawals, and the opening deposit of a live investment, change the principal
//     part-way through, so the investment is replayed from its first day: interest is charged again between the
//     entries, every later row's before/after figures are rewritten and the investment's totals are set from
//     the result. A change that makes a later entry impossible (a withdrawal larger than what is left) is refused.
//   - the opening deposit of a scheduled investment changes the principal, the dates and so the payout schedule,
//     which is regenerated; it is only allowed while no payout has been paid.
//   - a paid payout can have its date and payment breakdown corrected; deleting one puts it back to Pending and
//     takes it off the interest paid so far. The amount of a payout is fixed by the schedule.
//
// Whatever the entry, its cash-ledger lines are removed and written again with the corrected values.

var errDryRunInv = errors.New("dry run")

// InvestmentSummary is what the preview and the audit trail show of an investment before and after a change.
type InvestmentSummary struct {
	Invested             float64 `json:"invested"`
	OutstandingPrincipal float64 `json:"outstanding_principal"`
	OutstandingInterest  float64 `json:"outstanding_interest"`
	TotalInterestPaid    float64 `json:"total_interest_paid"`
	PaidPayouts          int     `json:"paid_payouts"`
	Status               string  `json:"status"`
	StartDate            string  `json:"start_date"`
	MaturityDate         string  `json:"maturity_date"`
}

// EditEntryResult is returned by an edit or delete: the investment figures before and after.
type EditEntryResult struct {
	Before InvestmentSummary `json:"before"`
	After  InvestmentSummary `json:"after"`
	DryRun bool              `json:"dry_run"`
}

// EditEntryInput holds the fields a ledger edit may change; nil means "leave as is".
type EditEntryInput struct {
	OccurredOn         *time.Time
	Amount             *float64 // opening deposit / add-cash deposit
	PrincipalAmount    *float64 // withdrawal
	InterestAmount     *float64 // withdrawal
	CashAmount         *float64
	UpiAmount          *float64
	BankTransferAmount *float64
	ChequeAmount       *float64
	BankID             *uint
	Reference          *string
}

type entryOutcome struct {
	Result *EditEntryResult
	Old    string
	Number string
}

func summarizeInvestment(inv *models.Investment, paid int) InvestmentSummary {
	return InvestmentSummary{
		Invested:             inv.PrincipalAmount,
		OutstandingPrincipal: inv.OutstandingPrincipal,
		OutstandingInterest:  clampMoney(inv.AccruedInterest - inv.InterestWithdrawn),
		TotalInterestPaid:    inv.TotalInterestPaid,
		PaidPayouts:          paid,
		Status:               inv.Status,
		StartDate:            inv.StartDate.Format("2006-01-02"),
		MaturityDate:         inv.MaturityDate.Format("2006-01-02"),
	}
}

// ---- pure recalculation -------------------------------------------------------------------------------------

// sortTransactions puts rows in the order they were applied: by date, then by id.
func sortTransactions(rows []models.InvestmentTransaction) {
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].OccurredOn.Equal(rows[j].OccurredOn) {
			return rows[i].OccurredOn.Before(rows[j].OccurredOn)
		}
		return rows[i].ID < rows[j].ID
	})
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.UTC().Date()
	by, bm, bd := b.UTC().Date()
	return ay == by && am == bm && ad == bd
}

// keepTimeIfSameDay keeps the saved timestamp when an edit only repeats the same calendar day.
func keepTimeIfSameDay(old, edited time.Time) time.Time {
	if sameDay(old, edited) {
		return old
	}
	return edited
}

// resolveSplit returns the payment breakdown after an edit: the saved one when the edit sent none, else exactly
// what was sent (a mode left out is zero).
func resolveSplit(old [4]float64, in [4]*float64) [4]float64 {
	any := false
	for _, v := range in {
		if v != nil {
			any = true
		}
	}
	if !any {
		return old
	}
	var out [4]float64
	for i, v := range in {
		if v != nil {
			out[i] = common.RoundMoney(*v)
		}
	}
	return out
}

// checkPrincipalChain reports the first place where the saved live-engine rows do not chain from the opening
// principal to the investment's current principal, or "" when they all do. A chain that does not hold means the
// history holds figures a replay cannot explain, so an edit would silently change them.
func checkPrincipalChain(opening float64, txs []models.InvestmentTransaction, inv *models.Investment) string {
	running := opening
	for _, t := range txs {
		if math.Abs(t.PrincipalBefore-running) > epsilon {
			return fmt.Sprintf("%s of ₹%.2f on %s starts from principal ₹%.2f but the rows before it end at ₹%.2f", t.Type, t.Amount, t.OccurredOn.Format("02-01-2006"), t.PrincipalBefore, running)
		}
		switch t.Type {
		case "Deposit":
			running = common.RoundMoney(running + t.Amount)
		case "Withdrawal":
			running = roundClamp(common.RoundMoney(running - t.PrincipalAmount))
		default:
			return "an entry of type " + t.Type + " is not understood"
		}
		if math.Abs(t.PrincipalAfter-running) > epsilon {
			return fmt.Sprintf("%s of ₹%.2f on %s ends at principal ₹%.2f saved vs ₹%.2f recalculated", t.Type, t.Amount, t.OccurredOn.Format("02-01-2006"), t.PrincipalAfter, running)
		}
	}
	if math.Abs(inv.OutstandingPrincipal-running) > epsilon {
		return fmt.Sprintf("outstanding principal ₹%.2f saved vs ₹%.2f recalculated", inv.OutstandingPrincipal, running)
	}
	if math.Abs(inv.PrincipalAmount-running) > epsilon {
		return fmt.Sprintf("invested principal ₹%.2f saved vs ₹%.2f recalculated", inv.PrincipalAmount, running)
	}
	return ""
}

// replayLive resets a live-engine investment to its first day with the given opening principal and applies the
// transactions (already in order), charging interest between them and rewriting each row's before/after figures.
// It finally charges interest up to asOf, like opening the investment does. An entry that no longer fits (dated
// before the start, or taking more than is outstanding) is an error.
func replayLive(inv *models.Investment, opening float64, start time.Time, txs []models.InvestmentTransaction, asOf time.Time) error {
	inv.PrincipalAmount = opening
	inv.OutstandingPrincipal = opening
	inv.AccruedInterest = 0
	inv.InterestWithdrawn = 0
	inv.StartDate = start
	inv.LastAccrualDate = start
	for i := range txs {
		t := &txs[i]
		if t.OccurredOn.Before(start) && !sameDay(t.OccurredOn, start) {
			return fmt.Errorf("%s of ₹%.2f dated %s would be before the investment starts on %s", t.Type, t.Amount, t.OccurredOn.Format("02-01-2006"), start.Format("02-01-2006"))
		}
		delta, anchor := projectAccrual(inv, t.OccurredOn)
		inv.AccruedInterest = common.RoundMoney(inv.AccruedInterest + delta)
		inv.LastAccrualDate = anchor
		t.PrincipalBefore = inv.OutstandingPrincipal
		t.InterestBefore = clampMoney(inv.AccruedInterest - inv.InterestWithdrawn)
		switch t.Type {
		case "Deposit":
			t.PrincipalAmount, t.InterestAmount = t.Amount, 0
			inv.OutstandingPrincipal = common.RoundMoney(inv.OutstandingPrincipal + t.Amount)
			inv.PrincipalAmount = common.RoundMoney(inv.PrincipalAmount + t.Amount)
		case "Withdrawal":
			if t.PrincipalAmount > t.PrincipalBefore+epsilon {
				return fmt.Errorf("the withdrawal of ₹%.2f on %s would take ₹%.2f of principal but only ₹%.2f is outstanding then", t.Amount, t.OccurredOn.Format("02-01-2006"), t.PrincipalAmount, t.PrincipalBefore)
			}
			if t.InterestAmount > t.InterestBefore+epsilon {
				return fmt.Errorf("the withdrawal of ₹%.2f on %s would take ₹%.2f of interest but only ₹%.2f is outstanding then", t.Amount, t.OccurredOn.Format("02-01-2006"), t.InterestAmount, t.InterestBefore)
			}
			t.Amount = common.RoundMoney(t.PrincipalAmount + t.InterestAmount)
			inv.OutstandingPrincipal = roundClamp(common.RoundMoney(inv.OutstandingPrincipal - t.PrincipalAmount))
			inv.PrincipalAmount = roundClamp(common.RoundMoney(inv.PrincipalAmount - t.PrincipalAmount))
			inv.InterestWithdrawn = common.RoundMoney(inv.InterestWithdrawn + t.InterestAmount)
		default:
			return errors.New("an entry of type " + t.Type + " cannot be replayed")
		}
		t.PrincipalAfter = inv.OutstandingPrincipal
		t.InterestAfter = clampMoney(inv.AccruedInterest - inv.InterestWithdrawn)
	}
	delta, anchor := projectAccrual(inv, asOf)
	inv.AccruedInterest = common.RoundMoney(inv.AccruedInterest + delta)
	inv.LastAccrualDate = anchor
	return nil
}

func entryMatured(inv *models.Investment, now time.Time) string {
	if inv.Status == models.StatusMatured && inv.MaturityDate.After(now) {
		return models.StatusActive
	}
	return inv.Status
}

// ---- helpers ------------------------------------------------------------------------------------------------

// liveEntriesEditable reports whether a live investment's ledger is in a state the replay can handle: open, not
// renewed, and with no payouts (a close queues payouts whose amounts came from the old figures).
func liveEntriesEditable(ctx context.Context, inv *models.Investment) bool {
	if inv.Engine != models.EngineLive || (inv.Status != models.StatusActive && inv.Status != models.StatusMatured) || inv.RenewedToInvestmentID != nil {
		return false
	}
	var n int64
	if err := investmentDB().WithContext(ctx).Model(&models.InvestmentPayout{}).Where("investment_id = ?", inv.ID).Count(&n).Error; err != nil {
		return false
	}
	return n == 0
}

func scheduleOpeningEditable(inv *models.Investment, paidPayouts int) bool {
	return inv.Engine != models.EngineLive && (inv.Status == models.StatusActive || inv.Status == models.StatusMatured) &&
		paidPayouts == 0 && inv.RenewedFromInvestmentID == nil
}

// openingCashLines returns the cash lines of the investment's opening deposit: the first deposit group that is
// not one of its add-cash transactions.
func openingCashLines(ctx context.Context, db *gorm.DB, inv *models.Investment) ([]cashModels.CashMovement, error) {
	var txIDs []uint
	if err := db.WithContext(ctx).Model(&models.InvestmentTransaction{}).
		Where("investment_id = ? AND cash_movement_id IS NOT NULL", inv.ID).Pluck("cash_movement_id", &txIDs).Error; err != nil {
		return nil, err
	}
	q := db.WithContext(ctx).Model(&cashModels.CashMovement{}).
		Where("source = ? AND type = ? AND purpose = ?", "Investment", "in", "Investment deposit — "+inv.InvestmentNumber)
	if len(txIDs) > 0 {
		var groups []string
		if err := db.WithContext(ctx).Model(&cashModels.CashMovement{}).Where("id IN ? AND transaction_group_id <> ''", txIDs).
			Pluck("transaction_group_id", &groups).Error; err != nil {
			return nil, err
		}
		q = q.Where("id NOT IN ?", txIDs)
		if len(groups) > 0 {
			q = q.Where("transaction_group_id NOT IN ?", groups)
		}
	}
	var lines []cashModels.CashMovement
	if err := q.Order("id asc").Find(&lines).Error; err != nil {
		return nil, err
	}
	if len(lines) == 0 {
		return nil, nil
	}
	var first []cashModels.CashMovement
	for _, l := range lines {
		if l.TransactionGroupID == lines[0].TransactionGroupID {
			first = append(first, l)
		}
	}
	return first, nil
}

// deleteEntryCash removes the cash lines an entry booked: every line in the group of its first line.
func deleteEntryCash(ctx context.Context, tx *gorm.DB, inv *models.Investment, sourceType string, firstID *uint) error {
	if firstID == nil {
		return nil
	}
	var m cashModels.CashMovement
	if err := tx.WithContext(ctx).First(&m, *firstID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if m.SourceType != sourceType || m.SourceID == nil || *m.SourceID != inv.ID {
		return common.NewConflict("this entry's cash-ledger line does not belong to the investment, so it cannot be rewritten safely")
	}
	q := tx.WithContext(ctx).Where("source_type = ? AND source_id = ?", sourceType, inv.ID)
	if m.TransactionGroupID != "" {
		q = q.Where("transaction_group_id = ?", m.TransactionGroupID)
	} else {
		q = q.Where("id = ?", m.ID)
	}
	return q.Delete(&cashModels.CashMovement{}).Error
}

func movementBank(ctx context.Context, firstID *uint) *uint {
	if firstID == nil {
		return nil
	}
	return movementBanks(ctx, []*uint{firstID})[*firstID]
}

func splitOf(in *EditEntryInput) [4]*float64 {
	return [4]*float64{in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount}
}

// chooseSplit settles the breakdown of an edited entry, with the bank only when a non-cash mode is used.
func chooseSplit(old [4]float64, oldBank *uint, in *EditEntryInput, total float64) (c, u, b, ch float64, bank *uint, err error) {
	sp := resolveSplit(old, splitOf(in))
	bank = oldBank
	if in.BankID != nil {
		bank = in.BankID
	}
	c, u, b, ch, err = common.NormalizeSplit(sp[0], sp[1], sp[2], sp[3], total, bank)
	if err != nil {
		return
	}
	bank = nonCashBankID(bank, u, b, ch)
	return
}

func marshalOld(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func countPaid(ctx context.Context, tx *gorm.DB, invID uint) int {
	var n int64
	_ = tx.WithContext(ctx).Model(&models.InvestmentPayout{}).Where("investment_id = ? AND status = ?", invID, "Paid").Count(&n).Error
	return int(n)
}

func loadTransactions(ctx context.Context, tx *gorm.DB, invID uint) ([]models.InvestmentTransaction, error) {
	var txs []models.InvestmentTransaction
	err := tx.WithContext(ctx).Where("investment_id = ?", invID).Order("occurred_on asc, id asc").Find(&txs).Error
	return txs, err
}

func liveGuard(ctx context.Context, tx *gorm.DB, inv *models.Investment) error {
	if inv.Engine != models.EngineLive {
		return common.NewBadRequest("this entry belongs to an investment that does not use the live accrual engine")
	}
	if inv.Status != models.StatusActive && inv.Status != models.StatusMatured {
		return common.NewConflict("an investment in status " + inv.Status + " cannot have its ledger edited")
	}
	if inv.RenewedToInvestmentID != nil || inv.RenewedFromInvestmentID != nil {
		return common.NewConflict("ledger edits are not available for renewed investments")
	}
	var n int64
	if err := tx.WithContext(ctx).Model(&models.InvestmentPayout{}).Where("investment_id = ?", inv.ID).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return common.NewConflict("this investment has payouts from a close or renewal, so its deposits and withdrawals can no longer be edited")
	}
	return nil
}

// ---- entry handlers (all run inside the caller's transaction) -----------------------------------------------

func editLiveTransaction(ctx context.Context, tx *gorm.DB, inv *models.Investment, txID uint, in *EditEntryInput, now time.Time) (string, error) {
	if err := liveGuard(ctx, tx, inv); err != nil {
		return "", err
	}
	txs, err := loadTransactions(ctx, tx, inv.ID)
	if err != nil {
		return "", err
	}
	idx := -1
	for i := range txs {
		if txs[i].ID == txID {
			idx = i
		}
	}
	if idx < 0 {
		return "", common.NewNotFound("ledger entry not found")
	}
	opening := inv.PrincipalAmount
	if len(txs) > 0 {
		opening = txs[0].PrincipalBefore
	}
	if diff := checkPrincipalChain(opening, txs, inv); diff != "" {
		// logged only: the edit goes ahead and the preview shows what it changes
		log.Printf("investment ledger edit: saved history does not recalculate exactly (%s); going ahead", diff)
	}
	old := txs[idx]
	oldBank := movementBank(ctx, old.CashMovementID)
	edited := txs
	if in == nil {
		edited = append(append([]models.InvestmentTransaction{}, txs[:idx]...), txs[idx+1:]...)
	} else {
		t := &edited[idx]
		if in.OccurredOn != nil {
			d := keepTimeIfSameDay(t.OccurredOn, *in.OccurredOn)
			if err := common.ValidateOccurredOn(d, inv.StartDate, now); err != nil {
				return "", err
			}
			t.OccurredOn = d
		}
		if t.Type == "Deposit" {
			if in.Amount != nil {
				t.Amount = common.RoundMoney(*in.Amount)
			}
			t.PrincipalAmount, t.InterestAmount = t.Amount, 0
		} else {
			if in.PrincipalAmount != nil {
				t.PrincipalAmount = common.RoundMoney(*in.PrincipalAmount)
			}
			if in.InterestAmount != nil {
				t.InterestAmount = common.RoundMoney(*in.InterestAmount)
			}
			if t.PrincipalAmount < 0 || t.InterestAmount < 0 {
				return "", common.NewBadRequest("amount must not be negative")
			}
			t.Amount = common.RoundMoney(t.PrincipalAmount + t.InterestAmount)
		}
		if t.Amount <= 0 {
			return "", common.NewBadRequest("amount must be greater than zero")
		}
		var bank *uint
		t.CashAmount, t.UpiAmount, t.BankTransferAmount, t.ChequeAmount, bank, err = chooseSplit(
			[4]float64{old.CashAmount, old.UpiAmount, old.BankTransferAmount, old.ChequeAmount}, oldBank, in, t.Amount)
		if err != nil {
			return "", err
		}
		oldBank = bank
		if in.Reference != nil {
			t.Reference = strings.TrimSpace(*in.Reference)
		}
		sortTransactions(edited)
	}
	if err := replayLive(inv, opening, inv.StartDate, edited, now); err != nil {
		return "", common.NewBadRequest(err.Error())
	}
	if err := persistInvestment(ctx, tx, inv); err != nil {
		return "", err
	}
	for i := range edited {
		if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
			return "", err
		}
	}
	if in == nil {
		if err := tx.WithContext(ctx).Delete(&models.InvestmentTransaction{}, txID).Error; err != nil {
			return "", err
		}
	}
	srcType := "investment_payout"
	if old.Type == "Deposit" {
		srcType = "investment_deposit"
	}
	if err := deleteEntryCash(ctx, tx, inv, srcType, old.CashMovementID); err != nil {
		return "", err
	}
	if in != nil {
		var row *models.InvestmentTransaction
		for i := range edited {
			if edited[i].ID == txID {
				row = &edited[i]
			}
		}
		txCtx := cashbook.WithTx(ctx, tx)
		var movementID uint
		if row.Type == "Deposit" {
			movementID, err = cashbook.RecordInvestmentDepositCashIn(txCtx, inv.ID, inv.InvestmentNumber, row.Amount, row.CashAmount, row.UpiAmount, row.BankTransferAmount, row.ChequeAmount, oldBank, inv.BranchID, row.OccurredOn, inv.CustomerID)
		} else {
			payoutType := "Interest & Principal withdrawal"
			switch {
			case row.PrincipalAmount == 0:
				payoutType = "Interest withdrawal"
			case row.InterestAmount == 0:
				payoutType = "Principal withdrawal"
			}
			movementID, _, err = cashbook.RecordInvestmentPayoutCashOut(txCtx, inv.ID, inv.InvestmentNumber, row.Amount, row.CashAmount, row.UpiAmount, row.BankTransferAmount, row.ChequeAmount, inv.BranchID, row.OccurredOn, payoutType, inv.CustomerID, oldBank)
		}
		if err != nil {
			return "", fmt.Errorf("could not record the corrected entry in Cash-in-Hand: %w", err)
		}
		if err := tx.WithContext(ctx).Model(&models.InvestmentTransaction{}).Where("id = ?", row.ID).Update("cash_movement_id", movementID).Error; err != nil {
			return "", err
		}
	}
	return marshalOld(old), nil
}

func editOpeningDeposit(ctx context.Context, tx *gorm.DB, inv *models.Investment, in *EditEntryInput, now time.Time) (string, error) {
	if in == nil {
		return "", common.NewConflict("the opening deposit cannot be deleted: it is the investment itself")
	}
	if inv.RenewedFromInvestmentID != nil {
		return "", common.NewConflict("the opening principal of a renewed investment was rolled over, not paid in, so it cannot be edited")
	}
	if inv.Status != models.StatusActive && inv.Status != models.StatusMatured {
		return "", common.NewConflict("an investment in status " + inv.Status + " cannot have its ledger edited")
	}
	var txs []models.InvestmentTransaction
	var opening float64
	if inv.Engine == models.EngineLive {
		if err := liveGuard(ctx, tx, inv); err != nil {
			return "", err
		}
		var err error
		if txs, err = loadTransactions(ctx, tx, inv.ID); err != nil {
			return "", err
		}
		opening = inv.PrincipalAmount
		if len(txs) > 0 {
			opening = txs[0].PrincipalBefore
		}
		if diff := checkPrincipalChain(opening, txs, inv); diff != "" {
			// logged only: the edit goes ahead and the preview shows what it changes
			log.Printf("investment ledger edit: saved history does not recalculate exactly (%s); going ahead", diff)
		}
	} else {
		if n := countPaid(ctx, tx, inv.ID); n > 0 {
			return "", common.NewConflict("a payout has already been paid on this investment, so its opening deposit can no longer be edited. Delete the paid payouts first")
		}
		opening = inv.PrincipalAmount
	}
	lines, err := openingCashLines(ctx, tx, inv)
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", common.NewConflict("this investment has no cash-ledger record for its opening deposit, so it cannot be edited safely")
	}
	var oldSplit [4]float64
	var oldBank *uint
	var sum float64
	for _, l := range lines {
		sum += l.Amount
		switch l.Mode {
		case cashModels.CashModeCash:
			oldSplit[0] += l.Amount
		case cashModels.CashModeUPI:
			oldSplit[1] += l.Amount
		case cashModels.CashModeBankTransfer:
			oldSplit[2] += l.Amount
		case cashModels.CashModeCheque:
			oldSplit[3] += l.Amount
		}
		if l.BankID != nil {
			oldBank = l.BankID
		}
	}
	if math.Abs(sum-opening) > epsilon {
		return "", common.NewConflict(fmt.Sprintf("the opening deposit's cash lines (₹%.2f) do not match its amount (₹%.2f), so it cannot be edited safely", sum, opening))
	}
	oldJSON := marshalOld(map[string]any{"amount": opening, "start_date": inv.StartDate, "cash": oldSplit[0], "upi": oldSplit[1], "bank_transfer": oldSplit[2], "cheque": oldSplit[3]})
	amount := opening
	if in.Amount != nil {
		amount = common.RoundMoney(*in.Amount)
	}
	if amount <= 0 {
		return "", common.NewBadRequest("amount must be greater than zero")
	}
	var plan models.InvestmentPlan
	if err := tx.WithContext(ctx).First(&plan, inv.PlanID).Error; err == nil && amount < plan.MinPrincipal {
		return "", common.NewBadRequest(fmt.Sprintf("principal amount is below the plan's minimum of ₹%.2f", plan.MinPrincipal))
	}
	start := inv.StartDate
	if in.OccurredOn != nil {
		start = keepTimeIfSameDay(inv.StartDate, *in.OccurredOn)
		if err := common.ValidateOccurredOn(start, time.Time{}, now); err != nil {
			return "", err
		}
	}
	cash, upi, bt, chq, bank, err := chooseSplit(oldSplit, oldBank, in, amount)
	if err != nil {
		return "", err
	}
	inv.MaturityDate = start.AddDate(0, inv.TenureMonths, 0)
	if inv.Engine == models.EngineLive {
		if err := replayLive(inv, amount, start, txs, now); err != nil {
			return "", common.NewBadRequest(err.Error())
		}
		for i := range txs {
			if err := tx.WithContext(ctx).Save(&txs[i]).Error; err != nil {
				return "", err
			}
		}
	} else {
		inv.StartDate = start
		inv.PrincipalAmount = amount
		if err := tx.WithContext(ctx).Where("investment_id = ?", inv.ID).Delete(&models.InvestmentPayout{}).Error; err != nil {
			return "", err
		}
		payouts := generatePayoutSchedule(inv)
		for i := range payouts {
			payouts[i].TenantID = inv.TenantID
		}
		if err := createPayouts(ctx, tx, payouts); err != nil {
			return "", err
		}
	}
	// A matured investment whose new maturity date is still ahead is open again; the daily sweep flags the
	// opposite case.
	inv.Status = entryMatured(inv, now)
	if err := persistInvestment(ctx, tx, inv); err != nil {
		return "", err
	}
	ids := make([]uint, 0, len(lines))
	for _, l := range lines {
		ids = append(ids, l.ID)
	}
	if err := tx.WithContext(ctx).Where("id IN ?", ids).Delete(&cashModels.CashMovement{}).Error; err != nil {
		return "", err
	}
	if _, err := cashbook.RecordInvestmentDepositCashIn(cashbook.WithTx(ctx, tx), inv.ID, inv.InvestmentNumber, amount, cash, upi, bt, chq, bank, inv.BranchID, start, inv.CustomerID); err != nil {
		return "", fmt.Errorf("could not record the corrected deposit in Cash-in-Hand: %w", err)
	}
	return oldJSON, nil
}

func editPayoutEntry(ctx context.Context, tx *gorm.DB, inv *models.Investment, payoutID uint, in *EditEntryInput, now time.Time) (string, error) {
	p, err := lockPayoutByID(ctx, tx, payoutID)
	if err != nil || p.InvestmentID != inv.ID {
		return "", common.NewNotFound("ledger entry not found")
	}
	if p.Status != "Paid" {
		return "", common.NewConflict("this payout has not been paid, so it is not a ledger entry")
	}
	old := *p
	payoutType := "Interest payout"
	if p.IsPrincipalReturn {
		payoutType = "Principal return"
	}
	oldBank := movementBank(ctx, p.CashMovementID)
	if in == nil {
		if inv.Engine == models.EngineLive {
			return "", common.NewConflict("the payouts made when a live investment is closed cannot be deleted")
		}
		if err := deleteEntryCash(ctx, tx, inv, "investment_payout", p.CashMovementID); err != nil {
			return "", err
		}
		if !p.IsPrincipalReturn {
			inv.TotalInterestPaid = math.Max(0, common.RoundMoney(inv.TotalInterestPaid-p.Amount))
		}
		if err := persistInvestment(ctx, tx, inv); err != nil {
			return "", err
		}
		p.Status = "Pending"
		p.PaidAt, p.PaidByEmployeeID, p.CashMovementID = nil, nil, nil
		p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount = 0, 0, 0, 0
		if err := updatePayout(ctx, tx, p); err != nil {
			return "", err
		}
		return marshalOld(old), nil
	}
	if in.Amount != nil && math.Abs(common.RoundMoney(*in.Amount)-p.Amount) > epsilon {
		return "", common.NewConflict(fmt.Sprintf("the amount of this payout (₹%.2f) is fixed by the investment's schedule. To change it, delete this entry and pay the payout again", p.Amount))
	}
	paidAt := now
	if p.PaidAt != nil {
		paidAt = *p.PaidAt
	}
	if in.OccurredOn != nil {
		paidAt = keepTimeIfSameDay(paidAt, *in.OccurredOn)
		if err := common.ValidateOccurredOn(paidAt, inv.StartDate, now); err != nil {
			return "", err
		}
	}
	cash, upi, bt, chq, bank, err := chooseSplit([4]float64{p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount}, oldBank, in, p.Amount)
	if err != nil {
		return "", err
	}
	if err := deleteEntryCash(ctx, tx, inv, "investment_payout", p.CashMovementID); err != nil {
		return "", err
	}
	p.PaidAt = &paidAt
	p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount = cash, upi, bt, chq
	movementID, _, err := cashbook.RecordInvestmentPayoutCashOut(cashbook.WithTx(ctx, tx), inv.ID, inv.InvestmentNumber, p.Amount, cash, upi, bt, chq, inv.BranchID, paidAt, payoutType, inv.CustomerID, bank)
	if err != nil {
		return "", fmt.Errorf("could not record the corrected payout in Cash-in-Hand: %w", err)
	}
	p.CashMovementID = &movementID
	if err := updatePayout(ctx, tx, p); err != nil {
		return "", err
	}
	return marshalOld(old), nil
}

// parseEntryID reads a ledger row id: tx-<id>, payout-<id> or open-<investment id>[-<part>].
func parseEntryID(s string) (kind string, id uint, err error) {
	bad := common.NewBadRequest("invalid ledger entry id")
	switch {
	case strings.HasPrefix(s, "tx-"):
		kind, s = "tx", strings.TrimPrefix(s, "tx-")
	case strings.HasPrefix(s, "payout-"):
		kind, s = "payout", strings.TrimPrefix(s, "payout-")
	case strings.HasPrefix(s, "open-"):
		kind, s = "open", strings.TrimPrefix(s, "open-")
		if i := strings.Index(s, "-"); i >= 0 {
			s = s[:i]
		}
	default:
		return "", 0, bad
	}
	n, perr := strconv.ParseUint(s, 10, 64)
	if perr != nil || n == 0 {
		return "", 0, bad
	}
	return kind, uint(n), nil
}

// editLedgerEntry edits (in != nil) or deletes (in == nil) one ledger entry, recalculating the investment.
func editLedgerEntry(ctx context.Context, investmentID uint, branchID *uint, entryID string, in *EditEntryInput, reason string, dryRun bool) (*entryOutcome, error) {
	kind, id, err := parseEntryID(entryID)
	if err != nil {
		return nil, err
	}
	out := &entryOutcome{Result: &EditEntryResult{DryRun: dryRun}}
	now := time.Now()
	err = investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		out.Number = inv.InvestmentNumber
		if kind == "open" && id != inv.ID {
			return common.NewNotFound("ledger entry not found")
		}
		if inv.Engine == models.EngineLive {
			// open the investment the way viewing it does, so "before" is as of today
			if err := settleAndSave(ctx, tx, inv, now); err != nil {
				return err
			}
		}
		out.Result.Before = summarizeInvestment(inv, countPaid(ctx, tx, inv.ID))
		switch kind {
		case "tx":
			out.Old, err = editLiveTransaction(ctx, tx, inv, id, in, now)
		case "open":
			out.Old, err = editOpeningDeposit(ctx, tx, inv, in, now)
		default:
			out.Old, err = editPayoutEntry(ctx, tx, inv, id, in, now)
		}
		if err != nil {
			return err
		}
		out.Result.After = summarizeInvestment(inv, countPaid(ctx, tx, inv.ID))
		if dryRun {
			return errDryRunInv
		}
		return nil
	})
	if errors.Is(err, errDryRunInv) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

func writeInvestmentAudit(ctx context.Context, actorEmployeeID uint, action string, investmentID uint, out *entryOutcome, entryID, reason string) {
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	detail := fmt.Sprintf("entry %s before: %s | investment before: %+v | investment after: %+v", entryID, out.Old, out.Result.Before, out.Result.After)
	if r := strings.TrimSpace(reason); r != "" {
		detail = "reason: " + r + " | " + detail
	}
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: action,
		EntityType: "investment", EntityID: investmentID, EntityName: out.Number, Detail: detail,
	})
}

type editEntryRequest struct {
	OccurredOn         *string  `json:"occurred_on"`
	Amount             *float64 `json:"amount"`
	PrincipalAmount    *float64 `json:"principal_amount"`
	InterestAmount     *float64 `json:"interest_amount"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	ChequeAmount       *float64 `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Reference          *string  `json:"reference"`
	Reason             string   `json:"reason"`
}

func parseEntryDate(raw string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t, nil
	}
	return time.Parse("2006-01-02", raw)
}

// EditInvestmentLedgerEntry is PATCH /investments/:id/ledger/:entry_id[?dry_run=true].
func EditInvestmentLedgerEntry(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	entryID := c.Param("entry_id")
	var req editEntryRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := &EditEntryInput{
		Amount: req.Amount, PrincipalAmount: req.PrincipalAmount, InterestAmount: req.InterestAmount,
		CashAmount: req.CashAmount, UpiAmount: req.UpiAmount, BankTransferAmount: req.BankTransferAmount,
		ChequeAmount: req.ChequeAmount, BankID: req.BankID, Reference: req.Reference,
	}
	if req.OccurredOn != nil && *req.OccurredOn != "" {
		d, err := parseEntryDate(*req.OccurredOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid occurred_on: expected YYYY-MM-DD"})
		}
		in.OccurredOn = &d
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	out, err := editLedgerEntry(ctx, id, auth.GetBranchScope(c), entryID, in, req.Reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		writeInvestmentAudit(ctx, actorEmployeeID, "Investment ledger entry edited", id, out, entryID, req.Reason)
	}
	return common.Success(c, http.StatusOK, out.Result)
}

// DeleteInvestmentLedgerEntry is DELETE /investments/:id/ledger/:entry_id?reason=…[&dry_run=true].
func DeleteInvestmentLedgerEntry(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	entryID := c.Param("entry_id")
	reason := c.QueryParam("reason")
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	out, err := editLedgerEntry(ctx, id, auth.GetBranchScope(c), entryID, nil, reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		writeInvestmentAudit(ctx, actorEmployeeID, "Investment ledger entry deleted", id, out, entryID, reason)
	}
	return common.Success(c, http.StatusOK, out.Result)
}

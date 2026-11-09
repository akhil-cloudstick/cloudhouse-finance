package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// A personal loan's balance is its obligation less every payment, and each instalment's paid amount follows
// from the payments in date order. Editing or deleting a payment therefore recalculates the loan from its
// first day (balances, instalments, status) in one transaction. A loan whose saved figures this replay does
// not reproduce exactly is refused, so a wrong figure is never written.

var errEditDryRun = errors.New("dry run")

const rolloverMethod = "Renewal Rollover"

// PersonalLoanSummary is what the preview and the audit trail show of a loan before and after an edit.
type PersonalLoanSummary struct {
	Outstanding float64 `json:"outstanding"`
	TotalPaid   float64 `json:"total_paid"`
	Status      string  `json:"status"`
}

// EditEntryResult is returned by an edit or delete: the loan figures before and after.
type EditEntryResult struct {
	Before PersonalLoanSummary `json:"before"`
	After  PersonalLoanSummary `json:"after"`
	DryRun bool                `json:"dry_run"`
	// Following lists the later payments that no longer fit and what each can still be; they are saved that way.
	Following []FollowingEntry `json:"following,omitempty"`
	// InstalmentChanges are the instalments whose paid amount or status the edit changes — worked out, shown only.
	InstalmentChanges []InstalmentChange `json:"instalment_changes,omitempty"`
}

// InstalmentChange is one instalment an edit changes.
type InstalmentChange struct {
	SequenceNo   int       `json:"sequence_no"`
	DueDate      time.Time `json:"due_date"`
	PaidBefore   float64   `json:"paid_before"`
	PaidAfter    float64   `json:"paid_after"`
	StatusBefore string    `json:"status_before"`
	StatusAfter  string    `json:"status_after"`
}

// instalmentChanges lists the instalments whose paid amount or status differs, in schedule order.
func instalmentChanges(before, after []models.PersonalLoanInstallment) []InstalmentChange {
	var out []InstalmentChange
	for i := range before {
		if i >= len(after) {
			break
		}
		b, a := before[i], after[i]
		if math.Abs(b.PaidAmount-a.PaidAmount) < epsilon && b.Status == a.Status {
			continue
		}
		out = append(out, InstalmentChange{SequenceNo: b.SequenceNo, DueDate: b.DueDate, PaidBefore: b.PaidAmount, PaidAfter: a.PaidAmount, StatusBefore: b.Status, StatusAfter: a.Status})
	}
	return out
}

// replayBalances applies payments (already in order) to base and returns each payment's running balance and
// the final outstanding. A payment larger than what is left is an error.
func replayBalances(base float64, payments []models.PersonalLoanPayment) (running []float64, outstanding float64, err error) {
	outstanding = common.RoundMoney(base)
	running = make([]float64, len(payments))
	for i, p := range payments {
		if p.Amount > outstanding+epsilon {
			return nil, 0, fmt.Errorf("the payment of ₹%.2f on %s is more than the ₹%.2f then outstanding", p.Amount, p.PaidOn.Format("02-01-2006"), outstanding)
		}
		outstanding = math.Max(0, common.RoundMoney(outstanding-p.Amount))
		running[i] = outstanding
	}
	return running, outstanding, nil
}

// replayInstallments returns copies of insts (in sequence order) with total paid spread over them from the first.
func replayInstallments(insts []models.PersonalLoanInstallment, total float64) []models.PersonalLoanInstallment {
	out := make([]models.PersonalLoanInstallment, len(insts))
	copy(out, insts)
	remaining := common.RoundMoney(total)
	for i := range out {
		in := &out[i]
		credit := math.Max(0, math.Min(remaining, in.Amount))
		in.PaidAmount = common.RoundMoney(credit)
		remaining = common.RoundMoney(remaining - credit)
		switch {
		case in.PaidAmount >= in.Amount-epsilon:
			in.Status = InstallmentStatusPaid
		case in.PaidAmount > epsilon:
			in.Status = "PartiallyPaid"
		case in.Status == InstallmentStatusPaid || in.Status == "PartiallyPaid":
			in.Status = "Pending"
		}
	}
	return out
}

func sortPersonalPayments(rows []models.PersonalLoanPayment) {
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].PaidOn.Equal(rows[j].PaidOn) {
			return rows[i].PaidOn.Before(rows[j].PaidOn)
		}
		return rows[i].ID < rows[j].ID
	})
}

func sumPayments(rows []models.PersonalLoanPayment) float64 {
	t := 0.0
	for _, p := range rows {
		t += p.Amount
	}
	return common.RoundMoney(t)
}

// guardPersonalEditable refuses a loan whose history the replay cannot reproduce.
func guardPersonalEditable(l *models.PersonalLoan, payments []models.PersonalLoanPayment) error {
	switch l.Status {
	case models.StatusActive, models.StatusPending, models.StatusClosed:
	default:
		return common.NewConflict("a loan in status " + l.Status + " cannot have its ledger edited")
	}
	if l.RenewedToLoanID != nil {
		return common.NewConflict("this loan was renewed into another loan, so its ledger can no longer be edited")
	}
	if l.PenalCycleCount > 0 || l.TotalPenalInterestCharged > 0 {
		return common.NewConflict("ledger edits are not available yet for loans that have had penal interest charged")
	}
	for _, p := range payments {
		if p.Method == rolloverMethod {
			return common.NewConflict("ledger edits are not available for a loan with a renewal rollover entry")
		}
	}
	return nil
}

func summarizePersonal(l *models.PersonalLoan) PersonalLoanSummary {
	return PersonalLoanSummary{Outstanding: l.OutstandingAmount, TotalPaid: l.TotalPaid, Status: l.Status}
}

// findCashGroup returns the cash-book group a record booked: the saved id, or for older records the one
// group whose lines match purpose, direction, total and time. Anything else is refused.
func findCashGroup(ctx context.Context, tx *gorm.DB, saved, purpose, direction, source string, branchID uint, amount float64, at time.Time) (string, error) {
	if saved != "" {
		return saved, nil
	}
	type grp struct {
		TransactionGroupID string
		Total              float64
	}
	var groups []grp
	q := tx.WithContext(ctx).Model(&cashModels.CashMovement{}).
		Select("transaction_group_id, SUM(amount) AS total").
		Where("purpose = ? AND type = ? AND branch_id = ? AND transaction_group_id <> '' AND occurred_on BETWEEN ? AND ?",
			purpose, direction, branchID, at.Add(-2*time.Second), at.Add(2*time.Second))
	if source != "" {
		q = q.Where("source = ?", source)
	}
	if err := q.Group("transaction_group_id").Scan(&groups).Error; err != nil {
		return "", err
	}
	var match []string
	for _, g := range groups {
		if math.Abs(g.Total-amount) <= epsilon {
			match = append(match, g.TransactionGroupID)
		}
	}
	if len(match) != 1 {
		return "", common.NewConflict("the cash-book lines of this entry (booked before ledger edits existed) cannot be identified exactly, so it cannot be edited safely")
	}
	return match[0], nil
}

func deleteCashGroup(ctx context.Context, tx *gorm.DB, groupID string) error {
	if groupID == "" {
		return nil
	}
	return tx.WithContext(ctx).Where("transaction_group_id = ?", groupID).Delete(&cashModels.CashMovement{}).Error
}

// PersonalPaymentEdit holds the fields a payment edit may change; nil means "leave as is".
type PersonalPaymentEdit struct {
	PaidOn             *time.Time
	Amount             *float64
	CashAmount         *float64
	UpiAmount          *float64
	BankTransferAmount *float64
	ChequeAmount       *float64
	BankID             *uint
	Reference          *string
	Description        *string
	Adjust             []FollowingAdjust
}

func loadPersonalReplay(ctx context.Context, tx *gorm.DB, loanID uint) ([]models.PersonalLoanPayment, []models.PersonalLoanInstallment, error) {
	var pays []models.PersonalLoanPayment
	if err := tx.WithContext(ctx).Where("personal_loan_id = ?", loanID).Order("paid_on asc, id asc").Find(&pays).Error; err != nil {
		return nil, nil, err
	}
	var insts []models.PersonalLoanInstallment
	if err := tx.WithContext(ctx).Where("personal_loan_id = ?", loanID).Order("sequence_no asc").Find(&insts).Error; err != nil {
		return nil, nil, err
	}
	return pays, insts, nil
}

func validatePersonalPayment(l *models.PersonalLoan, p *models.PersonalLoanPayment) error {
	if p.Amount <= 0 {
		return common.NewBadRequest("amount must be greater than zero")
	}
	const layout = "2006-01-02"
	floor := l.DisbursedAt
	if floor.IsZero() {
		floor = l.OpenedDate
	}
	day := p.PaidOn.Format(layout)
	if day > time.Now().Format(layout) {
		return common.NewBadRequest("payment date cannot be in the future")
	}
	if day < floor.Format(layout) {
		return common.NewBadRequest("payment date cannot be before the loan was disbursed on " + floor.Format(layout))
	}
	if err := common.ValidateSplit(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, p.Amount); err != nil {
		return err
	}
	if (p.UpiAmount > 0 || p.BankTransferAmount > 0) && p.BankID == nil {
		return common.NewBadRequest("bank is required when the payment breakdown includes UPI or Bank Transfer")
	}
	return nil
}

// FollowingEntry is a later payment that no longer fits the loan once an earlier one is edited. Suggested is what it
// can still be (0 means it would be removed); the staff member may lower it further before saving.
type FollowingEntry struct {
	ID        uint      `json:"id"`
	PaidOn    time.Time `json:"paid_on"`
	Reference string    `json:"reference"`
	Current   float64   `json:"current"`
	Suggested float64   `json:"suggested"`
	// NeedsChange is set when the payment no longer fits and was lowered; the others are listed unchanged so the
	// staff member can look at them.
	NeedsChange bool `json:"needs_change"`
}

// FollowingAdjust is the amount the staff member chose for one following entry.
type FollowingAdjust struct {
	ID     uint    `json:"id"`
	Amount float64 `json:"amount"`
}

// shrinkPayment lowers a payment to a smaller amount, taking the difference off its cash part first, then UPI, then
// bank transfer, then cheque, so its breakdown still adds up to the new amount.
func shrinkPayment(p *models.PersonalLoanPayment, amount float64) {
	reduce := common.RoundMoney(p.Amount - amount)
	take := func(v *float64) {
		d := math.Min(*v, reduce)
		*v = common.RoundMoney(*v - d)
		reduce = common.RoundMoney(reduce - d)
	}
	take(&p.CashAmount)
	take(&p.UpiAmount)
	take(&p.BankTransferAmount)
	take(&p.ChequeAmount)
	p.Amount = amount
	if p.UpiAmount+p.BankTransferAmount+p.ChequeAmount == 0 {
		p.BankID = nil
	}
	p.Method = common.DeriveMethod(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
}

// fitFollowing walks the payments from index from, carrying the balance, and lowers every later payment that is
// larger than what is then outstanding (or the amount the staff member chose for it). The edited payment itself must
// fit as it is. It returns the later payments it changed, and those with nothing left to pay are returned with a
// suggested amount of 0.
func fitFollowing(base float64, edited []models.PersonalLoanPayment, from int, editedID uint, adjust map[uint]float64, strict bool) (changed, listed []FollowingEntry, err error) {
	outstanding := common.RoundMoney(base)
	for i := from; i < len(edited); i++ {
		p := &edited[i]
		if p.ID == editedID {
			if p.Amount > outstanding+epsilon {
				return nil, nil, common.NewBadRequest(fmt.Sprintf("the payment of ₹%.2f on %s is more than the ₹%.2f outstanding then", p.Amount, p.PaidOn.Format("02-01-2006"), outstanding))
			}
		} else {
			want := p.Amount
			if v, ok := adjust[p.ID]; ok {
				if v < 0 || v > p.Amount+epsilon {
					return nil, nil, common.NewBadRequest(fmt.Sprintf("the payment on %s can only be lowered, not raised", p.PaidOn.Format("02-01-2006")))
				}
				want = common.RoundMoney(v)
			}
			forced := false
			if want > outstanding+epsilon {
				forced = true
				if _, ok := adjust[p.ID]; ok || strict {
					return nil, nil, common.NewBadRequest(fmt.Sprintf("the payment on %s can be at most ₹%.2f — lower it in the list of payments after this one", p.PaidOn.Format("02-01-2006"), outstanding))
				}
				want = outstanding
			}
			entry := FollowingEntry{ID: p.ID, PaidOn: p.PaidOn, Reference: p.Reference, Current: p.Amount, Suggested: want, NeedsChange: forced}
			listed = append(listed, entry)
			if math.Abs(want-p.Amount) > epsilon {
				changed = append(changed, entry)
				if want > epsilon {
					shrinkPayment(p, want)
				} else {
					p.Amount = 0
				}
			}
		}
		outstanding = math.Max(0, common.RoundMoney(outstanding-p.Amount))
	}
	return changed, listed, nil
}

// applyReplayFrom writes the recalculated figures from payment index from onwards onto the loan and returns the
// instalments to save. The payments before it keep exactly what they were saved with.
func applyReplayFrom(l *models.PersonalLoan, ordered []models.PersonalLoanPayment, from int, insts []models.PersonalLoanInstallment, originalStatus string) ([]models.PersonalLoanInstallment, error) {
	outstanding := common.RoundMoney(l.PrincipalAmount)
	if from > 0 {
		outstanding = ordered[from-1].RunningBalance
	}
	for i := from; i < len(ordered); i++ {
		if ordered[i].Amount > outstanding+epsilon {
			return nil, common.NewBadRequest(fmt.Sprintf("the payment of ₹%.2f on %s is more than the ₹%.2f then outstanding", ordered[i].Amount, ordered[i].PaidOn.Format("02-01-2006"), outstanding))
		}
		outstanding = math.Max(0, common.RoundMoney(outstanding-ordered[i].Amount))
		ordered[i].RunningBalance = outstanding
	}
	if len(ordered) == 0 {
		outstanding = common.RoundMoney(l.PrincipalAmount)
	}
	total := sumPayments(ordered)
	newInsts := replayInstallments(insts, total)
	l.OutstandingAmount, l.TotalPaid = outstanding, total
	switch {
	case outstanding <= epsilon:
		l.OutstandingAmount = 0
		l.Status = models.StatusClosed
		if l.ClosedAt == nil || originalStatus != models.StatusClosed {
			at := time.Now()
			if n := len(ordered); n > 0 {
				at = ordered[n-1].PaidOn
			}
			l.ClosedAt = &at
		}
	case originalStatus == models.StatusClosed:
		l.ClosedAt = nil
		l.Status = models.StatusActive
		if isPastGracePeriod(l, newInsts, time.Now()) {
			l.Status = models.StatusPending
		}
	default:
		l.Status = originalStatus
	}
	return newInsts, nil
}

// onlyModeChanged reports whether an edit leaves the amount and the day alone: only the payment mode, bank,
// reference or note change, so no balance, instalment or later payment is affected.
func onlyModeChanged(old *models.PersonalLoanPayment, in *PersonalPaymentEdit) bool {
	if in == nil {
		return false
	}
	if in.Amount != nil && math.Abs(common.RoundMoney(*in.Amount)-old.Amount) > epsilon {
		return false
	}
	if in.PaidOn != nil && !sameDay(*in.PaidOn, old.PaidOn) {
		return false
	}
	return true
}

// lightPersonalEdit rewrites one payment's mode, bank, reference and note and its cash-book lines. Nothing is
// recalculated, so how the rest of the history adds up cannot stand in the way of a correction like this.
func lightPersonalEdit(ctx context.Context, tx *gorm.DB, l *models.PersonalLoan, old models.PersonalLoanPayment, in *PersonalPaymentEdit, dryRun bool) error {
	switch l.Status {
	case models.StatusActive, models.StatusPending, models.StatusClosed:
	default:
		return common.NewConflict("a loan in status " + l.Status + " cannot have its ledger edited")
	}
	p := old
	if in.CashAmount != nil {
		p.CashAmount = *in.CashAmount
	}
	if in.UpiAmount != nil {
		p.UpiAmount = *in.UpiAmount
	}
	if in.BankTransferAmount != nil {
		p.BankTransferAmount = *in.BankTransferAmount
	}
	if in.ChequeAmount != nil {
		p.ChequeAmount = *in.ChequeAmount
	}
	if in.BankID != nil {
		p.BankID = in.BankID
	}
	if in.Reference != nil {
		p.Reference = *in.Reference
	}
	if in.Description != nil {
		p.Description = *in.Description
	}
	if p.UpiAmount+p.BankTransferAmount+p.ChequeAmount == 0 {
		p.BankID = nil
	}
	p.Method = common.DeriveMethod(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
	if err := common.ValidateSplit(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, p.Amount); err != nil {
		return err
	}
	if (p.UpiAmount > 0 || p.BankTransferAmount > 0) && p.BankID == nil {
		return common.NewBadRequest("bank is required when the payment breakdown includes UPI or Bank Transfer")
	}
	if dryRun {
		return errEditDryRun
	}
	oldGroup, err := findCashGroup(ctx, tx, old.CashTransactionGroupID, "Personal Loan Payment — "+l.LoanNumber, "in", "Collection", l.BranchID, old.Amount, old.PaidOn)
	if err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Save(&p).Error; err != nil {
		return err
	}
	if err := deleteCashGroup(ctx, tx, oldGroup); err != nil {
		return err
	}
	_, groupID, err := cashbook.RecordLoanPaymentCashIn(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, l.BranchID, p.PaidOn, "Personal Loan Payment", l.CustomerID, p.BankID)
	if err != nil {
		return fmt.Errorf("could not record the corrected payment in Cash-in-Hand: %w", err)
	}
	return tx.WithContext(ctx).Model(&models.PersonalLoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error
}

// editPersonalPayment edits (in != nil) or deletes (in == nil) one payment. Only the entries from it onwards are
// recalculated; the earlier ones are left exactly as saved. A later payment that no longer fits is listed for the
// staff member (with what it can still be) and saved with that amount, or the one they chose.
func editPersonalPayment(ctx context.Context, loanID, paymentID uint, branchID *uint, in *PersonalPaymentEdit, reason string, dryRun bool) (*EditEntryResult, *models.PersonalLoanPayment, error) {
	result := &EditEntryResult{DryRun: dryRun}
	var oldRow *models.PersonalLoanPayment
	err := personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID, branchID)
		if err != nil {
			return common.NewNotFound("personal loan not found")
		}
		pays, insts, err := loadPersonalReplay(ctx, tx, loanID)
		if err != nil {
			return err
		}
		idx := -1
		for i := range pays {
			if pays[i].ID == paymentID {
				idx = i
			}
		}
		if idx < 0 {
			return common.NewNotFound("this ledger entry is not a payment of this loan")
		}
		old := pays[idx]
		oldRow = &old
		result.Before = summarizePersonal(l)
		if onlyModeChanged(&old, in) {
			result.After = result.Before
			return lightPersonalEdit(ctx, tx, l, old, in, dryRun)
		}
		if err := guardPersonalEditable(l, pays); err != nil {
			return err
		}
		originalStatus := l.Status
		edited := append([]models.PersonalLoanPayment{}, pays...)
		from := idx
		if in == nil {
			edited = append(edited[:idx], edited[idx+1:]...)
		} else {
			p := &edited[idx]
			if in.PaidOn != nil && !sameDay(*in.PaidOn, p.PaidOn) {
				p.PaidOn = *in.PaidOn
			}
			if in.Amount != nil {
				p.Amount = common.RoundMoney(*in.Amount)
			}
			if in.CashAmount != nil {
				p.CashAmount = *in.CashAmount
			}
			if in.UpiAmount != nil {
				p.UpiAmount = *in.UpiAmount
			}
			if in.BankTransferAmount != nil {
				p.BankTransferAmount = *in.BankTransferAmount
			}
			if in.ChequeAmount != nil {
				p.ChequeAmount = *in.ChequeAmount
			}
			if in.BankID != nil {
				p.BankID = in.BankID
			}
			if in.Reference != nil {
				p.Reference = *in.Reference
			}
			if in.Description != nil {
				p.Description = *in.Description
			}
			if p.UpiAmount+p.BankTransferAmount+p.ChequeAmount == 0 {
				p.BankID = nil
			}
			p.Method = common.DeriveMethod(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
			if err := validatePersonalPayment(l, p); err != nil {
				return err
			}
			sortPersonalPayments(edited)
			for i := range edited {
				if edited[i].ID == paymentID && i < from {
					from = i
				}
			}
		}
		// the balance the recalculation starts from is the one saved before the first entry it touches
		adjust := map[uint]float64{}
		if in != nil {
			for _, a := range in.Adjust {
				adjust[a.ID] = a.Amount
			}
		}
		base := common.RoundMoney(l.PrincipalAmount)
		if from > 0 {
			base = edited[from-1].RunningBalance
		}
		following, listed, err := fitFollowing(base, edited, from, paymentID, adjust, !dryRun)
		if err != nil {
			return err
		}
		result.Following = listed
		// a later payment brought down to nothing is removed
		var removeIDs []uint
		kept := edited[:0:0]
		for _, p := range edited {
			if p.ID != paymentID && p.Amount <= epsilon {
				removeIDs = append(removeIDs, p.ID)
				continue
			}
			kept = append(kept, p)
		}
		edited = kept
		newInsts, err := applyReplayFrom(l, edited, from, insts, originalStatus)
		if err != nil {
			return err
		}
		result.InstalmentChanges = instalmentChanges(insts, newInsts)
		result.After = summarizePersonal(l)
		if dryRun {
			return errEditDryRun
		}
		byID := map[uint]models.PersonalLoanPayment{}
		for _, p := range pays {
			byID[p.ID] = p
		}
		oldGroup, err := findCashGroup(ctx, tx, old.CashTransactionGroupID, "Personal Loan Payment — "+l.LoanNumber, "in", "Collection", l.BranchID, old.Amount, old.PaidOn)
		if err != nil {
			return err
		}
		// the cash-book lines of every later payment that was lowered or removed
		followingGroups := map[uint]string{}
		for _, f := range following {
			o := byID[f.ID]
			g, err := findCashGroup(ctx, tx, o.CashTransactionGroupID, "Personal Loan Payment — "+l.LoanNumber, "in", "Collection", l.BranchID, o.Amount, o.PaidOn)
			if err != nil {
				return err
			}
			followingGroups[f.ID] = g
		}
		for i := from; i < len(edited); i++ { // the entries before the edit are not rewritten
			if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
				return err
			}
		}
		if in == nil {
			if err := tx.WithContext(ctx).Delete(&models.PersonalLoanPayment{}, paymentID).Error; err != nil {
				return err
			}
		}
		for _, id := range removeIDs {
			if err := tx.WithContext(ctx).Delete(&models.PersonalLoanPayment{}, id).Error; err != nil {
				return err
			}
		}
		for i := range newInsts {
			if err := tx.WithContext(ctx).Save(&newInsts[i]).Error; err != nil {
				return err
			}
		}
		if err := persistPersonalLoan(ctx, tx, l); err != nil {
			return err
		}
		if err := deleteCashGroup(ctx, tx, oldGroup); err != nil {
			return err
		}
		for _, g := range followingGroups {
			if err := deleteCashGroup(ctx, tx, g); err != nil {
				return err
			}
		}
		rebook := func(p *models.PersonalLoanPayment) error {
			_, groupID, err := cashbook.RecordLoanPaymentCashIn(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, l.BranchID, p.PaidOn, "Personal Loan Payment", l.CustomerID, p.BankID)
			if err != nil {
				return fmt.Errorf("could not record the corrected payment in Cash-in-Hand: %w", err)
			}
			return tx.WithContext(ctx).Model(&models.PersonalLoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error
		}
		for i := range edited {
			_, lowered := followingGroups[edited[i].ID]
			if (in != nil && edited[i].ID == paymentID) || lowered {
				if err := rebook(&edited[i]); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if errors.Is(err, errEditDryRun) {
		return result, oldRow, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return result, oldRow, nil
}

func sameDay(a, b time.Time) bool { return a.Format("2006-01-02") == b.Format("2006-01-02") }

// PersonalDisbursementEdit holds what a disbursement edit may change. The amount is fixed: it is
// the loan's principal less interest, and the schedule and balances are built on it.
type PersonalDisbursementEdit struct {
	DisbursedAt        *time.Time
	CashAmount         *float64
	UpiAmount          *float64
	BankTransferAmount *float64
	ChequeAmount       *float64
	BankID             *uint
}

func editPersonalDisbursement(ctx context.Context, loanID uint, branchID *uint, in PersonalDisbursementEdit, reason string, dryRun bool) (*EditEntryResult, *models.PersonalLoan, error) {
	result := &EditEntryResult{DryRun: dryRun}
	var before *models.PersonalLoan
	err := personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID, branchID)
		if err != nil {
			return common.NewNotFound("personal loan not found")
		}
		pays, _, err := loadPersonalReplay(ctx, tx, loanID)
		if err != nil {
			return err
		}
		if err := guardPersonalEditable(l, pays); err != nil {
			return err
		}
		if l.RenewedFromLoanID != nil {
			return common.NewConflict("the disbursement of a renewed loan cannot be edited: its payout was booked together with the renewal")
		}
		snapshot := *l
		before = &snapshot
		result.Before = summarizePersonal(l)
		oldAt := l.DisbursedAt
		if oldAt.IsZero() {
			oldAt = l.OpenedDate
		}
		oldCash, oldUpi, oldBank, oldCheque := l.DisbursementCashAmount, l.DisbursementUpiAmount, l.DisbursementBankTransferAmount, l.DisbursementChequeAmount
		if common.RoundMoney(oldCash+oldUpi+oldBank+oldCheque) == 0 {
			oldCash = l.DisbursedAmount
		}
		if in.DisbursedAt != nil && !sameDay(*in.DisbursedAt, oldAt) {
			d := *in.DisbursedAt
			if d.Format("2006-01-02") > time.Now().Format("2006-01-02") {
				return common.NewBadRequest("disbursement date cannot be in the future")
			}
			if len(pays) > 0 && d.Format("2006-01-02") > pays[0].PaidOn.Format("2006-01-02") {
				return common.NewBadRequest("disbursement date cannot be after the first payment on " + pays[0].PaidOn.Format("2006-01-02"))
			}
			l.DisbursedAt = d
		}
		if in.CashAmount != nil || in.UpiAmount != nil || in.BankTransferAmount != nil || in.ChequeAmount != nil || in.BankID != nil {
			cash, upi, bank, cheque := oldCash, oldUpi, oldBank, oldCheque
			if in.CashAmount != nil {
				cash = *in.CashAmount
			}
			if in.UpiAmount != nil {
				upi = *in.UpiAmount
			}
			if in.BankTransferAmount != nil {
				bank = *in.BankTransferAmount
			}
			if in.ChequeAmount != nil {
				cheque = *in.ChequeAmount
			}
			bankID := l.DisbursementBankID
			if in.BankID != nil {
				bankID = in.BankID
			}
			c, u, b, ch, err := common.NormalizeSplit(cash, upi, bank, cheque, l.DisbursedAmount, bankID)
			if err != nil {
				return err
			}
			l.DisbursementCashAmount, l.DisbursementUpiAmount, l.DisbursementBankTransferAmount, l.DisbursementChequeAmount = c, u, b, ch
			l.DisbursementBankID = nil
			if u+b+ch > 0 {
				l.DisbursementBankID = bankID
			}
		}
		result.After = summarizePersonal(l)
		if dryRun {
			return errEditDryRun
		}
		oldGroup, err := findCashGroup(ctx, tx, l.DisbursementCashGroupID, "Loan disbursement — "+l.LoanNumber, "out", "", l.BranchID, l.DisbursedAmount, oldAt)
		if err != nil {
			return err
		}
		at := l.DisbursedAt
		if at.IsZero() {
			at = l.OpenedDate
		}
		if err := deleteCashGroup(ctx, tx, oldGroup); err != nil {
			return err
		}
		_, groupID, err := cashbook.RecordLoanDisbursementCashOut(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, l.DisbursedAmount, l.DisbursementCashAmount, l.DisbursementUpiAmount, l.DisbursementBankTransferAmount, l.DisbursementChequeAmount, l.BranchID, at, l.CustomerID, l.DisbursementBankID)
		if err != nil {
			return fmt.Errorf("could not record the corrected disbursement in Cash-in-Hand: %w", err)
		}
		l.DisbursementCashGroupID = groupID
		return persistPersonalLoan(ctx, tx, l)
	})
	if errors.Is(err, errEditDryRun) {
		return result, before, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return result, before, nil
}

func writePersonalLedgerAudit(ctx context.Context, actorEmployeeID uint, action string, loanID uint, loanNumber, reason string, old any, res *EditEntryResult) {
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	oldJSON, _ := json.Marshal(old)
	detail := fmt.Sprintf("entry before: %s | loan before: %+v | loan after: %+v", oldJSON, res.Before, res.After)
	if r := strings.TrimSpace(reason); r != "" {
		detail = "reason: " + r + " | " + detail
	}
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: action,
		EntityType: "personal_loan", EntityID: loanID, EntityName: loanNumber, Detail: detail,
	})
}

func parseEditDate(s string) (time.Time, error) {
	t, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil {
		return t, err
	}
	if s == time.Now().Format("2006-01-02") {
		return time.Now(), nil
	}
	return t, nil
}

type editPersonalPaymentRequest struct {
	PaidOn             *string           `json:"paid_on"`
	Amount             *float64          `json:"amount"`
	CashAmount         *float64          `json:"cash_amount"`
	UpiAmount          *float64          `json:"upi_amount"`
	BankTransferAmount *float64          `json:"bank_transfer_amount"`
	ChequeAmount       *float64          `json:"cheque_amount"`
	BankID             *uint             `json:"bank_id"`
	Reference          *string           `json:"reference"`
	Description        *string           `json:"description"`
	Reason             string            `json:"reason"`
	AdjustFollowing    []FollowingAdjust `json:"adjust_following"`
}

// EditPersonalLoanPayment is PATCH /personal-loans/:id/payments/:payment_id[?dry_run=true].
func EditPersonalLoanPayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	paymentID, err := common.IDParam(c, "payment_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req editPersonalPaymentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := &PersonalPaymentEdit{Amount: req.Amount, CashAmount: req.CashAmount, UpiAmount: req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount, ChequeAmount: req.ChequeAmount, BankID: req.BankID,
		Reference: req.Reference, Description: req.Description, Adjust: req.AdjustFollowing}
	if req.PaidOn != nil {
		d, err := parseEditDate(*req.PaidOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid paid_on: expected YYYY-MM-DD"})
		}
		in.PaidOn = &d
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, old, err := editPersonalPayment(ctx, loanID, paymentID, auth.GetBranchScope(c), in, req.Reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actor, _, _ := auth.ActorFromContext(c)
		writePersonalLedgerAudit(ctx, actor, "Ledger entry edited", loanID, personalLoanNumber(ctx, loanID), req.Reason, old, res)
	}
	return common.Success(c, http.StatusOK, res)
}

// DeletePersonalLoanPayment is DELETE /personal-loans/:id/payments/:payment_id?reason=…[&dry_run=true].
func DeletePersonalLoanPayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	paymentID, err := common.IDParam(c, "payment_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	reason := c.QueryParam("reason")
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, old, err := editPersonalPayment(ctx, loanID, paymentID, auth.GetBranchScope(c), nil, reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actor, _, _ := auth.ActorFromContext(c)
		writePersonalLedgerAudit(ctx, actor, "Ledger entry deleted", loanID, personalLoanNumber(ctx, loanID), reason, old, res)
	}
	return common.Success(c, http.StatusOK, res)
}

type editDisbursementRequest struct {
	DisbursedAt        *string  `json:"disbursed_at"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	ChequeAmount       *float64 `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Reason             string   `json:"reason"`
}

// EditPersonalLoanDisbursement is PATCH /personal-loans/:id/disbursement[?dry_run=true].
func EditPersonalLoanDisbursement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req editDisbursementRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := PersonalDisbursementEdit{CashAmount: req.CashAmount, UpiAmount: req.UpiAmount, BankTransferAmount: req.BankTransferAmount, ChequeAmount: req.ChequeAmount, BankID: req.BankID}
	if req.DisbursedAt != nil {
		d, err := parseEditDate(*req.DisbursedAt)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid disbursed_at: expected YYYY-MM-DD"})
		}
		in.DisbursedAt = &d
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, before, err := editPersonalDisbursement(ctx, loanID, auth.GetBranchScope(c), in, req.Reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actor, _, _ := auth.ActorFromContext(c)
		writePersonalLedgerAudit(ctx, actor, "Ledger entry edited", loanID, before.LoanNumber, req.Reason,
			map[string]any{"entry": "disbursement", "disbursed_at": before.DisbursedAt, "cash": before.DisbursementCashAmount, "upi": before.DisbursementUpiAmount, "bank_transfer": before.DisbursementBankTransferAmount, "bank_id": before.DisbursementBankID}, res)
	}
	return common.Success(c, http.StatusOK, res)
}

func personalLoanNumber(ctx context.Context, loanID uint) string {
	if l, err := findPersonalLoanByID(ctx, loanID, nil); err == nil {
		return l.LoanNumber
	}
	return ""
}

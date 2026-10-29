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

// sameInstallments reports the first instalment whose paid amount differs, or "".
func sameInstallments(saved, replayed []models.PersonalLoanInstallment) string {
	for i := range saved {
		if math.Abs(saved[i].PaidAmount-replayed[i].PaidAmount) > epsilon {
			return fmt.Sprintf("instalment %d paid ₹%.2f saved vs ₹%.2f recalculated", saved[i].SequenceNo, saved[i].PaidAmount, replayed[i].PaidAmount)
		}
	}
	return ""
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

// probePersonalLoan checks the untouched replay reproduces the saved figures.
func probePersonalLoan(l *models.PersonalLoan, ordered []models.PersonalLoanPayment, insts []models.PersonalLoanInstallment) error {
	running, outstanding, err := replayBalances(l.PrincipalAmount, ordered)
	if err != nil {
		log.Printf("personal loan %d ledger edit refused: history cannot be recalculated: %v", l.ID, err)
		return common.NewConflict("This entry can't be edited: the loan's history can't be recalculated.")
	}
	for i := range ordered {
		if math.Abs(ordered[i].RunningBalance-running[i]) > epsilon {
			log.Printf("personal loan %d ledger edit refused: balance after the payment of %.2f on %s is %.2f saved vs %.2f recalculated",
				l.ID, ordered[i].Amount, ordered[i].PaidOn.Format("02-01-2006"), ordered[i].RunningBalance, running[i])
			return common.NewConflict("This entry can't be edited: the earlier figures don't recalculate exactly.")
		}
	}
	if math.Abs(outstanding-l.OutstandingAmount) > epsilon || math.Abs(sumPayments(ordered)-l.TotalPaid) > epsilon {
		return common.NewConflict("This entry can't be edited: the earlier figures don't recalculate exactly.")
	}
	if diff := sameInstallments(insts, replayInstallments(insts, sumPayments(ordered))); diff != "" {
		log.Printf("personal loan %d ledger edit refused: instalments not reproduced: %s", l.ID, diff)
		return common.NewConflict("This entry can't be edited: the earlier figures don't recalculate exactly.")
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

// applyReplay writes the recalculated figures onto the loan and returns the instalments to save.
func applyReplay(l *models.PersonalLoan, ordered []models.PersonalLoanPayment, insts []models.PersonalLoanInstallment, originalStatus string) ([]models.PersonalLoanInstallment, error) {
	running, outstanding, err := replayBalances(l.PrincipalAmount, ordered)
	if err != nil {
		return nil, common.NewBadRequest(err.Error())
	}
	for i := range ordered {
		ordered[i].RunningBalance = running[i]
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

// editPersonalPayment edits (in != nil) or deletes (in == nil) one payment, then recalculates the loan.
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
		if err := guardPersonalEditable(l, pays); err != nil {
			return err
		}
		originalStatus := l.Status
		result.Before = summarizePersonal(l)
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
		if err := probePersonalLoan(l, pays, insts); err != nil {
			return err
		}

		edited := append([]models.PersonalLoanPayment{}, pays...)
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
		}
		newInsts, err := applyReplay(l, edited, insts, originalStatus)
		if err != nil {
			return err
		}
		result.After = summarizePersonal(l)
		if dryRun {
			return errEditDryRun
		}

		oldGroup, err := findCashGroup(ctx, tx, old.CashTransactionGroupID, "Personal Loan Payment — "+l.LoanNumber, "in", "Collection", l.BranchID, old.Amount, old.PaidOn)
		if err != nil {
			return err
		}
		for i := range edited {
			if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
				return err
			}
		}
		if in == nil {
			if err := tx.WithContext(ctx).Delete(&models.PersonalLoanPayment{}, paymentID).Error; err != nil {
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
		if in != nil {
			var p *models.PersonalLoanPayment
			for i := range edited {
				if edited[i].ID == paymentID {
					p = &edited[i]
				}
			}
			_, groupID, err := cashbook.RecordLoanPaymentCashIn(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, l.BranchID, p.PaidOn, "Personal Loan Payment", l.CustomerID, p.BankID)
			if err != nil {
				return fmt.Errorf("could not record the corrected payment in Cash-in-Hand: %w", err)
			}
			if err := tx.WithContext(ctx).Model(&models.PersonalLoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error; err != nil {
				return err
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
	PaidOn             *string  `json:"paid_on"`
	Amount             *float64 `json:"amount"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	ChequeAmount       *float64 `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Reference          *string  `json:"reference"`
	Description        *string  `json:"description"`
	Reason             string   `json:"reason"`
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
		Reference: req.Reference, Description: req.Description}
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

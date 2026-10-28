package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
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

// A loan's ledger is made of its payment rows, and every figure on the loan (interest charged, what each payment
// cleared, the balance after it) follows from those rows in date order. Editing or deleting a payment therefore
// works by recalculating the loan from its first day: the interest rows are cleared and charged again, each
// payment is allocated again, and the loan's totals are set from the result — in one transaction, so a result
// that does not hold together saves nothing.
//
// Top-ups are replayed on their own dates, and a Multiple-interest loan is replayed through its rate tiers. Either
// way the loan is first recalculated untouched and an edit is refused unless that reproduces every saved figure, so
// a history this recalculation cannot explain is never rewritten.

var errDryRun = errors.New("dry run")

// replayTxKey carries the transaction a recalculation runs in, so the interest and top-up lookups inside it see
// the rows the recalculation has just written or changed and not only what is committed.
type replayTxKey struct{}

// replayDB is the recalculation's transaction when ctx carries one, otherwise the ordinary connection.
func replayDB(ctx context.Context) *gorm.DB {
	if tx, ok := ctx.Value(replayTxKey{}).(*gorm.DB); ok && tx != nil {
		return tx.WithContext(ctx)
	}
	return config.DB.WithContext(ctx)
}

// replayTypes are the payment rows a recalculation replays. Disbursement is the loan's start, not a repayment.
var replayTypes = map[string]bool{
	models.PaymentTypeInterest: true, models.PaymentTypePenalInterest: true, models.PaymentTypePrincipal: true,
	models.PaymentTypePartial: true, models.PaymentTypeFullSettlement: true,
	models.PaymentTypeDiscount: true, models.PaymentTypeWaiver: true,
	// an auction's proceeds and write-off are replayed so the loan around them is recalculated, but they are
	// changed through the auction edit (auction_edit.go)
	models.PaymentTypeAuctionSale: true, models.PaymentTypeAuctionWriteOff: true,
}

// auctionPaymentTypes are the rows an auction wrote. They sit in the loan's history and are replayed, but editing
// or deleting one would also have to change the auction case, its surplus or shortfall decision and its cash
// lines, so they are changed through the auction edit endpoints (auction_edit.go).
var auctionPaymentTypes = map[string]bool{models.PaymentTypeAuctionSale: true, models.PaymentTypeAuctionWriteOff: true}

// auctionStatuses are the loan statuses an auction leaves; a recalculation keeps them as they are.
var auctionStatuses = map[string]bool{
	models.StatusAuctionEligible: true, models.StatusAuctioned: true, models.StatusAuctionedBalanceDue: true,
}

// LoanSummary is what the preview and the audit trail show of a loan before and after an edit.
type LoanSummary struct {
	Principal float64 `json:"principal"`
	Interest  float64 `json:"interest"`
	Penal     float64 `json:"penal_interest"`
	Fee       float64 `json:"fee"`
	Total     float64 `json:"total"`
	Status    string  `json:"status"`
}

func summarize(l *models.Loan) LoanSummary {
	s := LoanSummary{
		Principal: l.OutstandingAmount,
		Interest:  clampMoney(l.AccruedInterest - l.InterestPaid),
		Penal:     clampMoney(l.AccruedPenalInterest - l.PenalInterestPaid),
		Fee:       l.OutstandingProcessingFee,
		Status:    l.Status,
	}
	s.Total = common.RoundMoney(s.Principal + s.Interest + s.Penal + s.Fee)
	return s
}

// EditPaymentResult is returned by an edit or delete: the loan figures as of the last ledger entry, before and after.
type EditPaymentResult struct {
	Before LoanSummary `json:"before"`
	After  LoanSummary `json:"after"`
	DryRun bool        `json:"dry_run"`
	// Packet is the move back the staff member may choose when the edit reopens a closed loan; PacketReversed says it
	// was done, PacketError why it could not be (the edit itself is already saved).
	Packet         *packet.ReversalPreview `json:"packet,omitempty"`
	PacketReversed bool                    `json:"packet_reversed,omitempty"`
	PacketError    string                  `json:"packet_error,omitempty"`
}

// EditPaymentInput holds the fields a ledger edit may change; nil means "leave as is".
type EditPaymentInput struct {
	PaidOn             *time.Time
	Amount             *float64
	Type               *string
	CashAmount         *float64
	UpiAmount          *float64
	BankTransferAmount *float64
	ChequeAmount       *float64
	BankID             *uint
	Reference          *string
	Description        *string
	InterestOverride   *float64
	ProcessingFee      *float64
	DiscountReason     *string
	DiscountMode       *string
	DiscountKind       *string
	Reason             string
	DryRun             bool
	ActorEmployeeID    uint
}

// guardReplayable refuses a loan whose history this recalculation cannot reproduce.
func guardReplayable(ctx context.Context, tx *gorm.DB, l *models.Loan, payments []models.LoanPayment) error {
	switch l.Status {
	case models.StatusActive, models.StatusDueSoon, models.StatusOverdue, models.StatusClosureRequested, models.StatusClosed,
		models.StatusAuctionEligible, models.StatusAuctioned, models.StatusAuctionedBalanceDue:
	default:
		return common.NewConflict("a loan in status " + l.Status + " cannot have its ledger edited")
	}
	for _, p := range payments {
		if p.Type != models.PaymentTypeDisbursement && !replayTypes[p.Type] {
			return common.NewConflict("ledger edits are not available yet: this loan has a " + p.Type + " entry")
		}
	}
	return nil
}

// loadReplayRows returns the loan's repayment rows in the order they were applied: by date, then by id.
func loadReplayRows(ctx context.Context, tx *gorm.DB, loanID uint) ([]models.LoanPayment, []models.LoanPayment, error) {
	var all []models.LoanPayment
	if err := tx.WithContext(ctx).Where("loan_id = ?", loanID).Order("paid_on asc, id asc").Find(&all).Error; err != nil {
		return nil, nil, err
	}
	var rows []models.LoanPayment
	for _, p := range all {
		if replayTypes[p.Type] {
			rows = append(rows, p)
		}
	}
	return all, rows, nil
}

func sortReplayRows(rows []models.LoanPayment) {
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].PaidOn.Equal(rows[j].PaidOn) {
			return rows[i].PaidOn.Before(rows[j].PaidOn)
		}
		return rows[i].ID < rows[j].ID
	})
}

// replayLoan resets l to the day it started and applies rows in order, rewriting each row's allocation fields.
// The loan's interest rows are deleted and charged again as the payments are reached.
func replayLoan(ctx context.Context, tx *gorm.DB, l *models.Loan, rows []models.LoanPayment, originalStatus string) error {
	return replayLoanFrom(ctx, tx, l, rows, originalStatus, 0)
}

// accrueAdvance moves l's interest forward to paidOn exactly as accrueThroughInTxAt does, but saves nothing: it is
// how the part of the history before an edit is walked through without being rewritten.
func accrueAdvance(ctx context.Context, l *models.Loan, paidOn time.Time) {
	accrueAdvanceThrough(ctx, l, paidOn, true)
}

// accrueAdvanceThrough is accrueAdvance with the choice of whether the part period up to paidOn is charged too.
func accrueAdvanceThrough(ctx context.Context, l *models.Loan, paidOn time.Time, through bool) {
	if now := time.Now(); paidOn.After(now) {
		paidOn = now
	}
	asOf := sameClockAsOpened(l, paidOn)
	for pass := 0; pass < 2; pass++ {
		accrueStep(ctx, l, asOf, through)
	}
}

// replayLoanFrom is replayLoan for an edit that only has to recalculate from its own entry onwards. The rows before
// index from are walked through with their SAVED allocations (what each one actually paid) and their interest rows
// are left as they are; nothing before the edit is recalculated or rewritten, so an earlier entry can no longer
// stop a later one from being corrected. From the edited entry on, interest rows are deleted and charged again and
// every row is allocated afresh. from 0 recalculates the whole history.
func replayLoanFrom(ctx context.Context, tx *gorm.DB, l *models.Loan, rows []models.LoanPayment, originalStatus string, from int) error {
	ctx = context.WithValue(ctx, replayTxKey{}, tx)
	if from > len(rows) {
		from = len(rows)
	}
	cut := func() error { // the interest rows from the edit onwards are charged again
		return tx.WithContext(ctx).Where("loan_id = ? AND accrued_on > ?", l.ID, l.LastAccrualDate).Delete(&models.LoanAccrual{}).Error
	}
	cutDone := from == 0
	if from == 0 {
		if err := tx.WithContext(ctx).Where("loan_id = ?", l.ID).Delete(&models.LoanAccrual{}).Error; err != nil {
			return err
		}
	}
	// A top-up raised the principal part-way through, so the loan starts from what was first sanctioned and
	// each top-up adds its amount when its date is reached.
	topUps, err := activeTopUpsInOrder(ctx, tx, l.ID)
	if err != nil {
		return err
	}
	initial := l.PrincipalAmount
	for _, t := range topUps {
		initial = common.RoundMoney(initial - t.Amount)
	}
	l.AccruedInterest, l.AccruedPenalInterest = 0, 0
	l.InterestPaid, l.PenalInterestPaid = 0, 0
	l.OutstandingProcessingFee = 0
	l.OutstandingAmount = initial
	l.LastAccrualDate = l.OpenedDate
	l.RateTierLevel = 0
	l.ArrearsSince = nil
	l.Status = models.StatusActive

	next := 0 // the next top-up not yet applied
	for i := range rows {
		p := &rows[i]
		if i == from && !cutDone {
			if err := cut(); err != nil {
				return err
			}
			cutDone = true
		}
		for next < len(topUps) && !topUps[next].OccurredOn.After(p.PaidOn) {
			if i < from {
				accrueAdvanceThrough(ctx, l, topUps[next].OccurredOn, false)
				l.OutstandingAmount = common.RoundMoney(l.OutstandingAmount + topUps[next].Amount)
			} else if err := applyTopUpToReplay(ctx, tx, l, &topUps[next]); err != nil {
				return err
			}
			next++
		}
		if i < from {
			// before the edit: the entry stands as it was saved
			accrueAdvance(ctx, l, p.PaidOn)
			if p.Type != models.PaymentTypeDiscount && p.ProcessingFee > 0 {
				l.OutstandingProcessingFee = common.RoundMoney(l.OutstandingProcessingFee + p.ProcessingFee)
			}
			l.OutstandingProcessingFee = math.Max(0, common.RoundMoney(l.OutstandingProcessingFee-p.ProcessingFeeApplied))
			l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + p.PenalInterestApplied)
			l.InterestPaid = common.RoundMoney(l.InterestPaid + p.InterestApplied)
			l.OutstandingAmount = math.Max(0, common.RoundMoney(l.OutstandingAmount-p.PrincipalApplied))
			if isCashPaymentType(p.Type) {
				resetRateCycle(l, p.PaidOn)
			}
			continue
		}
		if err := accrueThroughInTxAt(ctx, tx, l, p.PaidOn, p.CreatedAt); err != nil {
			return err
		}
		var fee, penal, interest, principal float64
		var err error
		if p.Type == models.PaymentTypeDiscount {
			penal, interest, principal, err = allocateDiscountKind(l, p.Amount, p.DiscountKind)
			if err == nil && common.RoundMoney(p.Amount-(penal+interest+principal)) > moneyEpsilon {
				err = common.NewBadRequest("the discount cannot exceed what is owed on the loan")
			}
		} else {
			if p.ProcessingFee > 0 {
				l.OutstandingProcessingFee = common.RoundMoney(l.OutstandingProcessingFee + p.ProcessingFee)
			}
			fee, penal, interest, principal, err = allocatePayment(l, p.Type, p.Amount, p.InterestOverride)
		}
		if err != nil {
			return fmt.Errorf("%s of ₹%.2f on %s no longer fits the loan: %w%s", p.Type, p.Amount, p.PaidOn.Format("02-01-2006"), err, owedAtPayment(l, p))
		}
		l.OutstandingProcessingFee = math.Max(0, common.RoundMoney(l.OutstandingProcessingFee-fee))
		l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + penal)
		l.InterestPaid = common.RoundMoney(l.InterestPaid + interest)
		l.OutstandingAmount = math.Max(0, common.RoundMoney(l.OutstandingAmount-principal))
		if isCashPaymentType(p.Type) {
			resetRateCycle(l, p.PaidOn)
		}
		oi := l.AccruedInterest - l.InterestPaid
		op := l.AccruedPenalInterest - l.PenalInterestPaid
		p.ProcessingFeeApplied, p.PenalInterestApplied, p.InterestApplied, p.PrincipalApplied = fee, penal, interest, principal
		p.RunningBalance = l.OutstandingAmount + math.Max(0, oi) + math.Max(0, op) + l.OutstandingProcessingFee
	}

	if !cutDone { // the edit is at the very end: nothing after the last saved entry is kept
		if err := cut(); err != nil {
			return err
		}
	}
	for ; next < len(topUps); next++ { // top-ups dated after the last payment
		if err := applyTopUpToReplay(ctx, tx, l, &topUps[next]); err != nil {
			return err
		}
	}
	oi := l.AccruedInterest - l.InterestPaid
	op := l.AccruedPenalInterest - l.PenalInterestPaid
	cleared := l.OutstandingAmount <= 0 && oi <= moneyEpsilon && op <= moneyEpsilon && l.OutstandingProcessingFee <= moneyEpsilon
	switch {
	case auctionStatuses[originalStatus]:
		l.Status = originalStatus // the auction decided this status, not the balance
	case cleared && originalStatus == models.StatusClosed:
		l.Status = models.StatusClosed
	case cleared:
		l.Status = models.StatusClosureRequested
	default:
		l.Status = models.StatusActive
		refreshServicingStatus(l, time.Now())
	}
	return nil
}

// activeTopUpsInOrder returns the loan's approved top-ups in the order they were applied.
func activeTopUpsInOrder(ctx context.Context, tx *gorm.DB, loanID uint) ([]models.LoanTopUp, error) {
	var ups []models.LoanTopUp
	err := tx.WithContext(ctx).Where("loan_id = ? AND status = ?", loanID, models.TopUpStatusActive).
		Order("occurred_on asc, id asc").Find(&ups).Error
	return ups, err
}

// applyTopUpToReplay adds a top-up to the principal the way the top-up itself did: it charges the periods completed by its
// date (not the part period, which is charged when the next payment is reached, on the raised principal) and then adds it.
func applyTopUpToReplay(ctx context.Context, tx *gorm.DB, l *models.Loan, t *models.LoanTopUp) error {
	if err := accrueInTxAt(ctx, tx, l, t.OccurredOn, t.CreatedAt, false); err != nil {
		return err
	}
	l.OutstandingAmount = common.RoundMoney(l.OutstandingAmount + t.Amount)
	return nil
}

// owedAtPayment says what the loan owed when a payment was reached in the replay, so a refused amount can be fixed:
// the largest amount that fits, and the discounts dated before it that already reduced what is owed.
func owedAtPayment(l *models.Loan, p *models.LoanPayment) string {
	interest := l.AccruedInterest - l.InterestPaid
	if p.InterestOverride != nil {
		interest = *p.InterestOverride
	}
	penal := l.AccruedPenalInterest - l.PenalInterestPaid
	total := common.RoundMoney(l.OutstandingAmount + clampMoney(interest) + clampMoney(penal) + l.OutstandingProcessingFee)
	return fmt.Sprintf(" — at that point the loan owed ₹%.2f (principal ₹%.2f, interest ₹%.2f, penal interest ₹%.2f, fee ₹%.2f), so this payment can be at most ₹%.2f; a discount entered on the same day is applied before it",
		total, l.OutstandingAmount, clampMoney(interest), clampMoney(penal), l.OutstandingProcessingFee, total)
}

// sameLoanFigures reports the first loan total a recalculation does not reproduce, or "" when they all match.
func sameLoanFigures(saved, replayed *models.Loan) string {
	checks := []struct {
		name string
		a, b float64
	}{
		{"principal outstanding", saved.OutstandingAmount, replayed.OutstandingAmount},
		{"interest charged", saved.AccruedInterest, replayed.AccruedInterest},
		{"interest paid", saved.InterestPaid, replayed.InterestPaid},
	}
	for _, c := range checks {
		if math.Abs(c.a-c.b) > moneyEpsilon {
			return fmt.Sprintf("%s ₹%.2f saved vs ₹%.2f recalculated", c.name, c.a, c.b)
		}
	}
	return ""
}

// sameAllocation reports the first row whose recalculated split differs from what is saved.
func sameAllocation(saved, replayed []models.LoanPayment) string {
	for i := range saved {
		a, b := saved[i], replayed[i]
		if math.Abs(a.InterestApplied-b.InterestApplied) > moneyEpsilon || math.Abs(a.PenalInterestApplied-b.PenalInterestApplied) > moneyEpsilon ||
			math.Abs(a.PrincipalApplied-b.PrincipalApplied) > moneyEpsilon || math.Abs(a.ProcessingFeeApplied-b.ProcessingFeeApplied) > moneyEpsilon {
			return fmt.Sprintf("%s of ₹%.2f on %s: interest ₹%.2f saved vs ₹%.2f recalculated", a.Type, a.Amount, a.PaidOn.Format("02-01-2006"), a.InterestApplied, b.InterestApplied)
		}
	}
	return ""
}

func validateEditedPayment(l *models.Loan, p *models.LoanPayment) error {
	if p.Amount <= 0 {
		return common.NewBadRequest("amount must be greater than zero")
	}
	if err := validatePaymentDateWindow(l, p.PaidOn); err != nil {
		return err
	}
	if isCashPaymentType(p.Type) {
		if !staffSelectablePaymentTypes[p.Type] {
			return common.NewBadRequest("type must be one of: Interest, Penal Interest, Principal, Partial, Full Settlement")
		}
		if err := common.ValidateSplit(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, p.Amount); err != nil {
			return err
		}
		if (p.UpiAmount > 0 || p.BankTransferAmount > 0 || p.ChequeAmount > 0) && p.BankID == nil {
			return common.NewBadRequest("bank is required when the payment breakdown includes UPI or Bank Transfer")
		}
	}
	return nil
}

// editLoanPayment edits (in != nil) or deletes (in == nil) one payment row, then recalculates the loan.
func editLoanPayment(ctx context.Context, loanID, paymentID uint, in *EditPaymentInput, reason string, dryRun bool) (*EditPaymentResult, *models.LoanPayment, error) {
	result := &EditPaymentResult{DryRun: dryRun}
	var oldRow *models.LoanPayment
	var loanNumber string
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID)
		if err != nil {
			return common.NewNotFound("loan not found")
		}
		loanNumber = l.LoanNumber
		all, rows, err := loadReplayRows(ctx, tx, loanID)
		if err != nil {
			return err
		}
		if err := guardReplayable(ctx, tx, l, all); err != nil {
			return err
		}
		originalStatus := l.Status
		result.Before = summarize(l)

		idx := -1
		for i := range rows {
			if rows[i].ID == paymentID {
				idx = i
			}
		}
		if idx < 0 {
			return common.NewNotFound("this ledger entry cannot be edited (it is not a payment or discount of this loan)")
		}
		if auctionPaymentTypes[rows[idx].Type] {
			return common.NewConflict("an auction entry is changed from the auction edit (PATCH or DELETE /loans/:id/auction/sale, /auction/surplus or /auction/write-off), not as an ordinary payment")
		}
		old := rows[idx]
		oldRow = &old

		// The loan is first recalculated untouched: if that does not reproduce what is saved, the history holds
		// figures this recalculation cannot explain and an edit would silently change them.
		// The recalculation starts at the earliest entry the edit touches (the entry itself, or where a new date moves
		// it to); everything before is kept exactly as saved. Multiple-interest loans restate earlier interest rows
		// when the rate steps, so they are still recalculated whole.
		from := idx
		if in != nil && in.PaidOn != nil {
			moved := make([]models.LoanPayment, len(rows))
			copy(moved, rows)
			moved[idx].PaidOn = *in.PaidOn
			sortReplayRows(moved)
			if ni := findRow(moved, paymentID); ni < from {
				from = ni
			}
		}
		if l.SchemeInterestMethod == commonModels.InterestMethodMultiple {
			from = 0
		}
		if err := probeReplayFrom(ctx, tx, l, rows, originalStatus, from); err != nil {
			return err
		}
		oldGroup, err := paymentCashGroup(ctx, tx, l, &old)
		if err != nil {
			return err
		}

		edited := rows
		if in == nil {
			edited = append(append([]models.LoanPayment{}, rows[:idx]...), rows[idx+1:]...)
		} else {
			p := &edited[idx]
			if in.PaidOn != nil {
				p.PaidOn = *in.PaidOn
			}
			if in.Amount != nil {
				p.Amount = *in.Amount
			}
			if in.Type != nil && p.Type != models.PaymentTypeDiscount && p.Type != models.PaymentTypeWaiver {
				p.Type = *in.Type
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
			if in.InterestOverride != nil {
				p.InterestOverride = in.InterestOverride
			}
			if in.ProcessingFee != nil {
				p.ProcessingFee = *in.ProcessingFee
			}
			if p.Type == models.PaymentTypeDiscount {
				if in.DiscountReason != nil {
					if strings.TrimSpace(*in.DiscountReason) == "" {
						return common.NewBadRequest("a reason is required for a discount")
					}
					p.Description = "Discount: " + strings.TrimSpace(*in.DiscountReason)
				}
				if in.DiscountMode != nil {
					if !discountModes[*in.DiscountMode] {
						return common.NewBadRequest("discount mode must be Cash, UPI, Bank Transfer or Cheque")
					}
					p.Method = *in.DiscountMode
				}
				if in.DiscountKind != nil {
					if !validDiscountKind(*in.DiscountKind) {
						return common.NewBadRequest("discount type must be Custom discount, Interest or Penal interest")
					}
					p.DiscountKind = *in.DiscountKind
				}
			} else if isCashPaymentType(p.Type) {
				p.Method = methodOrDerived("", p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
			}
			if err := validateEditedPayment(l, p); err != nil {
				return err
			}
			sortReplayRows(edited)
		}

		if err := replayLoanFrom(ctx, tx, l, edited, originalStatus, from); err != nil {
			return common.NewBadRequest(err.Error())
		}
		result.After = summarize(l)
		if dryRun {
			return errDryRun
		}

		// Save: the recalculated rows, the loan, and this one payment's cash lines.
		for i := from; i < len(edited); i++ { // the entries before the edit are not rewritten
			if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
				return err
			}
		}
		if in == nil {
			if err := tx.WithContext(ctx).Delete(&models.LoanPayment{}, paymentID).Error; err != nil {
				return err
			}
		}
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		txCtx := cashbook.WithTx(ctx, tx)
		if err := cashbook.DeleteCollectionByGroup(txCtx, oldGroup); err != nil {
			return err
		}
		if in != nil && isCashPaymentType(edited[findRow(edited, paymentID)].Type) {
			p := &edited[findRow(edited, paymentID)]
			_, groupID, err := cashbook.RecordLoanPaymentCashIn(txCtx, l.ID, l.LoanNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, l.BranchID, p.PaidOn, p.Type, l.CustomerID, p.BankID)
			if err != nil {
				return fmt.Errorf("could not record the corrected payment in Cash-in-Hand: %w", err)
			}
			if err := tx.WithContext(ctx).Model(&models.LoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, errDryRun) {
		return result, oldRow, nil
	}
	if err != nil {
		return nil, nil, err
	}
	_ = loanNumber
	return result, oldRow, nil
}

// paymentCashGroup is the cash-book group a repayment booked. A payment saved without its group is found by its
// purpose, date and amount, and only used when exactly one group fits and no other payment claims it; otherwise the
// edit is refused, because rewriting the payment would leave its old lines beside the corrected ones.
func paymentCashGroup(ctx context.Context, tx *gorm.DB, l *models.Loan, p *models.LoanPayment) (string, error) {
	if !isCashPaymentType(p.Type) || p.CashTransactionGroupID != "" {
		return p.CashTransactionGroupID, nil
	}
	var groups []struct {
		TransactionGroupID string
		Total              float64
	}
	if err := tx.WithContext(ctx).Table("cash_movements").
		Select("transaction_group_id, SUM(amount) AS total").
		Where("source = ? AND type = ? AND purpose = ? AND occurred_on = ? AND transaction_group_id <> '' AND transaction_group_id NOT IN (SELECT cash_transaction_group_id FROM loan_payments WHERE loan_id = ? AND cash_transaction_group_id IS NOT NULL)",
			"Collection", "in", fmt.Sprintf("%s — %s", p.Type, l.LoanNumber), p.PaidOn, l.ID).
		Group("transaction_group_id").Scan(&groups).Error; err != nil {
		return "", err
	}
	var match []string
	for _, g := range groups {
		if absMoney(g.Total-p.Amount) <= 0.01 {
			match = append(match, g.TransactionGroupID)
		}
	}
	if len(match) != 1 {
		return "", common.NewConflict("this payment's cash entries cannot be identified exactly, so it cannot be edited safely")
	}
	return match[0], nil
}

func findRow(rows []models.LoanPayment, id uint) int {
	for i := range rows {
		if rows[i].ID == id {
			return i
		}
	}
	return 0
}

func writeLedgerAudit(ctx context.Context, actorEmployeeID uint, action string, loanID uint, loanNumber, reason string, old *models.LoanPayment, res *EditPaymentResult) {
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	oldJSON, _ := json.Marshal(old)
	detail := fmt.Sprintf("reason: %s | entry before: %s | loan before: %+v | loan after: %+v", reason, oldJSON, res.Before, res.After)
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: action,
		EntityType: "loan", EntityID: loanID, EntityName: loanNumber, Detail: detail,
	})
}

type editPaymentRequest struct {
	PaidOn             *string  `json:"paid_on"`
	Amount             *float64 `json:"amount"`
	Type               *string  `json:"type"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	ChequeAmount       *float64 `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Reference          *string  `json:"reference"`
	Description        *string  `json:"description"`
	InterestOverride   *float64 `json:"interest_override"`
	ProcessingFee      *float64 `json:"processing_fee"`
	DiscountReason     *string  `json:"discount_reason"`
	DiscountMode       *string  `json:"discount_mode"`
	DiscountKind       *string  `json:"discount_kind"`
	Reason             string   `json:"reason"`
	ReversePacket      bool     `json:"reverse_packet"`
}

// EditLoanPayment is PATCH /loans/:id/payments/:payment_id[?dry_run=true].
func EditLoanPayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	paymentID, err := common.IDParam(c, "payment_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	var req editPaymentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := &EditPaymentInput{
		Amount: req.Amount, Type: req.Type, CashAmount: req.CashAmount, UpiAmount: req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount, ChequeAmount: req.ChequeAmount, BankID: req.BankID,
		Reference: req.Reference, Description: req.Description, InterestOverride: req.InterestOverride,
		ProcessingFee: req.ProcessingFee, DiscountReason: req.DiscountReason, DiscountMode: req.DiscountMode, DiscountKind: req.DiscountKind,
	}
	if req.PaidOn != nil {
		d, err := parsePaidOn(*req.PaidOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid paid_on: expected YYYY-MM-DD"})
		}
		in.PaidOn = &d
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, old, err := editLoanPayment(ctx, loanID, paymentID, in, req.Reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	if !dryRun {
		writeLedgerAudit(ctx, actorEmployeeID, "Ledger entry edited", loanID, loanNumberOf(ctx, loanID), req.Reason, old, res)
	}
	applyPacketReversal(ctx, loanID, actorEmployeeID, res, req.ReversePacket, dryRun)
	return common.Success(c, http.StatusOK, res)
}

// DeleteLoanPayment is DELETE /loans/:id/payments/:payment_id?reason=…[&dry_run=true].
func DeleteLoanPayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	paymentID, err := common.IDParam(c, "payment_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	reason := c.QueryParam("reason")
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, old, err := editLoanPayment(ctx, loanID, paymentID, nil, reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	if !dryRun {
		writeLedgerAudit(ctx, actorEmployeeID, "Ledger entry deleted", loanID, loanNumberOf(ctx, loanID), reason, old, res)
	}
	reversePacket, _ := strconv.ParseBool(c.QueryParam("reverse_packet"))
	applyPacketReversal(ctx, loanID, actorEmployeeID, res, reversePacket, dryRun)
	return common.Success(c, http.StatusOK, res)
}

func loanNumberOf(ctx context.Context, loanID uint) string {
	if l, err := findLoanByID(ctx, loanID); err == nil {
		return l.LoanNumber
	}
	return ""
}

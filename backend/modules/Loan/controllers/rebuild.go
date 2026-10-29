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
	// Dependents are what a gold release did that this edit may need to undo (the packet, a partial release). The
	// chosen ones are undone in the same transaction as the edit.
	Dependents []EditDependent         `json:"dependents,omitempty"`
	Packet     *packet.ReversalPreview `json:"packet,omitempty"`
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
	Discount           *float64 // the discount that came with this payment: a new amount, or 0 to remove it
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
	placeLinkedDiscountsFirst(rows)
	return all, rows, nil
}

func sortReplayRows(rows []models.LoanPayment) {
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].PaidOn.Equal(rows[j].PaidOn) {
			return rows[i].PaidOn.Before(rows[j].PaidOn)
		}
		return rows[i].ID < rows[j].ID
	})
	placeLinkedDiscountsFirst(rows)
}

// placeLinkedDiscountsFirst moves a discount that was given together with a payment (and saved after it by an edit)
// to just before that payment, which is where Record Payment saves it: the discount is applied first and lowers what
// the payment has to cover.
func placeLinkedDiscountsFirst(rows []models.LoanPayment) {
	for i := range rows {
		d := rows[i]
		if d.Type != models.PaymentTypeDiscount || d.LinkedPaymentID == nil {
			continue
		}
		for j := 0; j < i; j++ {
			if rows[j].ID == *d.LinkedPaymentID && rows[j].PaidOn.Equal(d.PaidOn) {
				copy(rows[j+1:i+1], rows[j:i])
				rows[j] = d
				break
			}
		}
	}
}

// linkedDiscountIndex is the discount that came with the payment at idx: the one that points at it, or for a payment
// saved before the link existed the discount saved right before it, within the same couple of seconds. -1 when there is none.
func linkedDiscountIndex(rows []models.LoanPayment, idx int) int {
	id := rows[idx].ID
	for i := range rows {
		if rows[i].Type == models.PaymentTypeDiscount && rows[i].LinkedPaymentID != nil && *rows[i].LinkedPaymentID == id {
			return i
		}
	}
	if idx > 0 {
		d := rows[idx-1]
		gap := d.PaidOn.Sub(rows[idx].PaidOn)
		if gap < 0 {
			gap = -gap
		}
		if d.Type == models.PaymentTypeDiscount && d.LinkedPaymentID == nil && d.ID < rows[idx].ID && gap <= 2*time.Second {
			return idx - 1
		}
	}
	return -1
}

func normDiscountKind(k string) string {
	if k == "" {
		return DiscountKindCustomer
	}
	return k
}

// applyLinkedDiscountEdit changes, creates or removes the discount that came with the payment at idx, and returns the
// rows to recalculate and the ids of rows to delete.
func applyLinkedDiscountEdit(rows []models.LoanPayment, idx, didx int, in *EditPaymentInput) ([]models.LoanPayment, []uint, error) {
	pay := rows[idx]
	if in.DiscountKind != nil && !validDiscountKind(*in.DiscountKind) {
		return nil, nil, common.NewBadRequest("discount type must be Custom discount, Interest or Penal interest")
	}
	if in.Discount != nil && *in.Discount < 0 {
		return nil, nil, common.NewBadRequest("discount cannot be negative")
	}
	pid := pay.ID
	if didx >= 0 {
		d := &rows[didx]
		d.PaidOn = pay.PaidOn // follows the payment's date
		d.LinkedPaymentID = &pid
		if in.DiscountKind != nil {
			d.DiscountKind = *in.DiscountKind
		}
		if in.Discount != nil {
			if *in.Discount <= 0.004 {
				id := d.ID
				return append(append([]models.LoanPayment{}, rows[:didx]...), rows[didx+1:]...), []uint{id}, nil
			}
			d.Amount = common.RoundMoney(*in.Discount)
		}
		return rows, nil, nil
	}
	if in.Discount != nil && *in.Discount > 0.004 {
		kind := DiscountKindCustomer
		if in.DiscountKind != nil && *in.DiscountKind != "" {
			kind = *in.DiscountKind
		}
		d := models.LoanPayment{
			LoanID: pay.LoanID, Type: models.PaymentTypeDiscount, Amount: common.RoundMoney(*in.Discount), PaidOn: pay.PaidOn,
			Method: "Cash", Description: "Discount: Discount", DiscountKind: kind,
			ReceivedByEmployeeID: pay.ReceivedByEmployeeID, LinkedPaymentID: &pid,
		}
		return append(rows, d), nil, nil
	}
	return rows, nil, nil
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
	ctx = withTopUpCutoff(ctx, paidOn)
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
			return shortFitError(l, p, err)
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

// shortFitError is the message when an entry no longer fits the loan during a recalculation: which entry, and the most
// it can be. The loan's whole balance at that point is left out of the message.
func shortFitError(l *models.Loan, p *models.LoanPayment, cause error) error {
	when := p.PaidOn.Format("02-01-2006")
	msg := cause.Error()
	if strings.Contains(msg, "does not match what is owed") {
		interest := l.AccruedInterest - l.InterestPaid
		if p.InterestOverride != nil {
			interest = *p.InterestOverride
		}
		owed := common.RoundMoney(l.OutstandingAmount + clampMoney(interest) + clampMoney(l.AccruedPenalInterest-l.PenalInterestPaid) + l.OutstandingProcessingFee)
		return fmt.Errorf("%s on %s can be at most ₹%.2f", p.Type, when, owed)
	}
	return fmt.Errorf("%s on %s: %s", p.Type, when, msg)
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
func editLoanPayment(ctx context.Context, loanID, paymentID uint, in *EditPaymentInput, reason string, dryRun bool, choices packetChoices) (*EditPaymentResult, *models.LoanPayment, error) {
	result := &EditPaymentResult{DryRun: dryRun}
	restoredOrnaments := false
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
		originalStatus := l.Status
		result.Before = summarize(l)

		idx := -1
		for i := range rows {
			if rows[i].ID == paymentID {
				idx = i
			}
		}
		if idx < 0 {
			return common.NewNotFound("this entry can't be edited here")
		}
		if auctionPaymentTypes[rows[idx].Type] {
			return common.NewConflict("an auction entry is changed from the auction screen")
		}
		old := rows[idx]
		oldRow = &old
		// The edit form sends the date alone, which reads as the start of that day. An unchanged date keeps the entry's
		// saved moment, or it would jump ahead of the same-day entries saved before it (the sanction, its discount).
		if in != nil && in.PaidOn != nil && in.PaidOn.In(time.Local).Format("2006-01-02") == old.PaidOn.In(time.Local).Format("2006-01-02") {
			kept := old.PaidOn
			in.PaidOn = &kept
		}

		// the discount that came with this payment (edited together with it)
		didx := -1
		discountChanged := false
		if in != nil && old.Type != models.PaymentTypeDiscount {
			didx = linkedDiscountIndex(rows, idx)
			cur, curKind := 0.0, DiscountKindCustomer
			if didx >= 0 {
				cur, curKind = rows[didx].Amount, normDiscountKind(rows[didx].DiscountKind)
			}
			if in.Discount != nil && absMoney(*in.Discount-cur) > 0.004 {
				discountChanged = true
			}
			if in.DiscountKind != nil && didx >= 0 && normDiscountKind(*in.DiscountKind) != curKind {
				discountChanged = true
			}
		}

		// An edit that leaves every figure alone (the payment mode, bank, reference or note) changes no balance and no
		// interest, so the loan is not recalculated at all: only this entry and its cash lines are rewritten.
		if in != nil && !discountChanged && !editChangesFigures(&old, in) {
			if l.Status == models.StatusPendingApproval || l.Status == models.StatusRejected {
				return common.NewConflict("this loan can't be edited in its current status")
			}
			result.After = result.Before
			return lightEditPayment(ctx, tx, l, &rows[idx], in, dryRun)
		}
		if err := guardReplayable(ctx, tx, l, all); err != nil {
			return err
		}

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
		if didx >= 0 && didx < from {
			from = didx
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
		var deleteIDs []uint // a discount removed with its payment's edit
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
			if p.Type != models.PaymentTypeDiscount && (in.Discount != nil || in.DiscountKind != nil) {
				var derr error
				if edited, deleteIDs, derr = applyLinkedDiscountEdit(edited, idx, didx, in); derr != nil {
					return derr
				}
			}
			sortReplayRows(edited)
		}

		if err := replayLoanFrom(ctx, tx, l, edited, originalStatus, from); err != nil {
			return common.NewBadRequest(err.Error())
		}
		result.After = summarize(l)
		result.Dependents = editDependents(ctx, loanID, result)
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
		for _, id := range deleteIDs {
			if err := tx.WithContext(ctx).Delete(&models.LoanPayment{}, id).Error; err != nil {
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
		// the gold the ticked boxes put back, saved with the edit or not at all
		restoredOrnaments, err = applyEditDependents(ctx, tx, loanID, result.Dependents, choices)
		return err
	})
	if errors.Is(err, errDryRun) {
		return result, oldRow, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if restoredOrnaments { // the loan's eligible amount follows the ornaments it holds again
		if fresh, ferr := findLoanByID(ctx, loanID); ferr == nil {
			if _, rerr := recalculateAndSave(ctx, fresh); rerr != nil {
				log.Printf("could not refresh loan %d after putting released ornaments back: %v", loanID, rerr)
			}
		}
	}
	_ = loanNumber
	return result, oldRow, nil
}

// editChangesFigures reports whether an edit changes anything the loan's figures depend on: the amount, the date, the
// type, the interest typed over the calculated one, the fee charged with it, or what a discount was given against.
// The payment mode, bank, reference and note are not among them.
func editChangesFigures(old *models.LoanPayment, in *EditPaymentInput) bool {
	day := func(t time.Time) string { return t.In(time.Local).Format("2006-01-02") }
	if in.PaidOn != nil && day(*in.PaidOn) != day(old.PaidOn) {
		return true
	}
	if in.Amount != nil && absMoney(*in.Amount-old.Amount) > 0.004 {
		return true
	}
	if in.Type != nil && old.Type != models.PaymentTypeDiscount && old.Type != models.PaymentTypeWaiver && *in.Type != old.Type {
		return true
	}
	if in.InterestOverride != nil && (old.InterestOverride == nil || absMoney(*in.InterestOverride-*old.InterestOverride) > 0.004) {
		return true
	}
	if in.ProcessingFee != nil && absMoney(*in.ProcessingFee-old.ProcessingFee) > 0.004 {
		return true
	}
	if in.DiscountKind != nil && old.Type == models.PaymentTypeDiscount {
		norm := func(k string) string {
			if k == "" {
				return DiscountKindCustomer
			}
			return k
		}
		if norm(*in.DiscountKind) != norm(old.DiscountKind) {
			return true
		}
	}
	return false
}

// lightEditPayment saves an edit that changes no figure: the entry's mode, bank, reference and note, and its cash
// lines. Nothing about the loan is recalculated, so an old history that could not be reproduced exactly no longer
// stands in the way of a correction like this.
func lightEditPayment(ctx context.Context, tx *gorm.DB, l *models.Loan, p *models.LoanPayment, in *EditPaymentInput, dryRun bool) error {
	oldGroup, err := paymentCashGroup(ctx, tx, l, p)
	if err != nil {
		return err
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
	} else if isCashPaymentType(p.Type) {
		p.Method = methodOrDerived("", p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
		if p.Amount <= 0 {
			return common.NewBadRequest("amount must be greater than zero")
		}
		if err := common.ValidateSplit(p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, p.Amount); err != nil {
			return err
		}
		if (p.UpiAmount > 0 || p.BankTransferAmount > 0 || p.ChequeAmount > 0) && p.BankID == nil {
			return common.NewBadRequest("bank is required when the payment breakdown includes UPI or Bank Transfer")
		}
	}
	if dryRun {
		return errDryRun
	}
	if err := tx.WithContext(ctx).Save(p).Error; err != nil {
		return err
	}
	if !isCashPaymentType(p.Type) {
		return nil
	}
	txCtx := cashbook.WithTx(ctx, tx)
	if err := cashbook.DeleteCollectionByGroup(txCtx, oldGroup); err != nil {
		return err
	}
	_, groupID, err := cashbook.RecordLoanPaymentCashIn(txCtx, l.ID, l.LoanNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, l.BranchID, p.PaidOn, p.Type, l.CustomerID, p.BankID)
	if err != nil {
		return fmt.Errorf("could not record the corrected payment in Cash-in-Hand: %w", err)
	}
	return tx.WithContext(ctx).Model(&models.LoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error
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
		return "", common.NewConflict("This payment's cash entries can't be matched, so it can't be edited.")
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
	Discount           *float64 `json:"discount"`
	Reason             string   `json:"reason"`
	ReversePacket      bool     `json:"reverse_packet"`
	RestorePartial     bool     `json:"restore_partial_release"`
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
		ProcessingFee: req.ProcessingFee, DiscountReason: req.DiscountReason, DiscountMode: req.DiscountMode, DiscountKind: req.DiscountKind, Discount: req.Discount,
	}
	if req.PaidOn != nil {
		d, err := parsePaidOn(*req.PaidOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid paid_on: expected YYYY-MM-DD"})
		}
		in.PaidOn = &d
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	res, old, err := editLoanPayment(ctx, loanID, paymentID, in, req.Reason, dryRun, packetChoices{ReversePacket: req.ReversePacket, RestorePartial: req.RestorePartial, ActorEmployee: actorEmployeeID})
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		writeLedgerAudit(ctx, actorEmployeeID, "Ledger entry edited", loanID, loanNumberOf(ctx, loanID), req.Reason, old, res)
	}
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
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	reversePacket, _ := strconv.ParseBool(c.QueryParam("reverse_packet"))
	restorePartial, _ := strconv.ParseBool(c.QueryParam("restore_partial_release"))
	res, old, err := editLoanPayment(ctx, loanID, paymentID, nil, reason, dryRun, packetChoices{ReversePacket: reversePacket, RestorePartial: restorePartial, ActorEmployee: actorEmployeeID})
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		writeLedgerAudit(ctx, actorEmployeeID, "Ledger entry deleted", loanID, loanNumberOf(ctx, loanID), reason, old, res)
	}
	return common.Success(c, http.StatusOK, res)
}

func loanNumberOf(ctx context.Context, loanID uint) string {
	if l, err := findLoanByID(ctx, loanID); err == nil {
		return l.LoanNumber
	}
	return ""
}

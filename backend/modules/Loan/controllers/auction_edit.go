package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Editing an auction's entries. A sale is edited the way a payment is (see rebuild.go): the loan is replayed up to
// the sale so the balance before it is exact, the sale is applied again, the rows after it (a write-off) and the
// loan are replayed, and the sale's cash lines and expense entry are removed and booked again, all in one
// transaction. Entries that were booked because of the sale (a settled surplus, a shortfall decision, a write-off)
// are reported as `dependents`; the ones the user chooses to update (`apply_dependents`) are updated with it, and a
// change that would leave one of them disagreeing with the sale is refused (409) unless it is updated too.
// Whatever cannot be reproduced exactly is refused rather than rewritten.

// AuctionSaleCurrent is the sale as it is recorded now, with the payment split the buyer paid by.
type AuctionSaleCurrent struct {
	SaleAmount      float64   `json:"sale_amount"`
	AuctionExpenses float64   `json:"auction_expenses"`
	SaleDate        time.Time `json:"sale_date"`
	CashAmount      float64   `json:"cash_amount"`
	UpiAmount       float64   `json:"upi_amount"`
	BankTransfer    float64   `json:"bank_transfer_amount"`
	BankID          *uint     `json:"bank_id,omitempty"`
}

// AuctionEditResult is what an auction edit or undo returns (and what its preview returns).
type AuctionEditResult struct {
	Before     LoanSummary         `json:"before"`
	After      LoanSummary         `json:"after"`
	DryRun     bool                `json:"dry_run"`
	Dependents []AuctionDependent  `json:"dependents"`
	Current    *AuctionSaleCurrent `json:"current,omitempty"`
	Outcome    *saleOutcome        `json:"outcome,omitempty"`

	recID uint
	note  string
}

// AuctionSaleEdit holds the fields a sale edit may change; nil means "leave as is".
type AuctionSaleEdit struct {
	SaleAmount   *float64
	Expenses     *float64
	SaleDate     *time.Time
	CashAmount   *float64
	UpiAmount    *float64
	BankTransfer *float64
	BankID       *uint
}

type auctionState struct {
	l              *models.Loan
	rows           []models.LoanPayment
	originalStatus string
	rec            *models.AuctionRecord
	saleIdx, woIdx int
	dec            *models.AuctionDecisionRequest
}

func sameDay(a, b time.Time) bool { return a.Format("2006-01-02") == b.Format("2006-01-02") }

// loadAuctionState locks the loan and its sold auction case and finds the sale and write-off rows. The loan's earlier
// history is not replayed: an auction edit works from the loan's own figures.
func loadAuctionState(ctx context.Context, tx *gorm.DB, loanID uint) (*auctionState, error) {
	l, err := lockByID(ctx, tx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	all, rows, err := loadReplayRows(ctx, tx, loanID)
	if err != nil {
		return nil, err
	}
	if err := guardReplayable(ctx, tx, l, all); err != nil {
		return nil, err
	}
	st := &auctionState{l: l, rows: rows, originalStatus: l.Status, saleIdx: -1, woIdx: -1}
	for i := range rows {
		switch rows[i].Type {
		case models.PaymentTypeAuctionSale:
			if st.saleIdx >= 0 {
				return nil, common.NewConflict("this loan has more than one auction sale, so its auction cannot be edited safely")
			}
			st.saleIdx = i
		case models.PaymentTypeAuctionWriteOff:
			if st.woIdx >= 0 {
				return nil, common.NewConflict("this loan has more than one auction write-off, so its auction cannot be edited safely")
			}
			st.woIdx = i
		}
	}
	if st.saleIdx < 0 {
		return nil, common.NewNotFound("this loan has no auction sale in its ledger")
	}
	for i := st.saleIdx + 1; i < len(rows); i++ {
		if i != st.woIdx {
			return nil, common.NewConflict(fmt.Sprintf("a %s of Rs %.2f was recorded after the auction sale, so the sale cannot be edited safely; the entries after it must be changed first", rows[i].Type, rows[i].Amount))
		}
	}
	var recs []models.AuctionRecord
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("loan_id = ? AND sale_amount > 0", loanID).Order("id desc").Find(&recs).Error; err != nil {
		return nil, err
	}
	if len(recs) != 1 {
		return nil, common.NewConflict(fmt.Sprintf("this loan has %d auction cases with a sale, so its auction cannot be edited safely", len(recs)))
	}
	st.rec = &recs[0]
	var d models.AuctionDecisionRequest
	if err := tx.WithContext(ctx).Where("auction_record_id = ? AND kind = ?", st.rec.ID, decisionKindShortfall).Order("id desc").First(&d).Error; err == nil {
		st.dec = &d
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	return st, nil
}

// takeOffLoan takes what a saved row applied back off the loan's figures: the balance as it stood before that row.
func takeOffLoan(l *models.Loan, p models.LoanPayment) {
	l.OutstandingProcessingFee = common.RoundMoney(l.OutstandingProcessingFee + p.ProcessingFeeApplied)
	l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid - p.PenalInterestApplied)
	l.InterestPaid = common.RoundMoney(l.InterestPaid - p.InterestApplied)
	l.OutstandingAmount = common.RoundMoney(l.OutstandingAmount + p.PrincipalApplied)
}

// putOnLoan applies an allocation to the loan's figures, the way recording the row did.
func putOnLoan(l *models.Loan, fee, penal, interest, principal float64) {
	l.OutstandingProcessingFee = common.RoundMoney(math.Max(0, l.OutstandingProcessingFee-fee))
	l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + penal)
	l.InterestPaid = common.RoundMoney(l.InterestPaid + interest)
	l.OutstandingAmount = common.RoundMoney(math.Max(0, l.OutstandingAmount-principal))
}

// debtAt replays rows on a copy of l and returns the total owed on the given date.
func debtAt(ctx context.Context, tx *gorm.DB, l *models.Loan, rows []models.LoanPayment, at, createdAt time.Time, status string) (float64, error) {
	probe := *l
	rs := append([]models.LoanPayment{}, rows...)
	if err := replayLoan(ctx, tx, &probe, rs, status); err != nil {
		return 0, err
	}
	rctx := context.WithValue(ctx, replayTxKey{}, tx)
	if err := accrueThroughInTxAt(rctx, tx, &probe, at, createdAt); err != nil {
		return 0, err
	}
	return summarize(&probe).Total, nil
}

func (st *auctionState) snapshot() auctionSnapshot {
	s := auctionSnapshot{RecordID: st.rec.ID, SurplusDisposition: st.rec.SurplusDisposition, SurplusAmount: st.rec.SurplusPayableAmount}
	if st.dec != nil {
		s.Decision = &decisionSnap{ID: st.dec.ID, Status: st.dec.Status, AmountPaid: st.dec.AmountPaid, Outstanding: st.dec.OutstandingAtRequest}
	}
	if st.woIdx >= 0 {
		s.WriteOff = &writeOffSnap{ID: st.rows[st.woIdx].ID, Amount: st.rows[st.woIdx].Amount}
	}
	return s
}

// currentSale reads the sale's payment split back from the cash lines it booked, and only when they add up to
// exactly the recorded sale.
func currentSale(ctx context.Context, tx *gorm.DB, st *auctionState) (*AuctionSaleCurrent, string, error) {
	sale := st.rows[st.saleIdx]
	group := sale.CashTransactionGroupID
	if group == "" {
		return nil, "", common.NewConflict("this auction sale's cash entries cannot be identified, so it cannot be edited safely")
	}
	var lines []struct {
		Mode   string
		BankID *uint
		Total  float64
	}
	if err := tx.WithContext(ctx).Table("cash_movements").Select("mode, bank_id, SUM(amount) AS total").
		Where("transaction_group_id = ? AND type = ?", group, "in").Group("mode, bank_id").Scan(&lines).Error; err != nil {
		return nil, "", err
	}
	cur := &AuctionSaleCurrent{SaleAmount: st.rec.SaleAmount, AuctionExpenses: st.rec.AuctionExpenses, SaleDate: sale.PaidOn}
	var sum float64
	for _, ln := range lines {
		sum += ln.Total
		switch ln.Mode {
		case cashModels.CashModeCash:
			cur.CashAmount += ln.Total
		case cashModels.CashModeUPI:
			cur.UpiAmount += ln.Total
		case cashModels.CashModeBankTransfer:
			cur.BankTransfer += ln.Total
		default:
			return nil, "", common.NewConflict("this auction sale was received by a mode that cannot be edited safely")
		}
		if ln.BankID != nil {
			cur.BankID = ln.BankID
		}
	}
	if differs(sum, st.rec.SaleAmount) {
		return nil, "", common.NewConflict(fmt.Sprintf("this auction sale's cash entries (Rs %.2f) do not add up to the sale (Rs %.2f), so it cannot be edited safely", sum, st.rec.SaleAmount))
	}
	cur.CashAmount, cur.UpiAmount, cur.BankTransfer = common.RoundMoney(cur.CashAmount), common.RoundMoney(cur.UpiAmount), common.RoundMoney(cur.BankTransfer)
	return cur, group, nil
}

func chosenApplied(apply []AppliedDependent, dryRun bool) func(kind string) bool {
	return func(kind string) bool {
		if dryRun {
			return true
		}
		for _, a := range apply {
			if a.Kind == kind {
				return true
			}
		}
		return false
	}
}

// editAuctionSale edits (in != nil) or undoes (in == nil) the recorded sale.
func editAuctionSale(ctx context.Context, loanID uint, in *AuctionSaleEdit, apply []AppliedDependent, dryRun bool) (*AuctionEditResult, error) {
	res := &AuctionEditResult{DryRun: dryRun, Dependents: []AuctionDependent{}}
	undo := in == nil
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		st, err := loadAuctionState(ctx, tx, loanID)
		if err != nil {
			return err
		}
		l, rec := st.l, st.rec
		res.recID = rec.ID
		res.Before = summarize(l)
		sale := st.rows[st.saleIdx]
		cur, oldGroup, err := currentSale(ctx, tx, st)
		if err != nil {
			return err
		}
		res.Current = cur
		others := append([]models.LoanPayment{}, st.rows[:st.saleIdx]...)

		// the balance just before the sale: the loan as it is now with the sale (and a write-off after it) taken off,
		// so every payment the customer made is already in it
		before := *l
		if st.woIdx >= 0 {
			takeOffLoan(&before, st.rows[st.woIdx])
		}
		takeOffLoan(&before, sale)
		oldDebt := summarize(&before).Total
		after := before

		var out saleOutcome
		saleDate := sale.PaidOn
		var newSale models.LoanPayment
		var cash, upi, bank float64
		var bankID *uint
		newWriteOff := 0.0
		if !undo {
			saleAmount, expenses := rec.SaleAmount, rec.AuctionExpenses
			if in.SaleAmount != nil {
				saleAmount = common.RoundMoney(*in.SaleAmount)
			}
			if in.Expenses != nil {
				expenses = common.RoundMoney(*in.Expenses)
			}
			if saleAmount <= 0 {
				return common.NewBadRequest("amount must be greater than zero")
			}
			if expenses < 0 {
				return common.NewBadRequest("auction expenses cannot be negative")
			}
			if expenses > saleAmount {
				return common.NewBadRequest("auction expenses cannot be more than the sale amount")
			}
			if in.SaleDate != nil {
				saleDate = *in.SaleDate
				if !sameDay(saleDate, sale.PaidOn) {
					if len(others) > 0 {
						prev := others[len(others)-1].PaidOn
						if saleDate.Before(prev) && sameDay(saleDate, prev) {
							saleDate = prev
						}
						if saleDate.Before(prev) {
							return common.NewBadRequest("the sale date cannot be before the payment on " + prev.Format("2006-01-02"))
						}
					}
					if st.woIdx >= 0 {
						wo := st.rows[st.woIdx].PaidOn
						if saleDate.After(wo) && sameDay(saleDate, wo) {
							saleDate = wo
						}
						if saleDate.After(wo) {
							return common.NewBadRequest("the sale date cannot be after the write-off on " + wo.Format("2006-01-02"))
						}
					}
				} else {
					saleDate = sale.PaidOn
				}
			}
			if err := validatePaymentDateWindow(l, saleDate); err != nil {
				return err
			}
			cash, upi, bank, bankID = cur.CashAmount, cur.UpiAmount, cur.BankTransfer, cur.BankID
			if in.CashAmount != nil || in.UpiAmount != nil || in.BankTransfer != nil {
				cash, upi, bank = 0, 0, 0
				if in.CashAmount != nil {
					cash = *in.CashAmount
				}
				if in.UpiAmount != nil {
					upi = *in.UpiAmount
				}
				if in.BankTransfer != nil {
					bank = *in.BankTransfer
				}
				bankID = in.BankID
			} else if differs(saleAmount, rec.SaleAmount) {
				return common.NewBadRequest("the payment breakdown must be entered again when the sale amount changes")
			}
			cash, upi, bank, _, err = common.NormalizeSplit(cash, upi, bank, 0, saleAmount, bankID)
			if err != nil {
				return err
			}
				out = computeSaleOutcome(saleAmount, expenses, oldDebt)
			if out.Applied <= auctionMoneyTolerance {
				return common.NewBadRequest("the sale leaves nothing to apply to the loan on that date (the net proceeds or the amount owed is zero)")
			}
			pay := AuctionSalePayment{CashAmount: cash, UpiAmount: upi, BankTransferAmount: bank, BankID: bankID}
			ac, au, ab := pay.proRata(out.Applied, saleAmount)
			var abID *uint
			if au+ab > 0 {
				abID = bankID
			}
			newSale = sale
			newSale.Amount, newSale.PaidOn = out.Applied, saleDate
			newSale.CashAmount, newSale.UpiAmount, newSale.BankTransferAmount, newSale.BankID = ac, au, ab, abID
				newSale.Method = common.DeriveMethod(ac, au, ab, 0)
			newSale.Description = fmt.Sprintf("Auction proceeds applied (sale Rs %.2f less expenses Rs %.2f)", saleAmount, expenses)
			fee, penal, interest, principal, err := allocatePayment(&after, models.PaymentTypeAuctionSale, out.Applied, nil)
			if err != nil {
				return common.NewBadRequest(err.Error())
			}
			newSale.ProcessingFeeApplied, newSale.PenalInterestApplied, newSale.InterestApplied, newSale.PrincipalApplied = fee, penal, interest, principal
			putOnLoan(&after, fee, penal, interest, principal)
			newSale.RunningBalance = summarize(&after).Total
			if st.woIdx >= 0 && !out.Covered {
				newWriteOff = summarize(&after).Total
			}
		}

		snap := st.snapshot()
		res.Dependents = detectDependents(snap, out, newWriteOff, undo)
		if !dryRun {
			if missing := missingRequired(res.Dependents, apply); len(missing) > 0 {
				return common.NewConflict(missingMessage(missing))
			}
		}
		has := chosenApplied(apply, dryRun)
		depApplied := func(kind string) bool {
			for _, d := range res.Dependents {
				if d.Kind == kind {
					return has(kind)
				}
			}
			return false
		}

		// the rows after the change: the other payments, the new sale, and the write-off when it stays
		edited := append([]models.LoanPayment{}, others...)
		removeWriteOff := st.woIdx >= 0 && (undo || out.Covered)
		if !undo {
			edited = append(edited, newSale)
		}
		if st.woIdx >= 0 && !removeWriteOff {
			wo := st.rows[st.woIdx]
			if depApplied(DependentWriteOff) {
				wo.Amount = common.RoundMoney(newWriteOff)
			}
			edited = append(edited, wo)
		}

		// the case, its decision and the loan after the change
		var plan casePlan
		decStatus := ""
		if st.dec != nil {
			decStatus = st.dec.Status
		}
		settledDisp := rec.SurplusDisposition
		keepSettlement := settledDisp != "" && !undo && (!depApplied(DependentSurplusSettlement) || out.Surplus > auctionMoneyTolerance)
		if undo {
			plan = casePlan{Stage: models.AuctionStageScheduled, Final: auctionFinalPending, LoanStatus: models.StatusAuctionEligible}
		} else {
			if removeWriteOff {
				decStatus = ""
			}
			if out.Covered {
				decStatus = ""
			}
			shortfallChain, err := loanChain(ctx, common.FlowAuctionShortfall)
			if err != nil {
				return err
			}
			plan = planCase(out, decStatus, keepSettlement, settledDisp, shortfallChain.Off())
		}

		// a write-off that stays is applied on the balance the sale leaves
		if st.woIdx >= 0 && !removeWriteOff {
			wo := &edited[len(edited)-1]
			if depApplied(DependentWriteOff) {
				fee, penal, interest, principal, err := allocatePayment(&after, models.PaymentTypeAuctionWriteOff, wo.Amount, nil)
				if err != nil {
					return common.NewBadRequest(err.Error())
				}
				wo.ProcessingFeeApplied, wo.PenalInterestApplied, wo.InterestApplied, wo.PrincipalApplied = fee, penal, interest, principal
			}
			putOnLoan(&after, wo.ProcessingFeeApplied, wo.PenalInterestApplied, wo.InterestApplied, wo.PrincipalApplied)
		}
		l.OutstandingProcessingFee, l.PenalInterestPaid, l.InterestPaid, l.OutstandingAmount = after.OutstandingProcessingFee, after.PenalInterestPaid, after.InterestPaid, after.OutstandingAmount
		l.Status = plan.LoanStatus
		if undo {
			l.AuctionDate, l.AuctionAmount = nil, nil
		} else {
			d := saleDate
			amt := out.Sale
			l.AuctionDate, l.AuctionAmount = &d, &amt
			res.Outcome = &out
		}
		res.After = summarize(l)

		// ---- save ----
		for i := range edited {
			if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
				return err
			}
		}
		if undo {
			if err := tx.WithContext(ctx).Delete(&models.LoanPayment{}, sale.ID).Error; err != nil {
				return err
			}
		}
		if removeWriteOff {
			if err := tx.WithContext(ctx).Delete(&models.LoanPayment{}, st.rows[st.woIdx].ID).Error; err != nil {
				return err
			}
		}
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		txCtx := cashbook.WithTx(ctx, tx)

		// a settled surplus
		if settledDisp != "" && depApplied(DependentSurplusSettlement) {
			var oldMove *cashModels.CashMovement
			if rec.SurplusPaidOutMovementID != nil {
				if m, err := cashbook.GetMovement(txCtx, *rec.SurplusPaidOutMovementID); err == nil {
					oldMove = m
				}
				if err := cashbook.DeleteMovementLine(txCtx, *rec.SurplusPaidOutMovementID); err != nil {
					return err
				}
			}
			rec.SurplusPaidOutMovementID = nil
			if !undo && out.Surplus > auctionMoneyTolerance {
				if settledDisp == AuctionSurplusRefundedToCustomer {
					mode, when := "", time.Now()
					var mBank *uint
					if oldMove != nil {
						mode, when, mBank = oldMove.Mode, oldMove.OccurredOn, oldMove.BankID
					}
					id, err := cashbook.RecordAuctionSurplusCashOut(txCtx, loanID, l.LoanNumber, out.Surplus, l.BranchID, when, mode, mBank, l.CustomerID)
					if err != nil {
						return fmt.Errorf("could not record the corrected surplus refund in Cash-in-Hand: %w", err)
					}
					rec.SurplusPaidOutMovementID = &id
				}
			} else {
				rec.SurplusDisposition = ""
			}
		}

		// the sale's cash lines and expense entry
		if err := cashbook.DeleteLinesByGroup(txCtx, oldGroup); err != nil {
			return err
		}
		if rec.AuctionExpenses > auctionMoneyTolerance {
			if err := cashbook.DeleteAuctionExpense(txCtx, l.LoanNumber, rec.AuctionExpenses); err != nil {
				return err
			}
		}
		if !undo {
			p := edited[st.saleIdx]
			_, groupID, err := cashbook.RecordAuctionSaleCashIn(txCtx, loanID, l.LoanNumber, out.Sale, cash, upi, bank, bankID, l.BranchID, saleDate, p.ProcessingFeeApplied, p.PenalInterestApplied, p.InterestApplied, p.PrincipalApplied, l.CustomerID)
			if err != nil {
				return fmt.Errorf("could not record the corrected auction sale in Cash-in-Hand: %w", err)
			}
			if err := tx.WithContext(ctx).Model(&models.LoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error; err != nil {
				return err
			}
			if out.Expenses > auctionMoneyTolerance {
				mode, mBank := AuctionSalePayment{CashAmount: cash, UpiAmount: upi, BankTransferAmount: bank, BankID: bankID}.expenseMode()
				if _, err := cashbook.RecordAuctionExpense(txCtx, l.LoanNumber, out.Expenses, mode, mBank, l.BranchID, saleDate); err != nil {
					return fmt.Errorf("could not record the corrected auction expenses: %w", err)
				}
			}
		}

		// the case record
		if undo {
			rec.SaleAmount, rec.AuctionExpenses, rec.SurplusShortfall, rec.SurplusPayableAmount = 0, 0, 0, 0
			rec.SurplusDisposition, rec.SurplusPaidOutMovementID = "", nil
		} else {
			rec.SaleAmount, rec.AuctionExpenses, rec.SurplusShortfall, rec.SurplusPayableAmount = out.Sale, out.Expenses, out.Diff, out.Surplus
		}
		rec.Stage, rec.FinalSettlementStatus = plan.Stage, plan.Final
		if err := updateAuctionTx(ctx, tx, rec); err != nil {
			return err
		}

		// the shortfall decision
		switch {
		case st.dec != nil && (undo || out.Covered):
			if err := tx.WithContext(ctx).Delete(&models.AuctionDecisionRequest{}, st.dec.ID).Error; err != nil {
				return err
			}
		case st.dec != nil:
			if depApplied(DependentShortfallDecision) {
				st.dec.AmountPaid, st.dec.OutstandingAtRequest = out.Net, out.Shortfall
				if err := updateDecision(ctx, tx, st.dec); err != nil {
					return err
				}
			}
		case !undo && !out.Covered:
			nd := &models.AuctionDecisionRequest{AuctionRecordID: rec.ID, LoanID: loanID, Kind: decisionKindShortfall,
				AmountPaid: out.Net, OutstandingAtRequest: out.Shortfall, Status: plan.DecisionStatus}
			if plan.DecisionStatus == decisionStatusPursue {
				now := time.Now()
				nd.DecidedByRole, nd.DecisionRemarks, nd.DecidedAt = "System", "No approval configured - balance pursued automatically", &now
			}
			if err := createDecision(ctx, tx, nd); err != nil {
				return err
			}
		}
		if undo {
			res.note = "Sale undone: the auction is back at the scheduled stage"
		} else {
			res.note = fmt.Sprintf("Sale edited: Rs %.2f less expenses Rs %.2f, net Rs %.2f against Rs %.2f owed", out.Sale, out.Expenses, out.Net, out.Debt)
		}
		if dryRun {
			return errDryRun
		}
		return nil
	})
	if errors.Is(err, errDryRun) {
		return res, nil
	}
	if err != nil {
		return nil, err
	}
	return res, nil
}

// editAuctionWriteOff edits (in != nil: its date) or undoes (in == nil) the write-off of a shortfall.
func editAuctionWriteOff(ctx context.Context, loanID uint, newDate *time.Time, apply []AppliedDependent, dryRun bool) (*AuctionEditResult, error) {
	res := &AuctionEditResult{DryRun: dryRun, Dependents: []AuctionDependent{}}
	undo := newDate == nil
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		st, err := loadAuctionState(ctx, tx, loanID)
		if err != nil {
			return err
		}
		if st.woIdx < 0 {
			return common.NewNotFound("this loan has no auction write-off")
		}
		l, rec := st.l, st.rec
		res.recID = rec.ID
		res.Before = summarize(l)
		wo := st.rows[st.woIdx]
		before := append([]models.LoanPayment{}, st.rows[:st.woIdx]...)
		owed, err := debtAt(ctx, tx, l, before, wo.PaidOn, wo.CreatedAt, st.originalStatus)
		if err != nil {
			log.Printf("auction edit refused: history cannot be recalculated: %v", err)
			return common.NewConflict("This auction can't be edited: the loan's history can't be recalculated.")
		}
		if differs(owed, wo.Amount) {
			log.Printf("write-off edit refused: %.2f saved vs %.2f recalculated", wo.Amount, owed)
			return common.NewConflict("This write-off can't be edited: its figures don't recalculate exactly.")
		}
		if st.dec == nil || st.dec.Status != decisionStatusWriteOff {
			return common.NewConflict("this write-off has no recorded write-off decision, so it cannot be edited safely")
		}
		edited := before
		if undo {
			res.Dependents = []AuctionDependent{{Kind: DependentShortfallDecision, ID: st.dec.ID, Description: "Shortfall decision (WriteOff)",
				Current: "WriteOff", Suggested: "Back to Pending, so the shortfall can be decided again", Required: true}}
			if !dryRun {
				if missing := missingRequired(res.Dependents, apply); len(missing) > 0 {
					return common.NewConflict(missingMessage(missing))
				}
			}
		} else {
			d := *newDate
			if !sameDay(d, wo.PaidOn) {
				if sameDay(d, before[len(before)-1].PaidOn) && d.Before(before[len(before)-1].PaidOn) {
					d = before[len(before)-1].PaidOn
				}
				if d.Before(before[len(before)-1].PaidOn) {
					return common.NewBadRequest("the write-off date cannot be before the auction sale on " + before[len(before)-1].PaidOn.Format("2006-01-02"))
				}
			} else {
				d = wo.PaidOn
			}
			if err := validatePaymentDateWindow(l, d); err != nil {
				return err
			}
			nw, err := debtAt(ctx, tx, l, before, d, wo.CreatedAt, st.originalStatus)
			if err != nil {
				return common.NewBadRequest(err.Error())
			}
			wo.PaidOn, wo.Amount = d, nw
			edited = append(edited, wo)
		}
		if err := replayLoan(ctx, tx, l, edited, st.originalStatus); err != nil {
			return common.NewBadRequest(err.Error())
		}
		if undo {
			l.Status = models.StatusAuctionedBalanceDue
		} else {
			l.Status = models.StatusClosed
		}
		res.After = summarize(l)
		for i := range edited {
			if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
				return err
			}
		}
		if undo {
			if err := tx.WithContext(ctx).Delete(&models.LoanPayment{}, wo.ID).Error; err != nil {
				return err
			}
			rec.Stage, rec.FinalSettlementStatus = models.AuctionStageAuctioned, auctionFinalPending
			if err := updateAuctionTx(ctx, tx, rec); err != nil {
				return err
			}
			st.dec.Status, st.dec.DecidedByEmployeeID, st.dec.DecidedByRole, st.dec.DecisionRemarks, st.dec.DecidedAt = AuctionDecisionPending, nil, "", "", nil
			if err := updateDecision(ctx, tx, st.dec); err != nil {
				return err
			}
			res.note = "Write-off undone: the shortfall decision is pending again"
		} else {
			res.note = fmt.Sprintf("Write-off edited: Rs %.2f on %s", wo.Amount, wo.PaidOn.Format("02-Jan-2006"))
		}
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		if dryRun {
			return errDryRun
		}
		return nil
	})
	if errors.Is(err, errDryRun) {
		return res, nil
	}
	if err != nil {
		return nil, err
	}
	return res, nil
}

// AuctionSurplusEdit holds the fields an edit of the surplus settlement may change; nil means "leave as is".
type AuctionSurplusEdit struct {
	Disposition *string
	Mode        *string
	BankID      *uint
	SettledOn   *time.Time
}

// editAuctionSurplus edits (in != nil) or undoes (in == nil) the settlement of an auction's surplus. The loan's
// figures are not touched, so nothing depends on it.
func editAuctionSurplus(ctx context.Context, loanID uint, in *AuctionSurplusEdit, dryRun bool) (*AuctionEditResult, error) {
	res := &AuctionEditResult{DryRun: dryRun, Dependents: []AuctionDependent{}}
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID)
		if err != nil {
			return common.NewNotFound("loan not found")
		}
		var recs []models.AuctionRecord
		if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("loan_id = ? AND sale_amount > 0", loanID).Order("id desc").Find(&recs).Error; err != nil {
			return err
		}
		if len(recs) != 1 {
			return common.NewConflict(fmt.Sprintf("this loan has %d auction cases with a sale, so its surplus cannot be edited safely", len(recs)))
		}
		rec := &recs[0]
		res.recID = rec.ID
		res.Before = summarize(l)
		res.After = res.Before
		if rec.SurplusDisposition == "" {
			return common.NewNotFound("this auction's surplus has not been settled")
		}
		txCtx := cashbook.WithTx(ctx, tx)
		var oldMove *cashModels.CashMovement
		if rec.SurplusPaidOutMovementID != nil {
			m, err := cashbook.GetMovement(txCtx, *rec.SurplusPaidOutMovementID)
			if err != nil {
				return common.NewConflict("this surplus refund's cash entry cannot be found, so it cannot be edited safely")
			}
			if differs(m.Amount, rec.SurplusPayableAmount) {
				return common.NewConflict(fmt.Sprintf("this surplus refund's cash entry (Rs %.2f) does not match the surplus (Rs %.2f), so it cannot be edited safely", m.Amount, rec.SurplusPayableAmount))
			}
			oldMove = m
			if err := cashbook.DeleteMovementLine(txCtx, m.ID); err != nil {
				return err
			}
		}
		rec.SurplusPaidOutMovementID = nil
		if in == nil {
			rec.SurplusDisposition, rec.Stage, rec.FinalSettlementStatus = "", models.AuctionStageAuctioned, auctionFinalPending
			res.note = "Surplus settlement undone"
		} else {
			disp := rec.SurplusDisposition
			if in.Disposition != nil {
				disp = *in.Disposition
			}
			switch disp {
			case AuctionSurplusRefundedToCustomer, "RecordedAsIncome":
			default:
				return common.NewBadRequest("surplus disposition must be either \"RefundedToCustomer\" or \"RecordedAsIncome\"")
			}
			rec.SurplusDisposition = disp
			if disp == AuctionSurplusRefundedToCustomer {
				mode, when, bankID := "", time.Now(), (*uint)(nil)
				if oldMove != nil {
					mode, when, bankID = oldMove.Mode, oldMove.OccurredOn, oldMove.BankID
				}
				if in.Mode != nil {
					mode, bankID = *in.Mode, in.BankID
				}
				if in.SettledOn != nil {
					when = *in.SettledOn
				}
				if mode != "" && mode != cashModels.CashModeCash && bankID == nil {
					return common.NewBadRequest("bank is required when the refund is paid by UPI or Bank Transfer")
				}
				id, err := cashbook.RecordAuctionSurplusCashOut(txCtx, loanID, l.LoanNumber, rec.SurplusPayableAmount, l.BranchID, when, mode, bankID, l.CustomerID)
				if err != nil {
					return fmt.Errorf("could not record the corrected surplus refund in Cash-in-Hand: %w", err)
				}
				rec.SurplusPaidOutMovementID = &id
				rec.FinalSettlementStatus = auctionFinalToCustomer
			} else {
				rec.FinalSettlementStatus = auctionFinalToLoanCo
			}
			res.note = "Surplus settlement edited: " + disp
		}
		if err := updateAuctionTx(ctx, tx, rec); err != nil {
			return err
		}
		if dryRun {
			return errDryRun
		}
		return nil
	})
	if errors.Is(err, errDryRun) {
		return res, nil
	}
	if err != nil {
		return nil, err
	}
	return res, nil
}

// ---- handlers ----

type auctionSaleEditRequest struct {
	SaleAmount      *float64           `json:"sale_amount"`
	AuctionExpenses *float64           `json:"auction_expenses"`
	SaleDate        *string            `json:"sale_date"`
	CashAmount      *float64           `json:"cash_amount"`
	UpiAmount       *float64           `json:"upi_amount"`
	BankTransferAmt *float64           `json:"bank_transfer_amount"`
	BankID          *uint              `json:"bank_id"`
	ApplyDependents []AppliedDependent `json:"apply_dependents"`
	Reason          string             `json:"reason"`
}

type auctionApplyBody struct {
	ApplyDependents []AppliedDependent `json:"apply_dependents"`
	SettledOn       *string            `json:"settled_on"`
	PaidOn          *string            `json:"paid_on"`
	Disposition     *string            `json:"disposition"`
	Mode            *string            `json:"mode"`
	BankID          *uint              `json:"bank_id"`
}

func auctionEditPrologue(c echo.Context, permission string, flow string) (context.Context, uint, bool, error) {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return ctx, 0, false, err
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return ctx, 0, false, err
	}
	_, _, roleID := auth.ActorFromContext(c)
	switch {
	case permission != "":
		if !checkStagePermission(ctx, roleID, permission) {
			return ctx, 0, false, common.NewPermissionDenied("your role does not have permission to change this auction step", permission)
		}
	case flow != "":
		if !canDecideAuction(ctx, roleID, flow) {
			return ctx, 0, false, common.NewForbidden("only a role that may decide a post-auction shortfall may change its write-off")
		}
	}
	dry, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	return ctx, loanID, dry, nil
}

func finishAuctionEdit(c echo.Context, ctx context.Context, loanID uint, action string, res *AuctionEditResult, dry bool, reason string) error {
	if !dry {
		actorID, actorRole, _ := auth.ActorFromContext(c)
		var aid *uint
		if actorID != 0 {
			aid = &actorID
		}
		if res.recID != 0 {
			note := res.note
			if len(note) > 250 {
				note = note[:250]
			}
			recordAuctionEvent(ctx, nil, res.recID, "Edited", aid, actorRole, note)
		}
		actorName := "unknown"
		if actor, err := common.FindEmployeeByID(ctx, actorID); err == nil {
			actorName = actor.Name
		}
		detail := fmt.Sprintf("reason: %s | %s | loan before: %+v | loan after: %+v", reason, res.note, res.Before, res.After)
		_ = common.InsertAuditLog(ctx, &commonModels.Entry{
			ActorEmployeeID: actorID, ActorName: actorName, Action: action,
			EntityType: "loan", EntityID: loanID, EntityName: loanNumberOf(ctx, loanID), Detail: detail,
		})
	}
	return common.Success(c, http.StatusOK, res)
}

// GetAuctionSaleCurrent is GET /loans/:id/auction/sale: the recorded sale with its payment split, to prefill an edit.
func GetAuctionSaleCurrent(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	var cur *AuctionSaleCurrent
	err = config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		st, err := loadAuctionState(ctx, tx, loanID)
		if err != nil {
			return err
		}
		cur, _, err = currentSale(ctx, tx, st)
		if err != nil {
			return err
		}
		return errDryRun
	})
	if err != nil && !errors.Is(err, errDryRun) {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, cur)
}

// EditAuctionSale is PATCH /loans/:id/auction/sale[?dry_run=true].
func EditAuctionSale(c echo.Context) error {
	ctx, loanID, dry, err := auctionEditPrologue(c, "can record auction sale", "")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req auctionSaleEditRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := &AuctionSaleEdit{SaleAmount: req.SaleAmount, Expenses: req.AuctionExpenses, CashAmount: req.CashAmount, UpiAmount: req.UpiAmount, BankTransfer: req.BankTransferAmt, BankID: req.BankID}
	if req.SaleDate != nil {
		d, err := parsePaidOn(*req.SaleDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid sale_date: expected YYYY-MM-DD"})
		}
		in.SaleDate = &d
	}
	res, err := editAuctionSale(ctx, loanID, in, req.ApplyDependents, dry)
	if err != nil {
		return common.FailErr(c, err)
	}
	return finishAuctionEdit(c, ctx, loanID, "Auction sale edited", res, dry, req.Reason)
}

// DeleteAuctionSale is DELETE /loans/:id/auction/sale[?dry_run=true]; apply_dependents goes in the JSON body.
func DeleteAuctionSale(c echo.Context) error {
	ctx, loanID, dry, err := auctionEditPrologue(c, "can record auction sale", "")
	if err != nil {
		return common.FailErr(c, err)
	}
	var body auctionApplyBody
	_ = common.BindJSON(c, &body)
	res, err := editAuctionSale(ctx, loanID, nil, body.ApplyDependents, dry)
	if err != nil {
		return common.FailErr(c, err)
	}
	return finishAuctionEdit(c, ctx, loanID, "Auction sale deleted", res, dry, c.QueryParam("reason"))
}

// EditAuctionWriteOff is PATCH /loans/:id/auction/write-off[?dry_run=true]; body {paid_on}.
func EditAuctionWriteOff(c echo.Context) error {
	ctx, loanID, dry, err := auctionEditPrologue(c, "", common.FlowAuctionShortfall)
	if err != nil {
		return common.FailErr(c, err)
	}
	var body auctionApplyBody
	if err := common.BindJSON(c, &body); err != nil || body.PaidOn == nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "paid_on is required (YYYY-MM-DD)"})
	}
	d, err := parsePaidOn(*body.PaidOn)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid paid_on: expected YYYY-MM-DD"})
	}
	res, err := editAuctionWriteOff(ctx, loanID, &d, body.ApplyDependents, dry)
	if err != nil {
		return common.FailErr(c, err)
	}
	return finishAuctionEdit(c, ctx, loanID, "Auction write-off edited", res, dry, "")
}

// DeleteAuctionWriteOff is DELETE /loans/:id/auction/write-off[?dry_run=true]; apply_dependents goes in the body.
func DeleteAuctionWriteOff(c echo.Context) error {
	ctx, loanID, dry, err := auctionEditPrologue(c, "", common.FlowAuctionShortfall)
	if err != nil {
		return common.FailErr(c, err)
	}
	var body auctionApplyBody
	_ = common.BindJSON(c, &body)
	res, err := editAuctionWriteOff(ctx, loanID, nil, body.ApplyDependents, dry)
	if err != nil {
		return common.FailErr(c, err)
	}
	return finishAuctionEdit(c, ctx, loanID, "Auction write-off deleted", res, dry, c.QueryParam("reason"))
}

// EditAuctionSurplus is PATCH /loans/:id/auction/surplus[?dry_run=true].
func EditAuctionSurplus(c echo.Context) error {
	ctx, loanID, dry, err := auctionEditPrologue(c, "can settle auction", "")
	if err != nil {
		return common.FailErr(c, err)
	}
	var body auctionApplyBody
	if err := common.BindJSON(c, &body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := &AuctionSurplusEdit{Disposition: body.Disposition, Mode: body.Mode, BankID: body.BankID}
	if body.SettledOn != nil && strings.TrimSpace(*body.SettledOn) != "" {
		d, err := parsePaidOn(*body.SettledOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid settled_on: expected YYYY-MM-DD"})
		}
		in.SettledOn = &d
	}
	res, err := editAuctionSurplus(ctx, loanID, in, dry)
	if err != nil {
		return common.FailErr(c, err)
	}
	return finishAuctionEdit(c, ctx, loanID, "Auction surplus edited", res, dry, "")
}

// DeleteAuctionSurplus is DELETE /loans/:id/auction/surplus[?dry_run=true].
func DeleteAuctionSurplus(c echo.Context) error {
	ctx, loanID, dry, err := auctionEditPrologue(c, "can settle auction", "")
	if err != nil {
		return common.FailErr(c, err)
	}
	res, err := editAuctionSurplus(ctx, loanID, nil, dry)
	if err != nil {
		return common.FailErr(c, err)
	}
	return finishAuctionEdit(c, ctx, loanID, "Auction surplus settlement deleted", res, dry, c.QueryParam("reason"))
}

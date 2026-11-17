package controllers

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Investment/models"

	"gorm.io/gorm"
)

// Fixed-payout (scheduled) investments: what is owed at a given moment, closing early, and partial withdrawal.
//
// A scheduled investment pays interest on a fixed calendar (its payout rows) and gives the principal back through
// principal-return rows. Principal taken out before the end is recorded as a paid principal-return row, so
// "principal still held" is always PrincipalAmount minus the principal-return rows already paid.
//
// Interest owed at a moment:
//   - payouts due today or earlier that are still pending are owed in full;
//   - the period now running has earned a share of its payout, elapsed days over the period's days;
//   - payouts after that are not earned yet.

// schedSettlement is what a scheduled investment owes at one moment.
type schedSettlement struct {
	Returned         float64                   // principal already paid back
	PrincipalHeld    float64                   // principal still with the business
	Due              []models.InvestmentPayout // interest payouts due by now and not yet paid
	Future           []models.InvestmentPayout // interest payouts after now; Future[0] is the period now running
	Fraction         float64                   // share of the running period already elapsed (0..1)
	Accrued          float64                   // interest earned in the running period so far
	PendingPrincipal []models.InvestmentPayout // queued principal returns (a closed-at-maturity investment)
}

func (s *schedSettlement) dueTotal() float64 {
	var t float64
	for _, r := range s.Due {
		t = common.RoundMoney(t + r.Amount)
	}
	return t
}

func (s *schedSettlement) pendingPrincipalTotal() float64 {
	var t float64
	for _, r := range s.PendingPrincipal {
		t = common.RoundMoney(t + r.Amount)
	}
	return t
}

// interest is everything owed as interest right now: payouts due plus the share earned in the running period.
func (s *schedSettlement) interest() float64 {
	return common.RoundMoney(s.dueTotal() + s.Accrued)
}

func endOfDay(t time.Time) time.Time {
	y, m, d := t.In(time.Local).Date()
	return time.Date(y, m, d, 23, 59, 59, 0, time.Local)
}

func loadSchedSettlement(ctx context.Context, db config.Conn, inv *models.Investment, now time.Time) (*schedSettlement, error) {
	out := &schedSettlement{}
	if err := db.WithContext(ctx).Model(&models.InvestmentPayout{}).
		Where("investment_id = ? AND status = ? AND is_principal_return = ?", inv.ID, "Paid", true).
		Select("COALESCE(SUM(amount), 0)").Scan(&out.Returned).Error; err != nil {
		return nil, err
	}
	out.Returned = common.RoundMoney(out.Returned)
	out.PrincipalHeld = math.Max(0, common.RoundMoney(inv.PrincipalAmount-out.Returned))
	var pending []models.InvestmentPayout
	if err := db.WithContext(ctx).Where("investment_id = ? AND status = ?", inv.ID, "Pending").Order("sequence_no asc").Find(&pending).Error; err != nil {
		return nil, err
	}
	cutoff := endOfDay(now)
	for _, r := range pending {
		switch {
		case r.IsPrincipalReturn:
			out.PendingPrincipal = append(out.PendingPrincipal, r)
		case !r.DueDate.After(cutoff):
			out.Due = append(out.Due, r)
		default:
			out.Future = append(out.Future, r)
		}
	}
	if len(out.Future) > 0 {
		run := out.Future[0]
		// the running period started on the due date of the interest payout before it (or on the start date)
		periodStart := inv.StartDate
		var prev models.InvestmentPayout
		err := db.WithContext(ctx).Where("investment_id = ? AND is_principal_return = ? AND sequence_no < ?", inv.ID, false, run.SequenceNo).
			Order("sequence_no desc").Limit(1).Take(&prev).Error
		if err == nil {
			periodStart = prev.DueDate
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		total := run.DueDate.Sub(periodStart).Hours() / 24
		elapsed := now.Sub(periodStart).Hours() / 24
		if total > 0 && elapsed > 0 {
			out.Fraction = math.Min(1, elapsed/total)
		}
		out.Accrued = common.RoundMoney(run.Amount * out.Fraction)
	}
	return out, nil
}

// fillSchedSettlement sets the figures the screens show for a scheduled investment.
func fillSchedSettlement(ctx context.Context, inv *models.Investment) {
	if inv.Engine == models.EngineLive {
		return
	}
	s, err := loadSchedSettlement(ctx, investmentDB(), inv, time.Now())
	if err != nil {
		return
	}
	inv.PrincipalReturned = s.Returned
	inv.SettlementInterest = s.interest()
}

// scheduledSplit hands out one payment breakdown across several payouts, in order, mode by mode.
type scheduledSplit struct{ rem [3]float64 }

func (s *scheduledSplit) take(amount float64) [3]float64 {
	var got [3]float64
	for i := range s.rem {
		t := math.Min(amount, s.rem[i])
		got[i] = common.RoundMoney(t)
		s.rem[i] = common.RoundMoney(s.rem[i] - t)
		amount = common.RoundMoney(amount - t)
	}
	return got
}

// bookScheduledPayouts saves each paid payout's cash lines with it, so a paid payout never exists without its money.
func bookScheduledPayouts(ctx context.Context, tx *gorm.DB, inv *models.Investment, paying []*models.InvestmentPayout, bankID *uint, closing bool) error {
	for _, p := range paying {
		payoutType := "Interest payout"
		if p.IsPrincipalReturn {
			payoutType = "Principal return"
			if !closing {
				payoutType = "Principal withdrawal"
			}
		}
		movementID, _, err := cashbook.RecordInvestmentPayoutCashOut(cashbook.WithTx(ctx, tx), inv.ID, inv.InvestmentNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, inv.BranchID, *p.PaidAt, payoutType, inv.CustomerID, nonCashBankID(bankID, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount))
		if err != nil {
			return fmt.Errorf("could not record the %s in Cash-in-Hand, nothing saved: %w", payoutType, err)
		}
		p.CashMovementID = &movementID
		if err := updatePayout(ctx, tx, p); err != nil {
			return err
		}
	}
	return nil
}

func nextPayoutSequence(ctx context.Context, investmentID uint) (int, error) {
	existing, err := findPayouts(ctx, investmentID, 1000, 0)
	if err != nil {
		return 0, err
	}
	if len(existing) == 0 {
		return 1, nil
	}
	return existing[len(existing)-1].SequenceNo + 1, nil
}

// closeScheduledInvestment closes a fixed-payout investment in one step, before or after its maturity date. It pays,
// from the one payment breakdown: the interest payouts already due, the interest earned so far in the running period,
// and the principal still held. Payouts that are not earned yet are cancelled. The breakdown has to add up to all of
// it; if nothing is owed it just closes.
func closeScheduledInvestment(ctx context.Context, investmentID uint, branchID *uint, pay *MarkPayoutPaidInput, employeeID uint) (*models.Investment, error) {
	var closed *models.Investment
	err := investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		if locked.Engine == models.EngineLive {
			return common.NewBadRequest("this action is only for fixed-payout investments")
		}
		if locked.Status != models.StatusActive && locked.Status != models.StatusMatured {
			return common.NewConflict("only an active or matured investment can be closed")
		}
		now := time.Now()
		s, err := loadSchedSettlement(ctx, tx, locked, now)
		if err != nil {
			return err
		}
		extraPrincipal := math.Max(0, common.RoundMoney(s.PrincipalHeld-s.pendingPrincipalTotal()))
		total := common.RoundMoney(s.interest() + s.pendingPrincipalTotal() + extraPrincipal)
		if total > epsilon {
			cash, upi, bank, _, err := common.NormalizeSplit(pay.CashAmount, pay.UpiAmount, pay.BankTransferAmount, pay.ChequeAmount, total, pay.BankID)
			if err != nil {
				return err
			}
			if !config.IsDemoRun(ctx) {
				if err := cashbook.EnsurePayoutFunds(ctx, locked.BranchID, cash, pay.BankID, upi+bank); err != nil {
					return err
				}
			}
			split := &scheduledSplit{rem: [3]float64{cash, upi, bank}}
			var paying []*models.InvestmentPayout
			markPaid := func(r *models.InvestmentPayout) error {
				got := split.take(r.Amount)
				r.Status, r.PaidAt, r.PaidByEmployeeID = "Paid", &now, &employeeID
				r.CashAmount, r.UpiAmount, r.BankTransferAmount = got[0], got[1], got[2]
				if err := updatePayout(ctx, tx, r); err != nil {
					return err
				}
				paying = append(paying, r)
				return nil
			}
			for i := range s.Due {
				if err := markPaid(&s.Due[i]); err != nil {
					return err
				}
			}
			for i := range s.PendingPrincipal {
				if err := markPaid(&s.PendingPrincipal[i]); err != nil {
					return err
				}
			}
			// the running period: its payout is cut down to what has been earned so far and paid now
			if len(s.Future) > 0 && s.Accrued > epsilon {
				run := &s.Future[0]
				run.Amount, run.DueDate = s.Accrued, now
				if err := markPaid(run); err != nil {
					return err
				}
			}
			if extraPrincipal > epsilon {
				seq, err := nextPayoutSequence(ctx, investmentID)
				if err != nil {
					return err
				}
				got := split.take(extraPrincipal)
				final := models.InvestmentPayout{
					InvestmentID: locked.ID, SequenceNo: seq, DueDate: now, Amount: extraPrincipal,
					IsPrincipalReturn: true, Status: "Paid", PaidAt: &now, PaidByEmployeeID: &employeeID,
					CashAmount: got[0], UpiAmount: got[1], BankTransferAmount: got[2],
				}
				final.TenantID = locked.TenantID
				if err := appendPayout(ctx, tx, &final); err != nil {
					return err
				}
				paying = append(paying, &final)
			}
			if err := bookScheduledPayouts(ctx, tx, locked, paying, pay.BankID, true); err != nil {
				return err
			}
			locked.TotalInterestPaid = common.RoundMoney(locked.TotalInterestPaid + s.interest())
		}
		// payouts not earned yet are cancelled (the running period's was kept above if anything was earned)
		for i := range s.Future {
			if i == 0 && s.Accrued > epsilon {
				continue
			}
			if err := tx.WithContext(ctx).Delete(&models.InvestmentPayout{}, s.Future[i].ID).Error; err != nil {
				return err
			}
		}
		locked.OutstandingPrincipal = 0
		locked.Status = "Closed"
		locked.ClosedAt = &now
		if err := persistInvestment(ctx, tx, locked); err != nil {
			return err
		}
		closed = locked
		return nil
	})
	if err != nil {
		return nil, err
	}
	return closed, nil
}

// withdrawScheduled takes principal out of a fixed-payout investment at any time. Taking all of it closes the
// investment (see closeScheduledInvestment, which also settles the interest). Taking part pays that amount out now
// and leaves the schedule's dates alone: interest already due stays as it is, the share of the running period still
// to come and every later payout are reduced in proportion to the principal left, so the same rate keeps applying to
// what remains.
func withdrawScheduled(ctx context.Context, investmentID uint, branchID *uint, in WithdrawInput) (*models.Investment, error) {
	if in.InterestAmount != 0 {
		return nil, common.NewBadRequest("interest on a fixed-payout investment is paid from its schedule — withdraw principal here")
	}
	amount := common.RoundMoney(in.PrincipalAmount)
	if amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	if inv.Status != models.StatusActive {
		return nil, common.NewConflict("only an active investment can have money withdrawn")
	}
	s, err := loadSchedSettlement(ctx, investmentDB(), inv, time.Now())
	if err != nil {
		return nil, err
	}
	if amount > s.PrincipalHeld+epsilon {
		return nil, common.NewConflict("withdrawal exceeds the principal held")
	}
	if amount >= s.PrincipalHeld-epsilon {
		return closeScheduledInvestment(ctx, investmentID, branchID, &MarkPayoutPaidInput{
			CashAmount: in.CashAmount, UpiAmount: in.UpiAmount, BankTransferAmount: in.BankTransferAmount, ChequeAmount: in.ChequeAmount, BankID: in.BankID,
		}, in.RecordedByEmployeeID)
	}
	cash, upi, bank, cheque, err := common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, amount, in.BankID)
	if err != nil {
		return nil, err
	}
	var invID uint
	err = investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		if locked.Engine == models.EngineLive || locked.Status != models.StatusActive {
			return common.NewConflict("only an active fixed-payout investment can have money withdrawn")
		}
		now := time.Now()
		cur, err := loadSchedSettlement(ctx, tx, locked, now)
		if err != nil {
			return err
		}
		if amount > cur.PrincipalHeld+epsilon {
			return common.NewConflict("withdrawal exceeds the principal held")
		}
		if !config.IsDemoRun(ctx) {
			if err := cashbook.EnsurePayoutFunds(ctx, locked.BranchID, cash, in.BankID, upi+bank); err != nil {
				return err
			}
		}
		ratio := common.RoundMoney(cur.PrincipalHeld-amount) / cur.PrincipalHeld
		for i := range cur.Future {
			r := &cur.Future[i]
			factor := ratio
			if i == 0 {
				// the part of the running period already earned stays at the old principal
				factor = cur.Fraction + ratio*(1-cur.Fraction)
			}
			r.Amount = common.RoundMoney(r.Amount * factor)
			if err := updatePayout(ctx, tx, r); err != nil {
				return err
			}
		}
		seq, err := nextPayoutSequence(ctx, investmentID)
		if err != nil {
			return err
		}
		employeeID := in.RecordedByEmployeeID
		out := models.InvestmentPayout{
			InvestmentID: locked.ID, SequenceNo: seq, DueDate: now, Amount: amount,
			IsPrincipalReturn: true, Status: "Paid", PaidAt: &now, PaidByEmployeeID: &employeeID,
			CashAmount: cash, UpiAmount: upi, BankTransferAmount: bank, ChequeAmount: cheque,
		}
		out.TenantID = locked.TenantID
		if err := appendPayout(ctx, tx, &out); err != nil {
			return err
		}
		if err := bookScheduledPayouts(ctx, tx, locked, []*models.InvestmentPayout{&out}, in.BankID, false); err != nil {
			return err
		}
		invID = locked.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return getInvestment(ctx, invID, branchID)
}

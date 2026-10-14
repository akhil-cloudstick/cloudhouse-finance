package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
)

type Summary struct {
	OpeningCash            float64          `json:"opening_cash"`
	OpeningCashSet         bool             `json:"opening_cash_set"`
	Collections            float64          `json:"collections"`
	Disbursements          float64          `json:"disbursements"`
	CashExpenses           float64          `json:"cash_expenses"`
	ExpensesToday          float64          `json:"expenses_today"`
	ExpectedCash           float64          `json:"expected_cash"`
	BankBalance            float64          `json:"bank_balance"`
	CashInHand             float64          `json:"cash_in_hand"`
	CollectionsBreakdown   CashInBreakdown  `json:"collections_breakdown"`
	DisbursementsBreakdown CashOutBreakdown `json:"disbursements_breakdown"`
}

func cashInHand(ctx context.Context, branchID uint) (float64, error) {
	cash, _, err := liveBalances(ctx, &branchID)
	return cash, err
}

// LiveBalance is cash in hand plus bank balance as of now — the figure the Cash
// page's Balance in Hand shows, so the dashboard can report the same number.
func LiveBalance(ctx context.Context, branchID *uint) (float64, error) {
	cash, bank, err := liveBalances(ctx, branchID)
	return cash + bank, err
}

// bankBalance is what the Banks page shows for one bank right now.
func bankBalance(ctx context.Context, bankID uint) (float64, error) {
	per, _, err := BankBalances(ctx, nil)
	if err != nil {
		return 0, err
	}
	return per[bankID], nil
}

func EnsureCashInHand(ctx context.Context, branchID uint, amount float64) error {
	if amount <= 0 {
		return nil
	}
	available, err := cashInHand(ctx, branchID)
	if err != nil {
		return err
	}
	if amount > available+0.005 {
		return ErrInsufficientCashInHand(available, amount)
	}
	return nil
}

// EnsureBankBalance refuses a UPI / Bank Transfer payout the chosen bank cannot cover.
func EnsureBankBalance(ctx context.Context, bankID uint, amount float64) error {
	if amount <= 0 || bankID == 0 {
		return nil
	}
	available, err := bankBalance(ctx, bankID)
	if err != nil {
		return err
	}
	if amount > available+0.005 {
		return ErrInsufficientBankBalance(available, amount)
	}
	return nil
}

// EnsurePayoutFunds checks a payout split the way the money actually moves: the Cash part against cash in
// hand, the UPI / Bank Transfer part against the bank it leaves from. Cash in hand never blocks a bank
// payout, and a bank balance never blocks a cash one.
func EnsurePayoutFunds(ctx context.Context, branchID uint, cash float64, bankID *uint, bankAmount float64) error {
	if err := EnsureCashInHand(ctx, branchID, cash); err != nil {
		return err
	}
	if bankID == nil {
		return nil
	}
	return EnsureBankBalance(ctx, *bankID, bankAmount)
}

func getExpectedCash(ctx context.Context, branchID *uint, date time.Time) (Summary, error) {
	if date.IsZero() {
		date = time.Now()
	}
	opening, err := openingFor(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	openingSet := true
	in, out, err := sumByTypeAndDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	inBreakdown, outBreakdown, err := sumBreakdownByDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	cashExpenses, err := sumCashByDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	expensesToday, err := sumAllByDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	cashInHand, bankBalance, err := liveBalances(ctx, branchID)
	if err != nil {
		return Summary{}, err
	}
	day := startOfDay(date)
	var heldExpenses float64
	for _, sc := range []BalanceScope{{Bank: false}, {Bank: true}} {
		sc.BranchID, sc.From, sc.To = branchID, day, day.AddDate(0, 0, 1)
		e, err := sumByScope(ctx, sc)
		if err != nil {
			return Summary{}, err
		}
		heldExpenses += e
	}
	return Summary{
		BankBalance:            bankBalance,
		CashInHand:             cashInHand,
		OpeningCash:            opening,
		OpeningCashSet:         openingSet,
		Collections:            in,
		Disbursements:          out,
		CashExpenses:           cashExpenses,
		ExpensesToday:          expensesToday,
		ExpectedCash:           opening + in - out - heldExpenses,
		CollectionsBreakdown:   inBreakdown,
		DisbursementsBreakdown: outBreakdown,
	}, nil
}

func liveBalances(ctx context.Context, branchID *uint) (cashInHand, bankBalance float64, err error) {
	return balancesBefore(ctx, branchID, startOfDay(time.Now()).AddDate(0, 0, 1))
}

func BankBalances(ctx context.Context, branchID *uint) (map[uint]float64, float64, error) {
	to := startOfDay(time.Now()).AddDate(0, 0, 1)
	net, err := netByBank(ctx, to)
	if err != nil {
		return nil, 0, err
	}
	spent, err := sumByBank(ctx, to)
	if err != nil {
		return nil, 0, err
	}
	for id, amt := range spent {
		net[id] -= amt
	}
	_, bankBalance, err := balancesBefore(ctx, branchID, to)
	if err != nil {
		return nil, 0, err
	}
	return net, bankBalance, nil
}

func balancesBefore(ctx context.Context, branchID *uint, to time.Time) (cashInHand, bankBalance float64, err error) {
	net := func(sc BalanceScope) (float64, error) {
		sc.BranchID, sc.To = branchID, to
		m, err := netByScope(ctx, sc)
		if err != nil {
			return 0, err
		}
		e, err := sumByScope(ctx, sc)
		if err != nil {
			return 0, err
		}
		return m - e, nil
	}
	if cashInHand, err = net(BalanceScope{}); err != nil {
		return 0, 0, err
	}
	if bankBalance, err = net(BalanceScope{Bank: true}); err != nil {
		return 0, 0, err
	}
	return cashInHand, bankBalance, nil
}

func GetCashSummary(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var branchID *uint
	if branchIDStr := c.QueryParam("branch_id"); branchIDStr != "" {
		v, err := strconv.ParseUint(branchIDStr, 10, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid branch_id"})
		}
		id := uint(v)
		branchID = &id
	}
	branchID, ok := auth.NarrowBranch(c, branchID)
	if !ok {
		return common.FailErr(c, common.NewForbidden("that branch is outside your current branch selection"))
	}
	date, err := parseQueryDate(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid date: expected YYYY-MM-DD"})
	}
	summary, err := getExpectedCash(ctx, branchID, date)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, summary)
}

// ensureBankCanPay stops a UPI / Bank Transfer cash-out from taking the bank it leaves from below zero. It
// guards every line written through insertMovement, so a payout, release, refund, self transfer or debit
// can't be missed by a flow that forgot to check. Lines whose flow already checks the payout itself
// (loan disbursement, investment — they carry a source type) and expense lines (counted through their own
// expense record, see ensureExpenseBank) are left to those checks.
func ensureBankCanPay(ctx context.Context, m *models.CashMovement) error {
	if m.Type != "out" || m.BankID == nil || m.SourceType != "" || m.ExpenseID != nil || m.ToBankID != nil {
		return nil
	}
	if m.Mode != models.CashModeUPI && m.Mode != models.CashModeBankTransfer {
		return nil
	}
	if config.IsDemoRun(ctx) {
		return nil
	}
	return EnsureBankBalance(ctx, *m.BankID, m.Amount)
}

// ensureExpenseBank is the same stop for an expense paid by UPI / Bank Transfer, checked before the expense
// is booked (once booked it is already part of the bank's balance).
func ensureExpenseBank(ctx context.Context, mode string, bankID *uint, amount float64) error {
	if bankID == nil || (mode != models.CashModeUPI && mode != models.CashModeBankTransfer) || config.IsDemoRun(ctx) {
		return nil
	}
	return EnsureBankBalance(ctx, *bankID, amount)
}

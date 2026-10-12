package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Investment/models"
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

const epsilon = 0.01

type planRequest struct {
	Name                string  `json:"name"`
	InterestRateType    string  `json:"interest_rate_type"`
	InterestRatePercent float64 `json:"interest_rate_percent"`
	PayoutFrequency     string  `json:"payout_frequency"`
	TenureMonths        int     `json:"tenure_months"`
	MinPrincipal        float64 `json:"min_principal"`
	IsActive            bool    `json:"is_active"`
	Engine              string  `json:"engine"`
	ProductType         string  `json:"product_type"`
}

type createRequest struct {
	BranchID           uint    `json:"branch_id"`
	CustomerID         uint    `json:"customer_id"`
	PlanID             uint    `json:"plan_id"`
	PrincipalAmount    float64 `json:"principal_amount"`
	StartDate          string  `json:"start_date"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
}

type markPayoutPaidRequest struct {
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
}

type matureRequest struct {
	Action          string  `json:"action"`
	PlanID          uint    `json:"plan_id"`
	PrincipalAmount float64 `json:"principal_amount"`
	// payout breakdown, used when closing a live-engine investment
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
}

type addCashRequest struct {
	Amount             float64 `json:"amount"`
	OccurredOn         string  `json:"occurred_on"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
	Reference          string  `json:"reference"`
}

type withdrawRequest struct {
	InterestAmount     float64 `json:"interest_amount"`
	PrincipalAmount    float64 `json:"principal_amount"`
	OccurredOn         string  `json:"occurred_on"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
	Reference          string  `json:"reference"`
}

type CashRecorder interface {
	RecordInvestmentDepositCashIn(ctx context.Context, investmentID uint, investmentNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, branchID uint, occurredOn time.Time, customerID uint) (movementID uint, err error)
	RecordInvestmentPayoutCashOut(ctx context.Context, investmentID uint, investmentNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, payoutType string, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
}

type CommsRecorder interface {
	NotifyInterestPayout(ctx context.Context, customerID uint, investmentNumber string, amount float64) error
	NotifyInvestmentMatured(ctx context.Context, customerID uint, investmentNumber string) error
}

type PlanInput struct {
	Name                string
	InterestRateType    string
	InterestRatePercent float64
	PayoutFrequency     string
	TenureMonths        int
	MinPrincipal        float64
	IsActive            bool
	Engine              string
	ProductType         string
}

type CreateInput struct {
	BranchID            uint
	CustomerID          uint
	PlanID              uint
	PrincipalAmount     float64
	StartDate           time.Time
	CreatedByEmployeeID uint
	CashAmount          float64
	UpiAmount           float64
	BankTransferAmount  float64
	ChequeAmount        float64
	BankID              *uint
	// Rollover marks a renewal: the old principal rolls into the new investment, so no cash moves.
	Rollover bool
}

type ListInput struct {
	BranchID   *uint
	CustomerID *uint
	Status     string
	Query      string
	Limit      int
	Offset     int
}

type MarkPayoutPaidInput struct {
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	BankID             *uint
}

type RenewInput struct {
	PlanID              uint
	PrincipalAmount     float64
	CreatedByEmployeeID uint
}

type AddCashInput struct {
	Amount               float64
	OccurredOn           time.Time
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	BankID               *uint
	Reference            string
	RecordedByEmployeeID uint
}

type WithdrawInput struct {
	InterestAmount       float64
	PrincipalAmount      float64
	OccurredOn           time.Time
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	BankID               *uint
	Reference            string
	RecordedByEmployeeID uint
}

type ListFilter struct {
	BranchID   *uint
	CustomerID *uint
	Status     string
	Query      string
	Limit      int
	Offset     int
}

type CalendarPayout struct {
	InvestmentID     uint
	InvestmentNumber string
	CustomerID       uint
	CustomerName     string
	BranchID         uint
	DueDate          time.Time
	Amount           float64
}

func parseOccurredOn(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t
	}
	return time.Time{}
}

func validateFrequency(engine, freq string) bool {
	if engine == models.EngineLive {
		switch freq {
		case models.PayoutFrequencyDaily, models.PayoutFrequencyWeekly, models.PayoutFrequencyMonthly, models.PayoutFrequencyQuarterly, models.PayoutFrequencyYearly:
			return true
		}
		return false
	}
	switch freq {
	case models.PayoutFrequencyMonthly, models.PayoutFrequencyQuarterly, models.PayoutFrequencyYearly:
		return true
	}
	return false
}

func validateRateType(t string) bool {
	switch t {
	case models.InterestRateTypeSimple, models.InterestRateTypeCompound:
		return true
	}
	return false
}

func validateEngine(e string) bool {
	switch e {
	case models.EngineSchedule, models.EngineLive:
		return true
	}
	return false
}

func monthsPerPeriod(frequency string) int {
	switch frequency {
	case models.PayoutFrequencyYearly:
		return 12
	case models.PayoutFrequencyQuarterly:
		return 3
	default:
		return 1
	}
}

func engineOrDefault(e string) string {
	if e == "" {
		return models.EngineSchedule
	}
	return e
}

func productTypeOrDefault(t string) string {
	if t == "" {
		return "Deposit"
	}
	return t
}

func validateProductType(t string) bool {
	switch t {
	case "Deposit", "Bond":
		return true
	}
	return false
}

func SaveInvestmentPlan(ctx context.Context, in PlanInput) (*models.InvestmentPlan, error) {
	engine := engineOrDefault(in.Engine)
	if !validateEngine(engine) {
		return nil, common.NewBadRequest("engine must be Schedule or Live")
	}
	productType := productTypeOrDefault(in.ProductType)
	if !validateProductType(productType) {
		return nil, common.NewBadRequest("product type must be Deposit or Bond")
	}
	if in.TenureMonths <= 0 {
		return nil, common.NewBadRequest("tenure months must be greater than zero")
	}
	if !validateFrequency(engine, in.PayoutFrequency) {
		return nil, common.NewBadRequest("payout frequency must be Monthly or Yearly")
	}
	if !validateRateType(in.InterestRateType) {
		return nil, common.NewBadRequest("interest rate type must be Simple or Compound")
	}
	if in.InterestRatePercent < 0 {
		return nil, common.NewBadRequest("interest rate percent must not be negative")
	}
	if engine == models.EngineSchedule && in.TenureMonths%monthsPerPeriod(in.PayoutFrequency) != 0 {
		return nil, common.NewBadRequest("tenure months must divide evenly by the payout frequency")
	}
	rec := &models.InvestmentPlan{
		Name:                in.Name,
		InterestRateType:    in.InterestRateType,
		InterestRatePercent: common.RoundMoney(in.InterestRatePercent),
		PayoutFrequency:     in.PayoutFrequency,
		TenureMonths:        in.TenureMonths,
		MinPrincipal:        common.RoundMoney(in.MinPrincipal),
		IsActive:            in.IsActive,
		Engine:              engine,
		ProductType:         productType,
	}
	if err := insertPlan(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func updatePlan(ctx context.Context, id uint, in PlanInput) (*models.InvestmentPlan, error) {
	rec, err := findPlanByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewNotFound("investment plan not found")
		}
		return nil, err
	}
	engine := engineOrDefault(in.Engine)
	if !validateEngine(engine) {
		return nil, common.NewBadRequest("engine must be Schedule or Live")
	}
	productType := productTypeOrDefault(in.ProductType)
	if !validateProductType(productType) {
		return nil, common.NewBadRequest("product type must be Deposit or Bond")
	}
	if in.TenureMonths <= 0 {
		return nil, common.NewBadRequest("tenure months must be greater than zero")
	}
	if !validateFrequency(engine, in.PayoutFrequency) {
		return nil, common.NewBadRequest("payout frequency must be Monthly or Yearly")
	}
	if !validateRateType(in.InterestRateType) {
		return nil, common.NewBadRequest("interest rate type must be Simple or Compound")
	}
	if in.InterestRatePercent < 0 {
		return nil, common.NewBadRequest("interest rate percent must not be negative")
	}
	if engine == models.EngineSchedule && in.TenureMonths%monthsPerPeriod(in.PayoutFrequency) != 0 {
		return nil, common.NewBadRequest("tenure months must divide evenly by the payout frequency")
	}
	rec.Engine = engine
	rec.ProductType = productType
	rec.Name = in.Name
	rec.InterestRateType = in.InterestRateType
	rec.InterestRatePercent = common.RoundMoney(in.InterestRatePercent)
	rec.PayoutFrequency = in.PayoutFrequency
	rec.TenureMonths = in.TenureMonths
	rec.MinPrincipal = common.RoundMoney(in.MinPrincipal)
	rec.IsActive = in.IsActive
	if err := persistPlan(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func listPlans(ctx context.Context, activeOnly bool, search string, limit, offset int) ([]models.InvestmentPlan, int64, error) {
	return findAllPlans(ctx, activeOnly, search, limit, offset)
}

func getPlan(ctx context.Context, id uint) (*models.InvestmentPlan, error) {
	rec, err := findPlanByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewNotFound("investment plan not found")
		}
		return nil, err
	}
	return rec, nil
}

func SaveInvestment(ctx context.Context, in CreateInput) (*models.Investment, error) {
	if in.PrincipalAmount <= 0 {
		return nil, common.NewBadRequest("principal amount must be greater than zero")
	}
	if _, err := common.FindCustomerByID(ctx, in.CustomerID); err != nil {
		return nil, err
	}
	plan, err := findPlanByID(ctx, in.PlanID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewNotFound("investment plan not found")
		}
		return nil, err
	}
	if !plan.IsActive {
		return nil, common.NewBadRequest("investment plan is not active")
	}
	principal := common.RoundMoney(in.PrincipalAmount)
	if principal < plan.MinPrincipal {
		return nil, common.NewBadRequest("principal amount is below the plan's minimum")
	}
	depCash, depUpi, depBankTransfer, depCheque, err := common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, principal, in.BankID)
	if err != nil {
		return nil, err
	}
	var depBankID *uint
	if depUpi+depBankTransfer+depCheque > 0 {
		depBankID = in.BankID
	}
	startDate := in.StartDate
	if startDate.IsZero() {
		startDate = time.Now()
	}
	maturityDate := startDate.AddDate(0, plan.TenureMonths, 0)
	rec := &models.Investment{
		BranchID:            in.BranchID,
		CustomerID:          in.CustomerID,
		PlanID:              plan.ID,
		CreatedByEmployeeID: in.CreatedByEmployeeID,
		PrincipalAmount:     principal,
		InterestRateType:    plan.InterestRateType,
		InterestRatePercent: plan.InterestRatePercent,
		PayoutFrequency:     plan.PayoutFrequency,
		TenureMonths:        plan.TenureMonths,
		Engine:              engineOrDefault(plan.Engine),
		StartDate:           startDate,
		MaturityDate:        maturityDate,
		Status:              models.StatusActive,
	}
	if rec.Engine == models.EngineLive {
		rec.OutstandingPrincipal = principal
		rec.LastAccrualDate = startDate
	}
	err = investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		count, err := countAll(ctx)
		if err != nil {
			return err
		}
		rec.InvestmentNumber = fmt.Sprintf("INV-%05d", count+1)
		if err := insertInvestment(ctx, tx, rec); err != nil {
			return err
		}
		if rec.Engine != models.EngineLive {
			payouts := generatePayoutSchedule(rec)
			for i := range payouts {
				payouts[i].TenantID = rec.TenantID
			}
			if err := createPayouts(ctx, tx, payouts); err != nil {
				return err
			}
		}
		// the deposit's cash lines are saved with the investment (a renewal rolls the old principal over,
		// so no cash moves for it)
		if !in.Rollover {
			if _, err := cashbook.RecordInvestmentDepositCashIn(cashbook.WithTx(ctx, tx), rec.ID, rec.InvestmentNumber, rec.PrincipalAmount, depCash, depUpi, depBankTransfer, depCheque, depBankID, rec.BranchID, startDate, rec.CustomerID); err != nil {
				return fmt.Errorf("could not record the deposit in Cash-in-Hand, investment not saved: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rec, nil
}

func generatePayoutSchedule(inv *models.Investment) []models.InvestmentPayout {
	step := monthsPerPeriod(inv.PayoutFrequency)
	periods := inv.TenureMonths / step
	periodsPerYear := 12.0 / float64(step)
	recs := make([]models.InvestmentPayout, 0, periods)
	due := inv.StartDate
	var prevCompoundedValue = inv.PrincipalAmount
	for i := 1; i <= periods; i++ {
		due = due.AddDate(0, step, 0)
		var amount float64
		switch inv.InterestRateType {
		case models.InterestRateTypeCompound:
			ratePerPeriod := inv.InterestRatePercent / 100 / periodsPerYear
			nextValue := common.RoundMoney(prevCompoundedValue * (1 + ratePerPeriod))
			amount = common.RoundMoney(nextValue - prevCompoundedValue)
			prevCompoundedValue = nextValue
		default:
			amount = common.RoundMoney(inv.PrincipalAmount * inv.InterestRatePercent / 100 / periodsPerYear)
		}
		recs = append(recs, models.InvestmentPayout{
			InvestmentID: inv.ID,
			SequenceNo:   i,
			DueDate:      due,
			Amount:       amount,
			Status:       "Pending",
		})
	}
	return recs
}

func getInvestment(ctx context.Context, id uint, branchID *uint) (*models.Investment, error) {
	rec, err := findInvestmentByID(ctx, id, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewNotFound("investment not found")
		}
		return nil, err
	}
	if rec.Engine == models.EngineLive {
		if err := settleAndSave(ctx, nil, rec, time.Now()); err != nil {
			return nil, err
		}
		rec.OutstandingInterest = clampMoney(rec.AccruedInterest - rec.InterestWithdrawn)
	}
	return rec, nil
}

func listInvestments(ctx context.Context, in ListInput) ([]models.Investment, bool, int64, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = 10
	}
	recs, total, err := findInvestments(ctx, ListFilter{
		BranchID:   in.BranchID,
		CustomerID: in.CustomerID,
		Status:     in.Status,
		Query:      in.Query,
		Limit:      limit,
		Offset:     in.Offset,
	})
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	now := time.Now()
	for i := range recs {
		if recs[i].Engine != models.EngineLive {
			continue
		}
		delta, _ := projectAccrual(&recs[i], now)
		recs[i].OutstandingInterest = clampMoney(recs[i].AccruedInterest + delta - recs[i].InterestWithdrawn)
	}
	return recs, hasMore, total, nil
}

func FindPayoutSchedule(ctx context.Context, investmentID uint, branchID *uint, limit, offset int) ([]models.InvestmentPayout, bool, error) {
	if _, err := getInvestment(ctx, investmentID, branchID); err != nil {
		return nil, false, err
	}
	if limit <= 0 {
		limit = 10
	}
	recs, err := findPayouts(ctx, investmentID, limit, offset)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, nil
}

func nonCashBankID(bankID *uint, upi, bankTransfer, cheque float64) *uint {
	if upi+bankTransfer+cheque > 0 {
		return bankID
	}
	return nil
}

func SavePayoutPayment(ctx context.Context, investmentID, payoutID uint, branchID *uint, employeeID uint, in MarkPayoutPaidInput) (*models.InvestmentPayout, error) {
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	// A closed investment still owes its pending principal and interest payouts; closing only queues them.
	if inv.Status != models.StatusActive && inv.Status != models.StatusMatured && inv.Status != "Closed" && inv.Status != "Renewed" {
		return nil, common.NewConflict("investment is not active")
	}
	var payout models.InvestmentPayout
	err = investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lockedInv, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			return err
		}
		p, err := lockPayoutByID(ctx, tx, payoutID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("payout not found")
			}
			return err
		}
		if p.InvestmentID != lockedInv.ID {
			return common.NewNotFound("payout not found")
		}
		if p.Status == "Paid" {
			return common.NewConflict("payout has already been paid")
		}
		cashAmt, upiAmt, bankTransferAmt, chequeAmt, err := common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, p.Amount, in.BankID)
		if err != nil {
			return err
		}
		now := time.Now()
		p.Status = "Paid"
		p.PaidAt = &now
		p.PaidByEmployeeID = &employeeID
		p.CashAmount = cashAmt
		p.UpiAmount = upiAmt
		p.BankTransferAmount = bankTransferAmt
		p.ChequeAmount = chequeAmt
		if err := updatePayout(ctx, tx, p); err != nil {
			return err
		}
		if !p.IsPrincipalReturn {
			lockedInv.TotalInterestPaid = common.RoundMoney(lockedInv.TotalInterestPaid + p.Amount)
		}
		if err := persistInvestment(ctx, tx, lockedInv); err != nil {
			return err
		}
		// the payout's cash lines are saved with it: a failed cash line leaves the payout Pending
		payoutType := "Interest payout"
		if p.IsPrincipalReturn {
			payoutType = "Principal return"
		}
		movementID, _, err := cashbook.RecordInvestmentPayoutCashOut(cashbook.WithTx(ctx, tx), lockedInv.ID, lockedInv.InvestmentNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, lockedInv.BranchID, *p.PaidAt, payoutType, lockedInv.CustomerID, nonCashBankID(in.BankID, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount))
		if err != nil {
			return fmt.Errorf("could not record the payout in Cash-in-Hand, payout not saved: %w", err)
		}
		p.CashMovementID = &movementID
		if err := updatePayout(ctx, tx, p); err != nil {
			return err
		}
		payout = *p
		return nil
	})
	if err != nil {
		return nil, err
	}
	if !config.IsDemoRun(ctx) {
		if err := notifyInterestPayout(ctx, inv.CustomerID, inv.InvestmentNumber, payout.Amount); err != nil {
			log.Printf("notify interest payout failed for investment %d: %v", inv.ID, err)
		}
	}
	return &payout, nil
}

func SweepMaturities(ctx context.Context) error {
	due, err := findDueForMaturitySweep(ctx, time.Now())
	if err != nil {
		return err
	}
	for i := range due {
		inv := &due[i]
		inv.Status = models.StatusMatured
		if err := persistInvestment(ctx, nil, inv); err != nil {
			log.Printf("failed to flag investment %d matured: %v", inv.ID, err)
			continue
		}
		if !config.IsDemoRun(ctx) {
			if err := notifyInvestmentMatured(ctx, inv.CustomerID, inv.InvestmentNumber); err != nil {
				log.Printf("notify investment matured failed for investment %d: %v", inv.ID, err)
			}
		}
	}
	return nil
}

func matureInvestment(ctx context.Context, investmentID uint, branchID *uint, action string, renewIn *RenewInput, pay *MarkPayoutPaidInput, employeeID uint) (*models.Investment, error) {
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	if inv.Engine == models.EngineLive && action == "Close" {
		return closeLiveInvestment(ctx, investmentID, branchID, pay, employeeID)
	}
	if inv.Status != models.StatusMatured {
		return nil, common.NewConflict("investment has not matured yet")
	}
	switch action {
	case "Close":
		err = investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			locked, err := lockByID(ctx, tx, investmentID, branchID)
			if err != nil {
				return err
			}
			nextSeq := 1
			existing, err := findPayouts(ctx, investmentID, 1000, 0)
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				nextSeq = existing[len(existing)-1].SequenceNo + 1
			}
			final := &models.InvestmentPayout{
				InvestmentID:      locked.ID,
				SequenceNo:        nextSeq,
				DueDate:           time.Now(),
				Amount:            locked.PrincipalAmount,
				IsPrincipalReturn: true,
				Status:            "Pending",
			}
			if err := appendPayout(ctx, tx, final); err != nil {
				return err
			}
			now := time.Now()
			locked.Status = "Closed"
			locked.ClosedAt = &now
			if err := persistInvestment(ctx, tx, locked); err != nil {
				return err
			}
			inv = locked
			return nil
		})
		if err != nil {
			return nil, err
		}
		return inv, nil
	case "Renew":
		if renewIn == nil {
			return nil, common.NewBadRequest("maturity decision must be Close or Renew")
		}
		newInv, err := SaveInvestment(ctx, CreateInput{
			BranchID:            inv.BranchID,
			CustomerID:          inv.CustomerID,
			PlanID:              renewIn.PlanID,
			PrincipalAmount:     renewIn.PrincipalAmount,
			CreatedByEmployeeID: renewIn.CreatedByEmployeeID,
			Rollover:            true,
		})
		if err != nil {
			return nil, err
		}
		err = investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			locked, err := lockByID(ctx, tx, investmentID, branchID)
			if err != nil {
				return err
			}
			if locked.Engine == models.EngineLive {
				// the principal rolls into the new investment; interest earned up to maturity is queued as a
				// pending payout so it is not lost (staff pay it with "Mark Paid")
				if err := settleAndSave(ctx, tx, locked, locked.MaturityDate); err != nil {
					return err
				}
				if interest := clampMoney(locked.AccruedInterest - locked.InterestWithdrawn); interest > epsilon {
					seq := 1
					if existing, err := findPayouts(ctx, investmentID, 1000, 0); err == nil && len(existing) > 0 {
						seq = existing[len(existing)-1].SequenceNo + 1
					}
					p := &models.InvestmentPayout{InvestmentID: locked.ID, SequenceNo: seq, DueDate: time.Now(), Amount: interest, Status: "Pending"}
					p.TenantID = locked.TenantID
					if err := appendPayout(ctx, tx, p); err != nil {
						return err
					}
					locked.InterestWithdrawn = common.RoundMoney(locked.InterestWithdrawn + interest)
				}
				locked.OutstandingPrincipal = 0
			}
			now := time.Now()
			locked.Status = "Renewed"
			locked.ClosedAt = &now
			locked.RenewedToInvestmentID = &newInv.ID
			if err := persistInvestment(ctx, tx, locked); err != nil {
				return err
			}
			newLocked, err := lockByID(ctx, tx, newInv.ID, branchID)
			if err != nil {
				return err
			}
			newLocked.RenewedFromInvestmentID = &locked.ID
			if err := persistInvestment(ctx, tx, newLocked); err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		return getInvestment(ctx, newInv.ID, branchID)
	default:
		return nil, common.NewBadRequest("maturity decision must be Close or Renew")
	}
}

func listPendingPayoutsForCalendar(ctx context.Context, branchID *uint) ([]CalendarPayout, error) {
	return findPendingPayoutsForCalendar(ctx, branchID)
}

func addCash(ctx context.Context, investmentID uint, branchID *uint, in AddCashInput) (*models.Investment, error) {
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	amount := common.RoundMoney(in.Amount)
	var splitErr error
	in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, splitErr = common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, amount, in.BankID)
	if err := splitErr; err != nil {
		return nil, err
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}
	var invID uint
	var txRow models.InvestmentTransaction
	err := investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		if inv.Engine != models.EngineLive {
			return common.NewBadRequest("this action is only available for investments using the live accrual engine")
		}
		if inv.Status != models.StatusActive {
			return common.NewConflict("investment is not active")
		}
		if err := common.ValidateOccurredOn(occurredOn, inv.LastAccrualDate, time.Now()); err != nil {
			return err
		}
		if err := settleAndSave(ctx, tx, inv, occurredOn); err != nil {
			return err
		}
		principalBefore := inv.OutstandingPrincipal
		interestBefore := clampMoney(inv.AccruedInterest - inv.InterestWithdrawn)
		inv.OutstandingPrincipal = common.RoundMoney(inv.OutstandingPrincipal + amount)
		inv.PrincipalAmount = common.RoundMoney(inv.PrincipalAmount + amount)
		if err := persistInvestment(ctx, tx, inv); err != nil {
			return err
		}
		txRow = models.InvestmentTransaction{
			InvestmentID:       inv.ID,
			Type:               "Deposit",
			Amount:             amount,
			PrincipalAmount:    amount,
			CashAmount:         in.CashAmount,
			UpiAmount:          in.UpiAmount,
			BankTransferAmount: in.BankTransferAmount,
			ChequeAmount:       in.ChequeAmount,
			PrincipalBefore:    principalBefore,
			PrincipalAfter:     inv.OutstandingPrincipal,
			InterestBefore:     interestBefore,
			InterestAfter:      clampMoney(inv.AccruedInterest - inv.InterestWithdrawn),
			OccurredOn:         occurredOn,
			Reference:          in.Reference,
		}
		if in.RecordedByEmployeeID != 0 {
			txRow.RecordedByEmployeeID = &in.RecordedByEmployeeID
		}
		if err := createTransaction(ctx, tx, &txRow); err != nil {
			return err
		}
		// the deposit's cash lines are saved with the transaction row
		movementID, err := cashbook.RecordInvestmentDepositCashIn(cashbook.WithTx(ctx, tx), inv.ID, inv.InvestmentNumber, amount, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, nonCashBankID(in.BankID, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount), inv.BranchID, occurredOn, inv.CustomerID)
		if err != nil {
			return fmt.Errorf("could not record the deposit in Cash-in-Hand, cash not added: %w", err)
		}
		txRow.CashMovementID = &movementID
		if err := updateTransaction(ctx, tx, &txRow); err != nil {
			return err
		}
		invID = inv.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return getInvestment(ctx, invID, branchID)
}

func withdrawInvestment(ctx context.Context, investmentID uint, branchID *uint, in WithdrawInput) (*models.Investment, error) {
	if in.InterestAmount < 0 || in.PrincipalAmount < 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	total := common.RoundMoney(in.InterestAmount + in.PrincipalAmount)
	if total <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	var splitErr error
	in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, splitErr = common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, total, in.BankID)
	if splitErr != nil {
		return nil, splitErr
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}
	var invID uint
	var txRow models.InvestmentTransaction
	err := investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		if inv.Engine != models.EngineLive {
			return common.NewBadRequest("this action is only available for investments using the live accrual engine")
		}
		if inv.Status != models.StatusActive && inv.Status != models.StatusMatured {
			return common.NewConflict("investment is not active")
		}
		if err := common.ValidateOccurredOn(occurredOn, inv.LastAccrualDate, time.Now()); err != nil {
			return err
		}
		if err := settleAndSave(ctx, tx, inv, occurredOn); err != nil {
			return err
		}
		principalBefore := inv.OutstandingPrincipal
		interestBefore := clampMoney(inv.AccruedInterest - inv.InterestWithdrawn)
		principalAmt := common.RoundMoney(in.PrincipalAmount)
		interestAmt := common.RoundMoney(in.InterestAmount)
		if principalAmt > principalBefore+epsilon {
			return common.NewConflict("withdrawal exceeds the outstanding principal")
		}
		if interestAmt > interestBefore+epsilon {
			return common.NewConflict("withdrawal exceeds the outstanding interest")
		}
		inv.OutstandingPrincipal = roundClamp(common.RoundMoney(inv.OutstandingPrincipal - principalAmt))
		inv.PrincipalAmount = roundClamp(common.RoundMoney(inv.PrincipalAmount - principalAmt))
		inv.InterestWithdrawn = common.RoundMoney(inv.InterestWithdrawn + interestAmt)
		if err := persistInvestment(ctx, tx, inv); err != nil {
			return err
		}
		txRow = models.InvestmentTransaction{
			InvestmentID:       inv.ID,
			Type:               "Withdrawal",
			Amount:             total,
			PrincipalAmount:    principalAmt,
			InterestAmount:     interestAmt,
			CashAmount:         in.CashAmount,
			UpiAmount:          in.UpiAmount,
			BankTransferAmount: in.BankTransferAmount,
			ChequeAmount:       in.ChequeAmount,
			PrincipalBefore:    principalBefore,
			PrincipalAfter:     inv.OutstandingPrincipal,
			InterestBefore:     interestBefore,
			InterestAfter:      clampMoney(inv.AccruedInterest - inv.InterestWithdrawn),
			OccurredOn:         occurredOn,
			Reference:          in.Reference,
		}
		if in.RecordedByEmployeeID != 0 {
			txRow.RecordedByEmployeeID = &in.RecordedByEmployeeID
		}
		if err := createTransaction(ctx, tx, &txRow); err != nil {
			return err
		}
		// the payout's cash lines are saved with the transaction row
		payoutType := "Interest & Principal withdrawal"
		switch {
		case txRow.PrincipalAmount == 0:
			payoutType = "Interest withdrawal"
		case txRow.InterestAmount == 0:
			payoutType = "Principal withdrawal"
		}
		movementID, _, err := cashbook.RecordInvestmentPayoutCashOut(cashbook.WithTx(ctx, tx), inv.ID, inv.InvestmentNumber, total, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, inv.BranchID, occurredOn, payoutType, inv.CustomerID, nonCashBankID(in.BankID, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount))
		if err != nil {
			return fmt.Errorf("could not record the withdrawal in Cash-in-Hand, withdrawal not saved: %w", err)
		}
		txRow.CashMovementID = &movementID
		if err := updateTransaction(ctx, tx, &txRow); err != nil {
			return err
		}
		invID = inv.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return getInvestment(ctx, invID, branchID)
}

func getTransactions(ctx context.Context, investmentID uint, branchID *uint, limit, offset int) ([]models.InvestmentTransaction, bool, error) {
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, false, err
	}
	if inv.Engine != models.EngineLive {
		return nil, false, common.NewBadRequest("this action is only available for investments using the live accrual engine")
	}
	if limit <= 0 {
		limit = 20
	}
	recs, err := findTransactions(ctx, investmentID, limit, offset)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, nil
}

func roundClamp(f float64) float64 {
	if math.Abs(f) < epsilon {
		return 0
	}
	return f
}

func clampMoney(v float64) float64 {
	if v < epsilon {
		return 0
	}
	return v
}

func ensureCustomerExists(ctx context.Context, customerID uint) error {
	if _, err := common.FindCustomerByID(ctx, customerID); err != nil {
		return common.NewNotFound("customer not found")
	}
	return nil
}

func notifyInterestPayout(ctx context.Context, customerID uint, investmentNumber string, amount float64) error {
	common.NotifyCustomer(ctx, customerID, "investment_interest_payout",
		"Interest payout received",
		fmt.Sprintf("Your interest payout of %.2f for investment %s has been paid.", amount, investmentNumber),
		"Investment", 0)
	return nil
}

func notifyInvestmentMatured(ctx context.Context, customerID uint, investmentNumber string) error {
	common.NotifyCustomer(ctx, customerID, "investment_matured",
		"Investment matured",
		fmt.Sprintf("Your investment %s has matured. Please contact us to close or renew it.", investmentNumber),
		"Investment", 0)
	return nil
}

func investmentDB() config.Conn { return config.DB }

func insertPlan(ctx context.Context, rec *models.InvestmentPlan) error {
	return config.DB.
		WithContext(ctx).Create(rec).Error
}

func persistPlan(ctx context.Context, rec *models.InvestmentPlan) error {
	return config.DB.
		WithContext(ctx).Save(rec).Error
}

func findPlanByID(ctx context.Context, id uint) (*models.InvestmentPlan, error) {
	var rec models.InvestmentPlan
	if err := config.DB.
		WithContext(ctx).First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func findAllPlans(ctx context.Context, activeOnly bool, search string, limit, offset int) ([]models.InvestmentPlan, int64, error) {
	var recs []models.InvestmentPlan
	q := config.DB.
		WithContext(ctx).Model(&models.InvestmentPlan{}).Order("id desc")
	if activeOnly {
		q = q.Where("is_active = ?", true)
	}
	if search != "" {
		q = q.Where("name ILIKE ?", "%"+search+"%")
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&recs).Error
	return recs, total, err
}

func insertInvestment(ctx context.Context, tx *gorm.DB, rec *models.Investment) error {
	return dbOrDefault(ctx, tx, config.DB).Create(rec).Error
}

func persistInvestment(ctx context.Context, tx *gorm.DB, rec *models.Investment) error {
	return dbOrDefault(ctx, tx, config.DB).Save(rec).Error
}

func findInvestmentByID(ctx context.Context, id uint, branchID *uint) (*models.Investment, error) {
	var rec models.Investment
	q := config.DB.
		WithContext(ctx).Preload("Customer").Preload("Branch").Preload("Plan").Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func findIDByNumber(ctx context.Context, number string, branchID *uint) (uint, error) {
	var rec models.Investment
	q := config.DB.
		WithContext(ctx).Select("id").Where("investment_number = ?", number)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return 0, err
	}
	return rec.ID, nil
}

func lockByID(ctx context.Context, tx *gorm.DB, id uint, branchID *uint) (*models.Investment, error) {
	var rec models.Investment
	q := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func findInvestments(ctx context.Context, f ListFilter) ([]models.Investment, int64, error) {
	var recs []models.Investment
	q := config.DB.
		WithContext(ctx).Preload("Customer").Preload("Plan").Model(&models.Investment{}).Order("investments.id desc")
	if f.BranchID != nil {
		q = q.Where("investments.branch_id = ?", *f.BranchID)
	}
	if f.CustomerID != nil {
		q = q.Where("investments.customer_id = ?", *f.CustomerID)
	}
	if f.Status != "" {
		q = q.Where("investments.status = ?", f.Status)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("JOIN customers ON customers.id = investments.customer_id").
			Where("investments.investment_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ?", like, like, like)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.Investment{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit + 1).Offset(f.Offset)
	}
	err := q.Find(&recs).Error
	return recs, total, err
}

func countAll(ctx context.Context) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Unscoped().Model(&models.Investment{}).Count(&count).Error
	return count, err
}

func findDueForMaturitySweep(ctx context.Context, asOf time.Time) ([]models.Investment, error) {
	var recs []models.Investment
	err := config.DB.
		WithContext(ctx).Where("status = ? AND maturity_date <= ?", models.StatusActive, asOf).Find(&recs).Error
	return recs, err
}

func createPayouts(ctx context.Context, tx *gorm.DB, recs []models.InvestmentPayout) error {
	if len(recs) == 0 {
		return nil
	}
	return dbOrDefault(ctx, tx, config.DB).Create(&recs).Error
}

func findPayouts(ctx context.Context, investmentID uint, limit, offset int) ([]models.InvestmentPayout, error) {
	var recs []models.InvestmentPayout
	err := config.DB.
		WithContext(ctx).Where("investment_id = ?", investmentID).Order("sequence_no asc").
		Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

func findPayoutByID(ctx context.Context, id uint) (*models.InvestmentPayout, error) {
	var rec models.InvestmentPayout
	if err := config.DB.
		WithContext(ctx).First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func lockPayoutByID(ctx context.Context, tx *gorm.DB, id uint) (*models.InvestmentPayout, error) {
	var rec models.InvestmentPayout
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func updatePayout(ctx context.Context, tx *gorm.DB, rec *models.InvestmentPayout) error {
	return dbOrDefault(ctx, tx, config.DB).Save(rec).Error
}

func appendPayout(ctx context.Context, tx *gorm.DB, rec *models.InvestmentPayout) error {
	return dbOrDefault(ctx, tx, config.DB).Create(rec).Error
}

func findPendingPayoutsForCalendar(ctx context.Context, branchID *uint) ([]CalendarPayout, error) {
	var rows []CalendarPayout
	q := config.DB.
		WithContext(ctx).Table("investment_payouts").
		Select("investment_payouts.due_date AS due_date, investment_payouts.amount AS amount, "+
			"investments.id AS investment_id, investments.investment_number AS investment_number, "+
			"investments.customer_id AS customer_id, customers.name AS customer_name, "+
			"investments.branch_id AS branch_id").
		Joins("JOIN investments ON investments.id = investment_payouts.investment_id").
		Joins("JOIN customers ON customers.id = investments.customer_id").
		Where("investment_payouts.status = ?", "Pending").
		Where("investments.status IN ?", []string{models.StatusActive, models.StatusMatured})
	if branchID != nil {
		q = q.Where("investments.branch_id = ?", *branchID)
	}
	err := q.Scan(&rows).Error
	return rows, err
}

func createTransaction(ctx context.Context, tx *gorm.DB, rec *models.InvestmentTransaction) error {
	return dbOrDefault(ctx, tx, config.DB).Create(rec).Error
}

func updateTransaction(ctx context.Context, tx *gorm.DB, rec *models.InvestmentTransaction) error {
	return dbOrDefault(ctx, tx, config.DB).Save(rec).Error
}

func findTransactions(ctx context.Context, investmentID uint, limit, offset int) ([]models.InvestmentTransaction, error) {
	var recs []models.InvestmentTransaction
	err := config.DB.
		WithContext(ctx).Where("investment_id = ?", investmentID).
		Order("occurred_on desc, id desc").Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

func findAllTransactions(ctx context.Context, investmentID uint) ([]models.InvestmentTransaction, error) {
	var recs []models.InvestmentTransaction
	err := config.DB.
		WithContext(ctx).Where("investment_id = ?", investmentID).
		Order("occurred_on asc, id asc").Find(&recs).Error
	return recs, err
}

func findPaidPayouts(ctx context.Context, investmentID uint) ([]models.InvestmentPayout, error) {
	var recs []models.InvestmentPayout
	err := config.DB.
		WithContext(ctx).Where("investment_id = ? AND status = ?", investmentID, "Paid").
		Order("sequence_no asc").Find(&recs).Error
	return recs, err
}

func dbOrDefault(ctx context.Context, tx *gorm.DB, fallback config.Conn) *gorm.DB {
	if tx != nil {
		return tx.WithContext(ctx)
	}
	return fallback.WithContext(ctx)
}

func CreateInvestmentPlan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req planRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := SaveInvestmentPlan(ctx, PlanInput{
		Name:                req.Name,
		InterestRateType:    req.InterestRateType,
		InterestRatePercent: req.InterestRatePercent,
		PayoutFrequency:     req.PayoutFrequency,
		TenureMonths:        req.TenureMonths,
		MinPrincipal:        req.MinPrincipal,
		IsActive:            req.IsActive,
		Engine:              req.Engine,
		ProductType:         req.ProductType,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func UpdateInvestmentPlan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req planRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := updatePlan(ctx, id, PlanInput{
		Name:                req.Name,
		InterestRateType:    req.InterestRateType,
		InterestRatePercent: req.InterestRatePercent,
		PayoutFrequency:     req.PayoutFrequency,
		TenureMonths:        req.TenureMonths,
		MinPrincipal:        req.MinPrincipal,
		IsActive:            req.IsActive,
		Engine:              req.Engine,
		ProductType:         req.ProductType,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListInvestmentPlans(c echo.Context) error {
	ctx := auth.RequestContext(c)
	search := strings.TrimSpace(c.QueryParam("search"))
	page, limit, offset := common.PageParams(c)
	activeOnly := c.QueryParam("active_only") == "true"
	if limit > 0 {
		recs, total, err := listPlans(ctx, activeOnly, search, limit, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, recs)
	}
	recs, _, err := listPlans(ctx, activeOnly, search, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, recs)
}

func GetInvestmentPlan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getPlan(ctx, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func CreateInvestment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req createRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	branchID := auth.EnforceBranchOnWrite(c, req.BranchID)
	var startDate time.Time
	if req.StartDate != "" {
		if t, err := time.Parse(time.RFC3339, req.StartDate); err == nil {
			startDate = t
		}
	}
	rec, err := SaveInvestment(ctx, CreateInput{
		BranchID:            branchID,
		CustomerID:          req.CustomerID,
		PlanID:              req.PlanID,
		PrincipalAmount:     req.PrincipalAmount,
		StartDate:           startDate,
		CreatedByEmployeeID: employeeID,
		CashAmount:          req.CashAmount,
		UpiAmount:           req.UpiAmount,
		BankTransferAmount:  req.BankTransferAmount,
		ChequeAmount:        req.ChequeAmount,
		BankID:              req.BankID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListInvestments(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID := auth.GetBranchScope(c)
	page, limit, offset := common.PageParams(c)
	var customerID *uint
	if v := c.QueryParam("customer_id"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			cid := uint(id)
			customerID = &cid
		}
	}
	if limit == 0 {
		page, limit = 1, 10
	}
	recs, _, total, err := listInvestments(ctx, ListInput{
		BranchID:   branchID,
		CustomerID: customerID,
		Status:     c.QueryParam("status"),
		Query:      c.QueryParam("search"),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, recs)
}

func GetInvestmentById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getInvestment(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func DownloadInvestmentBond(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	pdfBytes, filename, err := renderInvestmentBondPDFForInvestment(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func DownloadInvestmentStatement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	pdfBytes, filename, err := investmentStatement(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func GetInvestmentSchedule(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if limit == 0 {
		page, limit = 1, 10
	}
	recs, hasMore, err := FindPayoutSchedule(ctx, id, auth.GetBranchScope(c), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessList(c, page, limit, common.NextPages(page, hasMore), recs)
}

func PayInvestmentPayout(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	payoutID, err := common.IDParam(c, "payout_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req markPayoutPaidRequest
	_ = common.BindJSON(c, &req)
	employeeID, _, _ := auth.ActorFromContext(c)
	rec, err := SavePayoutPayment(ctx, id, payoutID, auth.GetBranchScope(c), employeeID, MarkPayoutPaidInput{
		CashAmount:         req.CashAmount,
		UpiAmount:          req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount,
		ChequeAmount:       req.ChequeAmount,
		BankID:             req.BankID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func MatureInvestment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req matureRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	var renewIn *RenewInput
	if req.Action == "Renew" {
		renewIn = &RenewInput{
			PlanID:              req.PlanID,
			PrincipalAmount:     req.PrincipalAmount,
			CreatedByEmployeeID: employeeID,
		}
	}
	pay := &MarkPayoutPaidInput{CashAmount: req.CashAmount, UpiAmount: req.UpiAmount, BankTransferAmount: req.BankTransferAmount, ChequeAmount: req.ChequeAmount, BankID: req.BankID}
	rec, err := matureInvestment(ctx, id, auth.GetBranchScope(c), req.Action, renewIn, pay, employeeID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListInvestmentsForCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	// Ownership check BEFORE the list query: the customer must resolve inside the caller's own business.
	if err := ensureCustomerExists(ctx, id); err != nil {
		return common.FailErr(c, err)
	}
	recs, _, _, err := listInvestments(ctx, ListInput{BranchID: auth.GetBranchScope(c), CustomerID: &id, Limit: 1000})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, recs)
}

func AddInvestmentCash(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req addCashRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	rec, err := addCash(ctx, id, auth.GetBranchScope(c), AddCashInput{
		Amount:               req.Amount,
		OccurredOn:           parseOccurredOn(req.OccurredOn),
		CashAmount:           req.CashAmount,
		UpiAmount:            req.UpiAmount,
		BankTransferAmount:   req.BankTransferAmount,
		ChequeAmount:         req.ChequeAmount,
		BankID:               req.BankID,
		Reference:            req.Reference,
		RecordedByEmployeeID: employeeID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func WithdrawInvestment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req withdrawRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	rec, err := withdrawInvestment(ctx, id, auth.GetBranchScope(c), WithdrawInput{
		InterestAmount:       req.InterestAmount,
		PrincipalAmount:      req.PrincipalAmount,
		OccurredOn:           parseOccurredOn(req.OccurredOn),
		CashAmount:           req.CashAmount,
		UpiAmount:            req.UpiAmount,
		BankTransferAmount:   req.BankTransferAmount,
		ChequeAmount:         req.ChequeAmount,
		BankID:               req.BankID,
		Reference:            req.Reference,
		RecordedByEmployeeID: employeeID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetInvestmentLedger(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rows, err := getLedger(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	// limit/offset page the rows (the running balance is already computed over the whole ledger);
	// without a limit the whole ledger is returned, as before.
	total := len(rows)
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	offset, _ := strconv.Atoi(c.QueryParam("offset"))
	hasMore := false
	if limit > 0 {
		if offset < 0 || offset > total {
			offset = total
		}
		end := offset + limit
		if end < total {
			hasMore = true
		} else {
			end = total
		}
		rows = rows[offset:end]
	}
	return common.Success(c, http.StatusOK, echo.Map{"items": rows, "hasMore": hasMore, "total": total})
}

func GetInvestmentByNumber(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := resolveNumber(ctx, strings.TrimSpace(c.Param("number")), auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"id": id})
}

func ListInvestmentTransactions(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if limit == 0 {
		page, limit = 1, 10
	}
	recs, hasMore, err := getTransactions(ctx, id, auth.GetBranchScope(c), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessList(c, page, limit, common.NextPages(page, hasMore), recs)
}

// closeLiveInvestment pays a matured live-engine investment out in full: the interest accrued up to
// maturity and the outstanding principal, in the modes staff chose. Interest is met from the chosen modes
// first, then principal, and each becomes its own paid payout (so the ledger shows them separately).
func closeLiveInvestment(ctx context.Context, investmentID uint, branchID *uint, pay *MarkPayoutPaidInput, employeeID uint) (*models.Investment, error) {
	if pay == nil {
		return nil, common.NewBadRequest("payout breakdown is required to close this investment")
	}
	var closed *models.Investment
	var payouts []models.InvestmentPayout
	err := investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			return err
		}
		if locked.Engine != models.EngineLive {
			return common.NewBadRequest("this action is only available for investments using the live accrual engine")
		}
		if locked.Status != models.StatusMatured {
			return common.NewConflict("investment has not matured yet")
		}
		// interest stops at the maturity date (projectAccrual caps it)
		if err := settleAndSave(ctx, tx, locked, locked.MaturityDate); err != nil {
			return err
		}
		interest := clampMoney(locked.AccruedInterest - locked.InterestWithdrawn)
		principal := locked.OutstandingPrincipal
		total := common.RoundMoney(interest + principal)
		now := time.Now()
		if total > epsilon {
			cash, upi, bank, cheque, err := common.NormalizeSplit(pay.CashAmount, pay.UpiAmount, pay.BankTransferAmount, pay.ChequeAmount, total, pay.BankID)
			if err != nil {
				return err
			}
			if !config.IsDemoRun(ctx) {
				if err := cashbook.EnsurePayoutFunds(ctx, locked.BranchID, cash, pay.BankID, upi+bank); err != nil {
					return err
				}
			}
			nextSeq := 1
			if existing, err := findPayouts(ctx, investmentID, 1000, 0); err != nil {
				return err
			} else if len(existing) > 0 {
				nextSeq = existing[len(existing)-1].SequenceNo + 1
			}
			_ = cheque
			rem := [3]float64{cash, upi, bank}
			take := func(amount float64) [3]float64 {
				var got [3]float64
				for i := range rem {
					t := math.Min(amount, rem[i])
					got[i] = common.RoundMoney(t)
					rem[i] = common.RoundMoney(rem[i] - t)
					amount = common.RoundMoney(amount - t)
				}
				return got
			}
			add := func(amount float64, isPrincipal bool) error {
				if amount <= epsilon {
					return nil
				}
				got := take(amount)
				p := models.InvestmentPayout{
					InvestmentID: locked.ID, SequenceNo: nextSeq, DueDate: now, Amount: amount,
					IsPrincipalReturn: isPrincipal, Status: "Paid", PaidAt: &now, PaidByEmployeeID: &employeeID,
					CashAmount: got[0], UpiAmount: got[1], BankTransferAmount: got[2],
				}
				p.TenantID = locked.TenantID
				nextSeq++
				if err := appendPayout(ctx, tx, &p); err != nil {
					return err
				}
				payouts = append(payouts, p)
				return nil
			}
			if err := add(interest, false); err != nil {
				return err
			}
			if err := add(principal, true); err != nil {
				return err
			}
		}
		// each payout's cash lines are saved with it, so closing never leaves a paid payout with no money
		for i := range payouts {
			p := &payouts[i]
			payoutType := "Interest payout"
			if p.IsPrincipalReturn {
				payoutType = "Principal return"
			}
			movementID, _, err := cashbook.RecordInvestmentPayoutCashOut(cashbook.WithTx(ctx, tx), locked.ID, locked.InvestmentNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, locked.BranchID, *p.PaidAt, payoutType, locked.CustomerID, nonCashBankID(pay.BankID, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount))
			if err != nil {
				return fmt.Errorf("could not record the %s in Cash-in-Hand, investment not closed: %w", payoutType, err)
			}
			p.CashMovementID = &movementID
			if err := updatePayout(ctx, tx, p); err != nil {
				return err
			}
		}
		locked.InterestWithdrawn = common.RoundMoney(locked.InterestWithdrawn + interest)
		locked.TotalInterestPaid = common.RoundMoney(locked.TotalInterestPaid + interest)
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

type payInterestRequest struct {
	Amount             float64 `json:"amount"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
}

// pendingInterestPayouts lists the unpaid interest months of a scheduled investment, oldest first.
func pendingInterestPayouts(ctx context.Context, investmentID uint, branchID *uint) ([]models.InvestmentPayout, error) {
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	if inv.Engine == models.EngineLive {
		return []models.InvestmentPayout{}, nil
	}
	var recs []models.InvestmentPayout
	err = config.DB.WithContext(ctx).
		Where("investment_id = ? AND status = ? AND is_principal_return = ?", investmentID, "Pending", false).
		Order("sequence_no asc").Find(&recs).Error
	return recs, err
}

// SaveInterestPayments pays several months of interest together: the amount is applied to the oldest unpaid
// interest months in order, each month paid in full, and the payment breakdown is spread over those months
// (interest first from the first mode, and so on) so every month gets its own paid payout and cash line. The
// amount has to be a whole number of months: a part-month cannot be left half paid.
func SaveInterestPayments(ctx context.Context, investmentID uint, branchID *uint, employeeID uint, amount float64, in MarkPayoutPaidInput) ([]models.InvestmentPayout, error) {
	amount = common.RoundMoney(amount)
	if amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, err
	}
	if inv.Engine == models.EngineLive {
		return nil, common.NewBadRequest("this investment pays interest through withdrawals, not a payout schedule")
	}
	if inv.Status != models.StatusActive && inv.Status != models.StatusMatured && inv.Status != "Closed" && inv.Status != "Renewed" {
		return nil, common.NewConflict("investment is not active")
	}
	cash, upi, bank, _, err := common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, amount, in.BankID)
	if err != nil {
		return nil, err
	}
	var paid []models.InvestmentPayout
	err = investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lockedInv, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			return err
		}
		var pending []models.InvestmentPayout
		if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("investment_id = ? AND status = ? AND is_principal_return = ?", investmentID, "Pending", false).
			Order("sequence_no asc").Find(&pending).Error; err != nil {
			return err
		}
		if len(pending) == 0 {
			return common.NewConflict("there is no unpaid interest on this investment")
		}
		var chosen []models.InvestmentPayout
		var covered float64
		for _, p := range pending {
			if covered+p.Amount > amount+0.01 {
				break
			}
			chosen = append(chosen, p)
			covered = common.RoundMoney(covered + p.Amount)
		}
		if len(chosen) == 0 {
			return common.NewBadRequest(fmt.Sprintf("amount is less than the next month's interest of ₹%.2f", pending[0].Amount))
		}
		if math.Abs(covered-amount) > 0.01 {
			msg := fmt.Sprintf("amount must cover whole months — ₹%.2f covers %d month(s)", covered, len(chosen))
			if len(chosen) < len(pending) {
				msg += fmt.Sprintf(", ₹%.2f covers %d", common.RoundMoney(covered+pending[len(chosen)].Amount), len(chosen)+1)
			}
			return common.NewBadRequest(msg)
		}
		if !config.IsDemoRun(ctx) {
			if err := cashbook.EnsurePayoutFunds(ctx, lockedInv.BranchID, cash, in.BankID, upi+bank); err != nil {
				return err
			}
		}
		rem := [3]float64{cash, upi, bank}
		take := func(need float64) [3]float64 {
			var got [3]float64
			for i := range rem {
				t := math.Min(need, rem[i])
				got[i] = common.RoundMoney(t)
				rem[i] = common.RoundMoney(rem[i] - t)
				need = common.RoundMoney(need - t)
			}
			return got
		}
		now := time.Now()
		txCtx := cashbook.WithTx(ctx, tx)
		for i := range chosen {
			p := &chosen[i]
			got := take(p.Amount)
			p.Status = "Paid"
			p.PaidAt = &now
			p.PaidByEmployeeID = &employeeID
			p.CashAmount, p.UpiAmount, p.BankTransferAmount = got[0], got[1], got[2]
			movementID, _, err := cashbook.RecordInvestmentPayoutCashOut(txCtx, lockedInv.ID, lockedInv.InvestmentNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, 0, lockedInv.BranchID, now, "Interest payout", lockedInv.CustomerID, nonCashBankID(in.BankID, p.UpiAmount, p.BankTransferAmount, 0))
			if err != nil {
				return fmt.Errorf("could not record the interest payout in Cash-in-Hand, nothing paid: %w", err)
			}
			p.CashMovementID = &movementID
			if err := updatePayout(ctx, tx, p); err != nil {
				return err
			}
			lockedInv.TotalInterestPaid = common.RoundMoney(lockedInv.TotalInterestPaid + p.Amount)
		}
		if err := persistInvestment(ctx, tx, lockedInv); err != nil {
			return err
		}
		paid = chosen
		return nil
	})
	if err != nil {
		return nil, err
	}
	if !config.IsDemoRun(ctx) {
		if err := notifyInterestPayout(ctx, inv.CustomerID, inv.InvestmentNumber, amount); err != nil {
			log.Printf("notify interest payout failed for investment %d: %v", inv.ID, err)
		}
	}
	return paid, nil
}

func ListPendingInterest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	recs, err := pendingInterestPayouts(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"items": recs})
}

func PayInvestmentInterest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req payInterestRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	paid, err := SaveInterestPayments(ctx, id, auth.GetBranchScope(c), employeeID, req.Amount, MarkPayoutPaidInput{
		CashAmount: req.CashAmount, UpiAmount: req.UpiAmount, BankTransferAmount: req.BankTransferAmount,
		ChequeAmount: req.ChequeAmount, BankID: req.BankID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"items": paid})
}

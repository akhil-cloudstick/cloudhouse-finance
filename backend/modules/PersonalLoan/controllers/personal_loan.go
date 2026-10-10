package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const InstallmentStatusPaid = "Paid"

const epsilon = 0.01

const defaultPageSize = 10

type createRequest struct {
	BranchID           uint    `json:"branch_id"`
	CustomerID         uint    `json:"customer_id"`
	PrincipalAmount    float64 `json:"principal_amount"`
	InterestType       string  `json:"interest_type"`
	InterestValue      float64 `json:"interest_value"`
	Frequency          string  `json:"frequency"`
	TenureCount        int     `json:"tenure_count"`
	FullDisbursement   bool    `json:"full_disbursement"`
	PenalInterestRate  float64 `json:"penal_interest_rate"`
	GracePeriodDays    int     `json:"grace_period_days"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
}

type paymentRequest struct {
	Amount             float64 `json:"amount"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
	Reference          string  `json:"reference"`
	Description        string  `json:"description"`
}

type approvalRequest struct {
	Stage   string `json:"stage" binding:"required"`
	Action  string `json:"action" binding:"required"`
	Remarks string `json:"remarks"`
}

type renewRequest struct {
	PrincipalAmount float64 `json:"principal_amount"`
	InterestType    string  `json:"interest_type"`
	InterestValue   float64 `json:"interest_value"`
	Frequency       string  `json:"frequency"`
	TenureCount     int     `json:"tenure_count"`
}

type CashRecorder interface {
	RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
	RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, paymentType string, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
}

type CashBalanceGuard interface {
	EnsureCashInHand(ctx context.Context, branchID uint, amount float64) error
}

type CreateInput struct {
	BranchID            uint
	CustomerID          uint
	PrincipalAmount     float64
	InterestType        string
	InterestValue       float64
	Frequency           string
	TenureCount         int
	CreatedByEmployeeID uint
	FullDisbursement    bool
	PenalInterestRate   float64
	GracePeriodDays     int
	CashAmount          float64
	UpiAmount           float64
	BankTransferAmount  float64
	ChequeAmount        float64
	BankID              *uint
}

type ApprovalInput struct {
	Stage           string
	Action          string
	ActorEmployeeID uint
	ActorRole       string
	ActorRoleID     uint
	Remarks         string
}

type ListInput struct {
	BranchID   *uint
	CustomerID *uint
	Status     string
	Frequency  string
	Query      string
	Limit      int
	Offset     int
}

type PaymentInput struct {
	Amount               float64
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	Reference            string
	Description          string
	ReceivedByEmployeeID *uint
	BankID               *uint
}

type RenewInput struct {
	PrincipalAmount     float64
	InterestType        string
	InterestValue       float64
	Frequency           string
	TenureCount         int
	CreatedByEmployeeID uint
}

type RenewResult struct {
	OldLoan *models.PersonalLoan `json:"old_loan"`
	NewLoan *models.PersonalLoan `json:"new_loan"`
}

type RenewalPreview struct {
	Rollover        float64 `json:"rollover"`
	InterestAmount  float64 `json:"interest_amount"`
	DisbursedAmount float64 `json:"disbursed_amount"`
	Shortfall       bool    `json:"shortfall"`
}

type ListFilter struct {
	BranchID   *uint
	CustomerID *uint
	Status     string
	Frequency  string
	Query      string
	Limit      int
	Offset     int
}

type CalendarInstallment struct {
	LoanID       uint
	LoanNumber   string
	CustomerID   uint
	CustomerName string
	CustomerCode string
	BranchID     uint
	DueDate      time.Time
	Amount       float64
}

func ensureCashInHand(ctx context.Context, branchID uint, amount float64) error {
	if config.IsDemoRun(ctx) {
		return nil
	}
	return cashbook.EnsureCashInHand(ctx, branchID, amount)
}

func validateFrequency(freq string) bool {
	switch freq {
	case models.FrequencyDaily, "Weekly", "Monthly":
		return true
	}
	return false
}

func validateInterestType(t string) bool {
	switch t {
	case "Flat", models.InterestTypePercentage:
		return true
	}
	return false
}

func computeInterest(principal float64, interestType string, interestValue float64) float64 {
	if interestType == models.InterestTypePercentage {
		return common.RoundMoney(principal * interestValue / 100)
	}
	return common.RoundMoney(interestValue)
}

func defaultPenalTerms(interestType string, interestValue, interestAmount float64) (rate, flatAmount float64) {
	if interestType == models.InterestTypePercentage {
		return interestValue, 0
	}
	return 0, interestAmount
}

func SavePersonalLoan(ctx context.Context, in CreateInput) (*models.PersonalLoan, error) {
	if in.PrincipalAmount <= 0 {
		return nil, common.NewBadRequest("principal amount must be greater than zero")
	}
	if in.TenureCount <= 0 {
		return nil, common.NewBadRequest("tenure count must be greater than zero")
	}
	if !validateFrequency(in.Frequency) {
		return nil, common.NewBadRequest("frequency must be Daily, Weekly or Monthly")
	}
	if !validateInterestType(in.InterestType) {
		return nil, common.NewBadRequest("interest type must be Flat or Percentage")
	}
	if in.InterestValue < 0 {
		return nil, common.NewBadRequest("interest value must not be negative")
	}
	if in.PenalInterestRate < 0 {
		return nil, common.NewBadRequest("penal interest rate must not be negative")
	}
	if in.GracePeriodDays < 0 {
		return nil, common.NewBadRequest("grace period days must not be negative")
	}
	if _, err := common.FindCustomerByID(ctx, in.CustomerID); err != nil {
		return nil, err
	}
	principal := common.RoundMoney(in.PrincipalAmount)
	interestAmount := computeInterest(principal, in.InterestType, in.InterestValue)
	if interestAmount >= principal {
		return nil, common.NewBadRequest("interest amount must be less than the principal amount")
	}
	disbursed := common.RoundMoney(principal - interestAmount)
	obligation := principal
	if in.FullDisbursement {
		disbursed = principal
		obligation = common.RoundMoney(principal + interestAmount)
	}
	dCash, dUpi, dBankTransfer, dCheque, err := common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, disbursed, in.BankID)
	if err != nil {
		return nil, err
	}
	var dBankID *uint
	if dUpi+dBankTransfer+dCheque > 0 {
		dBankID = in.BankID
	}
	chain, err := common.WorkflowChain(ctx, common.FlowPersonalLoan)
	if err != nil {
		return nil, err
	}
	firstStage, needsApproval := chain.First()
	if !needsApproval {
		if err := ensureCashInHand(ctx, in.BranchID, disbursed); err != nil {
			return nil, err
		}
	}
	installmentAmount := common.RoundMoney(obligation / float64(in.TenureCount))
	penalRate := in.PenalInterestRate
	var penalFlatAmount float64
	if penalRate <= 0 {
		penalRate, penalFlatAmount = defaultPenalTerms(in.InterestType, in.InterestValue, interestAmount)
	}
	now := time.Now()
	rec := &models.PersonalLoan{
		BranchID:                       in.BranchID,
		CustomerID:                     in.CustomerID,
		CreatedByEmployeeID:            in.CreatedByEmployeeID,
		PrincipalAmount:                obligation,
		InterestType:                   in.InterestType,
		InterestValue:                  common.RoundMoney(in.InterestValue),
		InterestAmount:                 interestAmount,
		DisbursedAmount:                disbursed,
		DisbursementCashAmount:         dCash,
		DisbursementUpiAmount:          dUpi,
		DisbursementBankTransferAmount: dBankTransfer,
		DisbursementChequeAmount:       dCheque,
		DisbursementBankID:             dBankID,
		FullDisbursement:               in.FullDisbursement,
		Frequency:                      in.Frequency,
		TenureCount:                    in.TenureCount,
		InstallmentAmount:              installmentAmount,
		OutstandingAmount:              obligation,
		TotalPaid:                      0,
		Status:                         models.StatusActive,
		OpenedDate:                     now,
		DisbursedAt:                    now,
		PenalInterestRate:              penalRate,
		PenalFlatAmount:                penalFlatAmount,
		GracePeriodDays:                in.GracePeriodDays,
	}
	if needsApproval {
		rec.Status = models.StatusPendingApproval
		rec.ApprovalStage = firstStage.Pending
	}
	err = personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		count, err := countAll(ctx)
		if err != nil {
			return err
		}
		rec.LoanNumber = fmt.Sprintf("PL-%05d", count+1)
		if err := insertPersonalLoan(ctx, tx, rec); err != nil {
			return err
		}
		if needsApproval {
			return nil
		}
		return activateTx(ctx, tx, rec, now)
	})
	if err != nil {
		return nil, err
	}
	if !needsApproval {
		recordDisbursement(ctx, rec, now)
	}
	return rec, nil
}

func activateTx(ctx context.Context, tx *gorm.DB, rec *models.PersonalLoan, now time.Time) error {
	{
		installments := generateSchedule(rec)
		for i := range installments {
			installments[i].TenantID = rec.TenantID
		}
		if err := createInstallments(ctx, tx, installments); err != nil {
			return err
		}
		return logHistory(ctx, tx, rec.ID, rec.TenantID, "loan_created",
			fmt.Sprintf("Loan opened for ₹%.2f", rec.PrincipalAmount), rec.PrincipalAmount, nil, now)
	}
}

func recordDisbursement(ctx context.Context, rec *models.PersonalLoan, now time.Time) {
	if _, _, err := cashbook.RecordLoanDisbursementCashOut(ctx, rec.ID, rec.LoanNumber, rec.DisbursedAmount, rec.DisbursementCashAmount, rec.DisbursementUpiAmount, rec.DisbursementBankTransferAmount, rec.DisbursementChequeAmount, rec.BranchID, now, rec.CustomerID, rec.DisbursementBankID); err != nil {
		log.Printf("cash-out movement (personal loan disbursement) failed for loan %d: %v", rec.ID, err)
	}
}

func approveLoan(ctx context.Context, id uint, branchID *uint, in ApprovalInput) (*models.PersonalLoan, error) {
	rec, err := findPersonalLoanByID(ctx, id, branchID)
	if err != nil {
		return nil, common.NewNotFound("personal loan not found")
	}
	if rec.Status != models.StatusPendingApproval {
		return nil, common.NewConflict("this personal loan is not waiting for approval")
	}
	if in.Action != "Approved" && in.Action != commonModels.ActionRejected {
		return nil, common.NewBadRequest("action must be Approved or Rejected")
	}
	chain, err := common.WorkflowChain(ctx, common.FlowPersonalLoan)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(rec.ApprovalStage)
	if !ok || in.Stage != step.Key {
		return nil, common.NewForbidden("this loan is not at a stage your role can act on")
	}
	if !common.CanAct(ctx, in.ActorRoleID, common.FlowPersonalLoan, step.Key) {
		return nil, common.NewForbidden("this loan is not at a stage your role can act on")
	}
	next, hasNext := chain.Next(step.Key)
	disbursing := false
	now := time.Now()
	switch {
	case in.Action == commonModels.ActionRejected:
		rec.Status = "Rejected"
		rec.ApprovalStage = commonModels.ActionRejected
	case hasNext:
		rec.ApprovalStage = next.Pending
	default:
		if err := ensureCashInHand(ctx, rec.BranchID, rec.DisbursedAmount); err != nil {
			return nil, err
		}
		disbursing = true
		rec.Status = models.StatusActive
		rec.ApprovalStage = "Approved"
		rec.OpenedDate = now
		rec.DisbursedAt = now
	}
	err = personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := persistPersonalLoan(ctx, tx, rec); err != nil {
			return err
		}
		if disbursing {
			return activateTx(ctx, tx, rec, now)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if disbursing {
		recordDisbursement(ctx, rec, now)
	}
	common.RecordAction(ctx, &commonModels.ApprovalAction{
		Flow: common.FlowPersonalLoan, EntityID: rec.ID, Stage: step.Key, Action: in.Action,
		ActorEmployeeID: in.ActorEmployeeID, ActorRole: in.ActorRole, Remarks: in.Remarks,
	})
	return findPersonalLoanByID(ctx, rec.ID, branchID)
}

func listApprovals(ctx context.Context, id uint, branchID *uint) ([]commonModels.ApprovalAction, error) {
	if _, err := findPersonalLoanByID(ctx, id, branchID); err != nil {
		return nil, common.NewNotFound("personal loan not found")
	}
	return common.ListActions(ctx, common.FlowPersonalLoan, id)
}

func generateSchedule(loan *models.PersonalLoan) []models.PersonalLoanInstallment {
	return generateScheduleFrom(loan, loan.OpenedDate)
}

func generateScheduleFrom(loan *models.PersonalLoan, anchor time.Time) []models.PersonalLoanInstallment {
	recs := make([]models.PersonalLoanInstallment, 0, loan.TenureCount)
	due := anchor
	var runningTotal float64
	for i := 1; i <= loan.TenureCount; i++ {
		due = stepDueDate(due, loan.Frequency)
		amount := loan.InstallmentAmount
		if i == loan.TenureCount {
			amount = common.RoundMoney(loan.PrincipalAmount - runningTotal)
		}
		runningTotal = common.RoundMoney(runningTotal + amount)
		recs = append(recs, models.PersonalLoanInstallment{
			PersonalLoanID: loan.ID,
			SequenceNo:     i,
			DueDate:        due,
			Amount:         amount,
			Status:         "Pending",
		})
	}
	return recs
}

func stepDueDate(from time.Time, frequency string) time.Time {
	switch frequency {
	case models.FrequencyDaily:
		return from.AddDate(0, 0, 1)
	case "Weekly":
		return from.AddDate(0, 0, 7)
	case "Monthly":
		return from.AddDate(0, 1, 0)
	default:
		return from.AddDate(0, 0, 1)
	}
}

func logHistory(ctx context.Context, tx *gorm.DB, loanID uint, tenantID uint, event, detail string, amount float64, relatedLoanID *uint, occurredAt time.Time) error {
	rec := &models.PersonalLoanHistory{
		PersonalLoanID: loanID,
		Event:          event,
		Detail:         detail,
		Amount:         amount,
		RelatedLoanID:  relatedLoanID,
		OccurredAt:     occurredAt,
	}
	rec.TenantID = tenantID
	return createHistory(ctx, tx, rec)
}

func getHistory(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]models.PersonalLoanHistory, bool, int64, error) {
	if _, err := getPersonalLoan(ctx, loanID, branchID); err != nil {
		return nil, false, 0, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	total, err := countHistory(ctx, loanID)
	if err != nil {
		return nil, false, 0, err
	}
	recs, err := findHistory(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, total, nil
}

func getPersonalLoan(ctx context.Context, id uint, branchID *uint) (*models.PersonalLoan, error) {
	rec, err := findPersonalLoanByID(ctx, id, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewNotFound("personal loan not found")
		}
		return nil, err
	}
	return rec, nil
}

func resolveNumber(ctx context.Context, number string, branchID *uint) (uint, error) {
	id, err := findIDByNumber(ctx, number, branchID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, common.NewNotFound("personal loan not found")
		}
		return 0, err
	}
	return id, nil
}

func ListPendingInstallmentsForCalendar(ctx context.Context, branchID *uint) ([]CalendarInstallment, error) {
	return findPendingInstallmentsForCalendar(ctx, branchID)
}

func listPersonalLoans(ctx context.Context, in ListInput) ([]models.PersonalLoan, bool, int64, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = defaultPageSize
	}
	recs, total, err := findPersonalLoans(ctx, ListFilter{
		BranchID:   in.BranchID,
		CustomerID: in.CustomerID,
		Status:     in.Status,
		Frequency:  in.Frequency,
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
	return recs, hasMore, total, nil
}

func getSchedule(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]models.PersonalLoanInstallment, bool, int64, error) {
	if _, err := getPersonalLoan(ctx, loanID, branchID); err != nil {
		return nil, false, 0, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	total, err := countInstallments(ctx, loanID)
	if err != nil {
		return nil, false, 0, err
	}
	recs, err := findInstallments(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, total, nil
}

func listPayments(ctx context.Context, loanID uint, branchID *uint, limit, offset int) ([]models.PersonalLoanPayment, bool, int64, error) {
	if _, err := getPersonalLoan(ctx, loanID, branchID); err != nil {
		return nil, false, 0, err
	}
	if limit <= 0 {
		limit = defaultPageSize
	}
	total, err := countPayments(ctx, loanID)
	if err != nil {
		return nil, false, 0, err
	}
	recs, err := findPayments(ctx, loanID, limit, offset)
	if err != nil {
		return nil, false, 0, err
	}
	hasMore := len(recs) > limit
	if hasMore {
		recs = recs[:limit]
	}
	return recs, hasMore, total, nil
}

func SavePersonalLoanPayment(ctx context.Context, loanID uint, branchID *uint, in PaymentInput) (*models.PersonalLoan, error) {
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("payment amount must be greater than zero")
	}
	var result *models.PersonalLoan
	var paidAmount float64
	var paidOn time.Time
	err := personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rec, err := lockByID(ctx, tx, loanID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("personal loan not found")
			}
			return err
		}
		switch rec.Status {
		case models.StatusActive, models.StatusPending:
		default:
			return common.NewConflict("loan is not active")
		}
		amount := common.RoundMoney(in.Amount)
		if amount > rec.OutstandingAmount+epsilon {
			return common.NewBadRequest("payment amount exceeds the outstanding balance")
		}
		if err := common.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, amount); err != nil {
			return err
		}
		if (in.UpiAmount > 0 || in.BankTransferAmount > 0 || in.ChequeAmount > 0) && in.BankID == nil {
			return common.NewBadRequest("bank is required when the payment breakdown includes UPI, Bank Transfer, or Cheque")
		}
		newOutstanding := common.RoundMoney(rec.OutstandingAmount - amount)
		if newOutstanding < 0 {
			newOutstanding = 0
		}
		paidAmount = amount
		paidOn = time.Now()
		payment := &models.PersonalLoanPayment{
			PersonalLoanID:       rec.ID,
			Amount:               amount,
			PaidOn:               paidOn,
			ReceivedByEmployeeID: in.ReceivedByEmployeeID,
			Method:               common.DeriveMethod(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount),
			CashAmount:           in.CashAmount,
			UpiAmount:            in.UpiAmount,
			BankTransferAmount:   in.BankTransferAmount,
			ChequeAmount:         in.ChequeAmount,
			BankID:               in.BankID,
			Reference:            in.Reference,
			Description:          in.Description,
			RunningBalance:       newOutstanding,
		}
		if err := createPayment(ctx, tx, payment); err != nil {
			return err
		}
		rec.OutstandingAmount = newOutstanding
		rec.TotalPaid = common.RoundMoney(rec.TotalPaid + amount)
		if newOutstanding <= epsilon {
			rec.OutstandingAmount = 0
			rec.Status = models.StatusClosed
			now := time.Now()
			rec.ClosedAt = &now
		} else if rec.Status == models.StatusPending {
			var currentInstallments []models.PersonalLoanInstallment
			if err := tx.Where("personal_loan_id = ?", rec.ID).Find(&currentInstallments).Error; err != nil {
				return err
			}
			if !isPastGracePeriod(rec, currentInstallments, time.Now()) {
				rec.Status = models.StatusActive
			}
		}
		if err := persistPersonalLoan(ctx, tx, rec); err != nil {
			return err
		}
		if err := allocatePaymentToInstallments(ctx, tx, rec.ID, amount); err != nil {
			return err
		}
		result = rec
		return nil
	})
	if err != nil {
		return nil, err
	}
	if _, _, err := cashbook.RecordLoanPaymentCashIn(ctx, result.ID, result.LoanNumber, paidAmount, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, result.BranchID, paidOn, "Personal Loan Payment", result.CustomerID, in.BankID); err != nil {
		log.Printf("cash-in movement (personal loan payment) failed for loan %d: %v", result.ID, err)
	}
	return result, nil
}

func allocatePaymentToInstallments(ctx context.Context, tx *gorm.DB, loanID uint, amount float64) error {
	var installments []models.PersonalLoanInstallment
	if err := tx.Where("personal_loan_id = ? AND status <> ?", loanID, InstallmentStatusPaid).
		Order("sequence_no asc").Find(&installments).Error; err != nil {
		return err
	}
	remaining := amount
	for i := range installments {
		if remaining <= epsilon {
			break
		}
		inst := &installments[i]
		room := common.RoundMoney(inst.Amount - inst.PaidAmount)
		if room <= epsilon {
			continue
		}
		credit := remaining
		if credit > room {
			credit = room
		}
		inst.PaidAmount = common.RoundMoney(inst.PaidAmount + credit)
		if inst.PaidAmount >= inst.Amount-epsilon {
			inst.Status = InstallmentStatusPaid
		} else {
			inst.Status = "PartiallyPaid"
		}
		remaining = common.RoundMoney(remaining - credit)
		if err := updateInstallment(ctx, tx, inst); err != nil {
			return err
		}
	}
	return nil
}

func markAllInstallmentsPaid(ctx context.Context, tx *gorm.DB, loanID uint) error {
	var installments []models.PersonalLoanInstallment
	if err := tx.Where("personal_loan_id = ? AND status <> ?", loanID, InstallmentStatusPaid).
		Find(&installments).Error; err != nil {
		return err
	}
	for i := range installments {
		inst := &installments[i]
		inst.PaidAmount = inst.Amount
		inst.Status = InstallmentStatusPaid
		if err := updateInstallment(ctx, tx, inst); err != nil {
			return err
		}
	}
	return nil
}

func previewRenewal(ctx context.Context, loanID uint, branchID *uint, in RenewInput) (*RenewalPreview, error) {
	old, err := getPersonalLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, err
	}
	switch old.Status {
	case models.StatusActive, models.StatusPending:
	default:
		return nil, common.NewConflict("loan is not active")
	}
	if in.PrincipalAmount <= 0 {
		return nil, common.NewBadRequest("principal amount must be greater than zero")
	}
	if !validateInterestType(in.InterestType) {
		return nil, common.NewBadRequest("interest type must be Flat or Percentage")
	}
	principal := common.RoundMoney(in.PrincipalAmount)
	interestAmount := computeInterest(principal, in.InterestType, in.InterestValue)
	rollover := old.OutstandingAmount
	disbursed := common.RoundMoney(principal - rollover - interestAmount)
	return &RenewalPreview{
		Rollover:        rollover,
		InterestAmount:  interestAmount,
		DisbursedAmount: disbursed,
		Shortfall:       disbursed < 0,
	}, nil
}

func renewLoan(ctx context.Context, loanID uint, branchID *uint, in RenewInput) (*RenewResult, error) {
	if in.PrincipalAmount <= 0 {
		return nil, common.NewBadRequest("principal amount must be greater than zero")
	}
	if in.TenureCount <= 0 {
		return nil, common.NewBadRequest("tenure count must be greater than zero")
	}
	if !validateFrequency(in.Frequency) {
		return nil, common.NewBadRequest("frequency must be Daily, Weekly or Monthly")
	}
	if !validateInterestType(in.InterestType) {
		return nil, common.NewBadRequest("interest type must be Flat or Percentage")
	}
	if in.InterestValue < 0 {
		return nil, common.NewBadRequest("interest value must not be negative")
	}
	var result RenewResult
	err := personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		old, err := lockByID(ctx, tx, loanID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("personal loan not found")
			}
			return err
		}
		switch old.Status {
		case models.StatusActive, models.StatusPending:
		default:
			return common.NewConflict("loan is not active")
		}
		if old.RenewedToLoanID != nil {
			return common.NewConflict("loan is not active")
		}
		principal := common.RoundMoney(in.PrincipalAmount)
		interestAmount := computeInterest(principal, in.InterestType, in.InterestValue)
		rollover := old.OutstandingAmount
		disbursed := common.RoundMoney(principal - rollover - interestAmount)
		if disbursed < 0 {
			return common.NewBadRequest("new principal is not enough to cover the outstanding balance and interest")
		}
		if interestAmount >= principal {
			return common.NewBadRequest("interest amount must be less than the principal amount")
		}
		if err := ensureCashInHand(ctx, old.BranchID, disbursed); err != nil {
			return err
		}
		now := time.Now()
		newLoan := &models.PersonalLoan{
			BranchID:            old.BranchID,
			CustomerID:          old.CustomerID,
			CreatedByEmployeeID: in.CreatedByEmployeeID,
			PrincipalAmount:     principal,
			InterestType:        in.InterestType,
			InterestValue:       common.RoundMoney(in.InterestValue),
			InterestAmount:      interestAmount,
			DisbursedAmount:     disbursed,
			Frequency:           in.Frequency,
			TenureCount:         in.TenureCount,
			InstallmentAmount:   common.RoundMoney(principal / float64(in.TenureCount)),
			OutstandingAmount:   principal,
			Status:              models.StatusActive,
			OpenedDate:          now,
			DisbursedAt:         now,
			RenewedFromLoanID:   &old.ID,
		}
		count, err := countAll(ctx)
		if err != nil {
			return err
		}
		newLoan.LoanNumber = fmt.Sprintf("PL-%05d", count+1)
		if err := insertPersonalLoan(ctx, tx, newLoan); err != nil {
			return err
		}
		installments := generateSchedule(newLoan)
		for i := range installments {
			installments[i].TenantID = newLoan.TenantID
		}
		if err := createInstallments(ctx, tx, installments); err != nil {
			return err
		}
		if rollover > epsilon {
			payment := &models.PersonalLoanPayment{
				PersonalLoanID: old.ID,
				Amount:         rollover,
				PaidOn:         now,
				Method:         "Renewal Rollover",
				Description:    fmt.Sprintf("Settled via renewal into loan %s", newLoan.LoanNumber),
				RunningBalance: 0,
			}
			if err := createPayment(ctx, tx, payment); err != nil {
				return err
			}
		}
		if err := markAllInstallmentsPaid(ctx, tx, old.ID); err != nil {
			return err
		}
		old.OutstandingAmount = 0
		old.TotalPaid = common.RoundMoney(old.TotalPaid + rollover)
		old.Status = models.StatusClosed
		old.ClosedAt = &now
		old.RenewedToLoanID = &newLoan.ID
		if err := persistPersonalLoan(ctx, tx, old); err != nil {
			return err
		}
		if err := logHistory(ctx, tx, old.ID, old.TenantID, "loan_renewed",
			fmt.Sprintf("Renewed into loan %s", newLoan.LoanNumber), newLoan.PrincipalAmount, &newLoan.ID, now); err != nil {
			return err
		}
		if err := logHistory(ctx, tx, newLoan.ID, newLoan.TenantID, "loan_created",
			fmt.Sprintf("Loan opened for ₹%.2f (renewed from loan %s)", newLoan.PrincipalAmount, old.LoanNumber), newLoan.PrincipalAmount, &old.ID, now); err != nil {
			return err
		}
		result = RenewResult{OldLoan: old, NewLoan: newLoan}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result.NewLoan.DisbursedAmount > epsilon {
		if _, _, err := cashbook.RecordLoanDisbursementCashOut(ctx, result.NewLoan.ID, result.NewLoan.LoanNumber, result.NewLoan.DisbursedAmount, 0, 0, 0, 0, result.NewLoan.BranchID, result.NewLoan.DisbursedAt, result.NewLoan.CustomerID, nil); err != nil {
			log.Printf("cash-out movement (personal loan renewal disbursement) failed for loan %d: %v", result.NewLoan.ID, err)
		}
	}
	return &result, nil
}

func generateBond(ctx context.Context, loanID uint, branchID *uint) ([]byte, *models.PersonalLoan, error) {
	loan, err := getPersonalLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, nil, err
	}
	cust, err := common.FindCustomerByID(ctx, loan.CustomerID)
	if err != nil {
		return nil, nil, err
	}
	var aadhaar string
	if cust.AadhaarEncrypted != "" && (config.AadhaarCipher != nil) {
		if plain, err := config.AadhaarCipher.
			Decrypt(cust.AadhaarEncrypted); err == nil {
			aadhaar = plain
		} else {
			log.Printf("personal loan bond: decrypt Aadhaar for customer %d failed: %v", cust.ID, err)
		}
	}
	pdf, err := GenerateBondPDF(ctx, loan, cust, aadhaar)
	if err != nil {
		return nil, nil, err
	}
	return pdf, loan, nil
}

func ensureCustomerExists(ctx context.Context, customerID uint) error {
	if _, err := common.FindCustomerByID(ctx, customerID); err != nil {
		return common.NewNotFound("customer not found")
	}
	return nil
}

func personalLoanDB() config.Conn { return config.DB }

func insertPersonalLoan(ctx context.Context, tx *gorm.DB, rec *models.PersonalLoan) error {
	return dbOrDefault(ctx, tx, config.DB).Create(rec).Error
}

func persistPersonalLoan(ctx context.Context, tx *gorm.DB, rec *models.PersonalLoan) error {
	return dbOrDefault(ctx, tx, config.DB).Save(rec).Error
}

func findPersonalLoanByID(ctx context.Context, id uint, branchID *uint) (*models.PersonalLoan, error) {
	var rec models.PersonalLoan
	q := config.DB.
		WithContext(ctx).Preload("Customer").Preload("Branch").Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func findIDByNumber(ctx context.Context, number string, branchID *uint) (uint, error) {
	var rec models.PersonalLoan
	q := config.DB.
		WithContext(ctx).Select("id").Where("loan_number = ?", number)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return 0, err
	}
	return rec.ID, nil
}

func lockByID(ctx context.Context, tx *gorm.DB, id uint, branchID *uint) (*models.PersonalLoan, error) {
	var rec models.PersonalLoan
	q := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func findPersonalLoans(ctx context.Context, f ListFilter) ([]models.PersonalLoan, int64, error) {
	var recs []models.PersonalLoan
	q := config.DB.
		WithContext(ctx).Preload("Customer").Model(&models.PersonalLoan{}).Order("personal_loans.id desc")
	if f.BranchID != nil {
		q = q.Where("personal_loans.branch_id = ?", *f.BranchID)
	}
	if f.CustomerID != nil {
		q = q.Where("personal_loans.customer_id = ?", *f.CustomerID)
	}
	if vals := splitCSV(f.Status); len(vals) > 0 {
		q = q.Where("personal_loans.status IN ?", vals)
	}
	if vals := splitCSV(f.Frequency); len(vals) > 0 {
		q = q.Where("personal_loans.frequency IN ?", vals)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("JOIN customers ON customers.id = personal_loans.customer_id").
			Where("personal_loans.loan_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ?", like, like, like)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.PersonalLoan{}).Count(&total).Error; err != nil {
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
		WithContext(ctx).Unscoped().Model(&models.PersonalLoan{}).Count(&count).Error
	return count, err
}

func createInstallments(ctx context.Context, tx *gorm.DB, recs []models.PersonalLoanInstallment) error {
	if len(recs) == 0 {
		return nil
	}
	return dbOrDefault(ctx, tx, config.DB).Create(&recs).Error
}

func findInstallments(ctx context.Context, loanID uint, limit, offset int) ([]models.PersonalLoanInstallment, error) {
	var recs []models.PersonalLoanInstallment
	err := config.DB.
		WithContext(ctx).Where("personal_loan_id = ?", loanID).Order("sequence_no asc").
		Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

func countInstallments(ctx context.Context, loanID uint) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.PersonalLoanInstallment{}).Where("personal_loan_id = ?", loanID).Count(&count).Error
	return count, err
}

func updateInstallment(ctx context.Context, tx *gorm.DB, rec *models.PersonalLoanInstallment) error {
	return dbOrDefault(ctx, tx, config.DB).Save(rec).Error
}

func replaceInstallments(ctx context.Context, tx *gorm.DB, loanID uint, recs []models.PersonalLoanInstallment) error {
	db := dbOrDefault(ctx, tx, config.DB)
	if err := db.Where("personal_loan_id = ?", loanID).Delete(&models.PersonalLoanInstallment{}).Error; err != nil {
		return err
	}
	if len(recs) == 0 {
		return nil
	}
	return db.Create(&recs).Error
}

func findActiveForPenalSweep(ctx context.Context) ([]models.PersonalLoan, error) {
	var recs []models.PersonalLoan
	err := config.DB.
		WithContext(ctx).
		Where("status IN ? AND (penal_interest_rate > 0 OR penal_flat_amount > 0)", []string{models.StatusActive, models.StatusPending}).
		Find(&recs).Error
	return recs, err
}

func createPayment(ctx context.Context, tx *gorm.DB, rec *models.PersonalLoanPayment) error {
	return dbOrDefault(ctx, tx, config.DB).Create(rec).Error
}

func findPayments(ctx context.Context, loanID uint, limit, offset int) ([]models.PersonalLoanPayment, error) {
	var recs []models.PersonalLoanPayment
	err := config.DB.
		WithContext(ctx).Preload("BankRef").Where("personal_loan_id = ?", loanID).Order("id desc").
		Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

func countPayments(ctx context.Context, loanID uint) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.PersonalLoanPayment{}).Where("personal_loan_id = ?", loanID).Count(&count).Error
	return count, err
}

func findPendingInstallmentsForCalendar(ctx context.Context, branchID *uint) ([]CalendarInstallment, error) {
	var rows []CalendarInstallment
	q := config.DB.
		WithContext(ctx).Table("personal_loan_installments").
		Select("personal_loan_installments.due_date AS due_date, personal_loan_installments.amount AS amount, "+
			"personal_loans.id AS loan_id, personal_loans.loan_number AS loan_number, "+
			"personal_loans.customer_id AS customer_id, customers.name AS customer_name, customers.code AS customer_code, "+
			"personal_loans.branch_id AS branch_id").
		Joins("JOIN personal_loans ON personal_loans.id = personal_loan_installments.personal_loan_id").
		Joins("JOIN customers ON customers.id = personal_loans.customer_id").
		Where("personal_loan_installments.status <> ?", InstallmentStatusPaid).
		Where("personal_loans.status = ?", models.StatusActive)
	if branchID != nil {
		q = q.Where("personal_loans.branch_id = ?", *branchID)
	}
	err := q.Scan(&rows).Error
	return rows, err
}

func createHistory(ctx context.Context, tx *gorm.DB, rec *models.PersonalLoanHistory) error {
	return dbOrDefault(ctx, tx, config.DB).Create(rec).Error
}

func findHistory(ctx context.Context, loanID uint, limit, offset int) ([]models.PersonalLoanHistory, error) {
	var recs []models.PersonalLoanHistory
	err := config.DB.
		WithContext(ctx).Where("personal_loan_id = ?", loanID).Order("occurred_at desc, id desc").
		Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

func countHistory(ctx context.Context, loanID uint) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.PersonalLoanHistory{}).Where("personal_loan_id = ?", loanID).Count(&count).Error
	return count, err
}

func dbOrDefault(ctx context.Context, tx *gorm.DB, fallback config.Conn) *gorm.DB {
	if tx != nil {
		return tx.WithContext(ctx)
	}
	return fallback.WithContext(ctx)
}

func CreatePersonalLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req createRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	branchID := auth.EnforceBranchOnWrite(c, req.BranchID)
	rec, err := SavePersonalLoan(ctx, CreateInput{
		BranchID:            branchID,
		CustomerID:          req.CustomerID,
		PrincipalAmount:     req.PrincipalAmount,
		InterestType:        req.InterestType,
		InterestValue:       req.InterestValue,
		Frequency:           req.Frequency,
		TenureCount:         req.TenureCount,
		FullDisbursement:    req.FullDisbursement,
		PenalInterestRate:   req.PenalInterestRate,
		GracePeriodDays:     req.GracePeriodDays,
		CashAmount:          req.CashAmount,
		UpiAmount:           req.UpiAmount,
		BankTransferAmount:  req.BankTransferAmount,
		ChequeAmount:        req.ChequeAmount,
		BankID:              req.BankID,
		CreatedByEmployeeID: employeeID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListPersonalLoans(c echo.Context) error {
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
		page, limit = 1, defaultPageSize
	}
	recs, _, total, err := listPersonalLoans(ctx, ListInput{
		BranchID:   branchID,
		CustomerID: customerID,
		Status:     c.QueryParam("status"),
		Frequency:  c.QueryParam("frequency"),
		Query:      c.QueryParam("search"),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, recs)
}

func GetPersonalLoanById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getPersonalLoan(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetPersonalLoanByNumber(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := resolveNumber(ctx, strings.TrimSpace(c.Param("number")), auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"id": id})
}

func GetPersonalLoanSchedule(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if limit == 0 {
		page, limit = 1, defaultPageSize
	}
	recs, _, total, err := getSchedule(ctx, id, auth.GetBranchScope(c), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, recs)
}

func ListPersonalLoanPayments(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if limit == 0 {
		page, limit = 1, defaultPageSize
	}
	recs, _, total, totals, err := getLedger(ctx, id, auth.GetBranchScope(c), limit, offset, c.QueryParam("order"))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, recs, echo.Map{"total_debit": totals.Debit, "total_credit": totals.Credit})
}

func GetPersonalLoanHistory(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if limit == 0 {
		page, limit = 1, defaultPageSize
	}
	recs, _, total, err := getHistory(ctx, id, auth.GetBranchScope(c), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, recs)
}

func ApprovePersonalLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req approvalRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, role, roleID := auth.ActorFromContext(c)
	rec, err := approveLoan(ctx, id, auth.GetBranchScope(c), ApprovalInput{
		Stage:           req.Stage,
		Action:          req.Action,
		ActorEmployeeID: employeeID,
		ActorRole:       role,
		ActorRoleID:     roleID,
		Remarks:         req.Remarks,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListPersonalLoanApprovals(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	recs, err := listApprovals(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, recs)
}

func RecordPersonalLoanPayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req paymentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	rec, err := SavePersonalLoanPayment(ctx, id, auth.GetBranchScope(c), PaymentInput{
		Amount:               req.Amount,
		CashAmount:           req.CashAmount,
		UpiAmount:            req.UpiAmount,
		BankTransferAmount:   req.BankTransferAmount,
		ChequeAmount:         req.ChequeAmount,
		BankID:               req.BankID,
		Reference:            req.Reference,
		Description:          req.Description,
		ReceivedByEmployeeID: &employeeID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func PreviewPersonalLoanRenewal(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req renewRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	preview, err := previewRenewal(ctx, id, auth.GetBranchScope(c), RenewInput{
		PrincipalAmount: req.PrincipalAmount,
		InterestType:    req.InterestType,
		InterestValue:   req.InterestValue,
		Frequency:       req.Frequency,
		TenureCount:     req.TenureCount,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, preview)
}

func RenewPersonalLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req renewRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	result, err := renewLoan(ctx, id, auth.GetBranchScope(c), RenewInput{
		PrincipalAmount:     req.PrincipalAmount,
		InterestType:        req.InterestType,
		InterestValue:       req.InterestValue,
		Frequency:           req.Frequency,
		TenureCount:         req.TenureCount,
		CreatedByEmployeeID: employeeID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, result)
}

func DownloadPersonalLoanBond(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	pdf, loan, err := generateBond(auth.RequestContext(c), id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	filename := fmt.Sprintf("bond-%s.pdf", loan.LoanNumber)
	c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	return c.Blob(http.StatusOK, "application/pdf", pdf)
}

func ListPersonalLoansForCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	// Ownership check BEFORE the list query: the customer must resolve inside the caller's own business.
	if err := ensureCustomerExists(ctx, id); err != nil {
		return common.FailErr(c, err)
	}
	recs, _, _, err := listPersonalLoans(ctx, ListInput{BranchID: auth.GetBranchScope(c), CustomerID: &id, Limit: 1000})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, recs)
}

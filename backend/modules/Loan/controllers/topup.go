package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"gorm.io/gorm"
)

type TopUpInput struct {
	Amount               float64
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	OccurredOn           time.Time
	Reference            string
	SettleInterest       string
	BankID               *uint
	ReceivedByEmployeeID uint
}

type TopUpApprovalInput struct {
	Stage           string
	Action          string
	ActorEmployeeID uint
	ActorRole       string
	ActorRoleID     uint
	Remarks         string
}

type topUpRequest struct {
	Amount             float64 `json:"amount" binding:"required"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	OccurredOn         string  `json:"occurred_on"`
	Reference          string  `json:"reference"`
	SettleInterest     string  `json:"settle_interest"`
	BankID             *uint   `json:"bank_id"`
}

func topUpLoan(ctx context.Context, loanID uint, in TopUpInput) (*models.Loan, error) {
	chain, err := loanChain(ctx, common.FlowLoanTopUp)
	if err != nil {
		return nil, err
	}
	if chain.Off() {
		return executeTopUp(ctx, loanID, in, nil)
	}
	first, _ := chain.First()
	return requestTopUp(ctx, loanID, in, first)
}

// validateTopUpSplit checks the payout split adds up and that UPI / Bank Transfer name a bank.
func validateTopUpSplit(in TopUpInput) error {
	if err := common.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, in.Amount); err != nil {
		return err
	}
	if in.ChequeAmount > 0 {
		return common.NewBadRequest("Cheque is not a supported payment mode — use Cash, UPI or Bank Transfer")
	}
	if in.UpiAmount+in.BankTransferAmount > 0 && in.BankID == nil {
		return common.NewBadRequest("bank is required when the payment breakdown includes UPI or Bank Transfer")
	}
	return nil
}

// topUpInterestSplit books the interest taken out of a top-up the way most of the top-up moved, so the
// interest entry follows the top-up's own mode and bank instead of a forced Cash.
func topUpInterestSplit(in TopUpInput, interest float64) (cash, upi, bankTransfer float64) {
	switch {
	case in.CashAmount >= in.UpiAmount && in.CashAmount >= in.BankTransferAmount:
		return interest, 0, 0
	case in.UpiAmount >= in.BankTransferAmount:
		return 0, interest, 0
	default:
		return 0, 0, interest
	}
}

func requestTopUp(ctx context.Context, loanID uint, in TopUpInput, first common.StageDef) (*models.Loan, error) {
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if err := validateTopUpSplit(in); err != nil {
		return nil, err
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if l.Status != models.StatusActive && l.Status != models.StatusDueSoon && l.Status != models.StatusOverdue {
		return nil, common.NewConflict("loan must be Active to top up")
	}
	if pending, err := findPendingByLoanID(ctx, loanID); err != nil {
		return nil, err
	} else if pending != nil {
		return nil, common.NewConflict("this loan already has a top-up waiting for approval")
	}
	ornaments, err := FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments)
	amount := common.RoundMoney(in.Amount)
	if amount > common.RoundMoney(l.EligibleLoanAmount-l.OutstandingAmount)+0.01 {
		return nil, common.NewBadRequest("requested amount exceeds the loan's available headroom — add more ornaments first")
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}
	t := &models.LoanTopUp{
		LoanID:                l.ID,
		Amount:                amount,
		EligibleAmountAtTopUp: l.EligibleLoanAmount,
		CashAmount:            in.CashAmount,
		UpiAmount:             in.UpiAmount,
		BankTransferAmount:    in.BankTransferAmount,
		ChequeAmount:          in.ChequeAmount,
		OccurredOn:            occurredOn,
		Reference:             in.Reference,
		Status:                models.TopUpStatusPending,
		ApprovalStage:         first.Pending,
		SettleInterest:        in.SettleInterest,
		BankID:                in.BankID,
	}
	if in.ReceivedByEmployeeID != 0 {
		t.ReceivedByEmployeeID = &in.ReceivedByEmployeeID
	}
	if err := createLoanTopUpTx(ctx, config.DB.
		WithContext(ctx), t); err != nil {
		return nil, err
	}
	return GetLoan(ctx, l.ID, nil)
}

func approveTopUp(ctx context.Context, topUpID uint, branchID *uint, in TopUpApprovalInput) (*models.LoanTopUp, error) {
	t, err := findLoanTopUpByID(ctx, topUpID)
	if err != nil {
		return nil, common.NewNotFound("top-up not found")
	}
	if err := checkLoanBranch(ctx, t.LoanID, branchID); err != nil {
		return nil, err
	}
	if t.Status != models.TopUpStatusPending {
		return nil, common.NewConflict("this top-up has already been approved or rejected")
	}
	if in.Action != models.ApprovalStageApproved && in.Action != models.ApprovalStageRejected {
		return nil, common.NewBadRequest("action must be Approved or Rejected")
	}
	chain, err := loanChain(ctx, common.FlowLoanTopUp)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(t.ApprovalStage)
	if !ok || in.Stage != step.Key {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	if !common.CanAct(ctx, in.ActorRoleID, common.FlowLoanTopUp, step.Key) {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	switch next, hasNext := chain.Next(step.Key); {
	case in.Action == models.ApprovalStageRejected:
		t.Status = "Rejected"
		t.ApprovalStage = models.ApprovalStageRejected
		if err := persistLoanTopUp(ctx, t); err != nil {
			return nil, err
		}
	case hasNext:
		t.ApprovalStage = next.Pending
		if err := persistLoanTopUp(ctx, t); err != nil {
			return nil, err
		}
	default:
		if _, err := executeTopUp(ctx, t.LoanID, TopUpInput{
			Amount:               t.Amount,
			CashAmount:           t.CashAmount,
			UpiAmount:            t.UpiAmount,
			BankTransferAmount:   t.BankTransferAmount,
			ChequeAmount:         t.ChequeAmount,
			OccurredOn:           time.Now(),
			Reference:            t.Reference,
			SettleInterest:       t.SettleInterest,
			BankID:               t.BankID,
			ReceivedByEmployeeID: in.ActorEmployeeID,
		}, t); err != nil {
			return nil, err
		}
	}
	common.RecordAction(ctx, &commonModels.ApprovalAction{
		Flow: common.FlowLoanTopUp, EntityID: t.ID, Stage: step.Key, Action: in.Action,
		ActorEmployeeID: in.ActorEmployeeID, ActorRole: in.ActorRole, Remarks: in.Remarks,
	})
	return findLoanTopUpByID(ctx, t.ID)
}

func executeTopUp(ctx context.Context, loanID uint, in TopUpInput, pending *models.LoanTopUp) (*models.Loan, error) {
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if err := validateTopUpSplit(in); err != nil {
		return nil, err
	}
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}
	var result *models.Loan
	var eligibleAtTopUp float64
	var cashOut float64
	var settledInterest, settledPenal, balanceAfter float64
	err := config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("loan not found")
			}
			return err
		}
		if l.Status != models.StatusActive && l.Status != models.StatusDueSoon && l.Status != models.StatusOverdue {
			return common.NewConflict("loan must be Active to top up")
		}
		ornaments, err := FindByLoanID(ctx, l.ID)
		if err != nil {
			return err
		}
		recalculateTotals(l, ornaments)
		latestPaidOn, err := findLatestPaidOn(ctx, l.ID)
		if err != nil {
			return err
		}
		latestTopUp, err := findMostRecentDate(ctx, l.ID)
		if err != nil {
			return err
		}
		latest := latestPaidOn
		if latestTopUp.After(latest) {
			latest = latestTopUp
		}
		if err := common.ValidateOccurredOn(occurredOn, latest, time.Now()); err != nil {
			return err
		}
		headroom := common.RoundMoney(l.EligibleLoanAmount - l.OutstandingAmount)
		amount := common.RoundMoney(in.Amount)
		if amount > headroom+0.01 {
			return common.NewBadRequest("requested amount exceeds the loan's available headroom — add more ornaments first")
		}
		eligibleAtTopUp = l.EligibleLoanAmount
		now := time.Now()
		var firstMonthTopUps []models.LoanTopUp
		if l.LastAccrualDate.IsZero() || l.LastAccrualDate.Equal(l.OpenedDate) {
			if ups, err := findLoanTopUpActiveByLoanID(ctx, l.ID); err == nil {
				firstMonthTopUps = ups
			}
		}
		interestDelta, penalDelta, anchor, level := projectAccrualState(l, now, firstMonthTopUps)
		if interestDelta > 0 || penalDelta > 0 {
			l.RateTierLevel = level
			l.AccruedInterest = common.RoundMoney(l.AccruedInterest + interestDelta)
			l.AccruedPenalInterest = common.RoundMoney(l.AccruedPenalInterest + penalDelta)
			l.LastAccrualDate = anchor
			refreshServicingStatus(l, now)
		}
		outstandingInterest := clampMoney(l.AccruedInterest - l.InterestPaid)
		outstandingPenal := clampMoney(l.AccruedPenalInterest - l.PenalInterestPaid)
		arrears := common.RoundMoney(outstandingInterest + outstandingPenal)
		settleMode := in.SettleInterest
		if settleMode == "" {
			settleMode = "require"
		}
		var deductedFromPayout float64
		if arrears > moneyEpsilon {
			switch settleMode {
			case "deduct":
				deductedFromPayout = math.Min(arrears, amount)
				penalPortion := math.Min(deductedFromPayout, outstandingPenal)
				interestPortion := deductedFromPayout - penalPortion
				settledInterest, settledPenal = interestPortion, penalPortion
				l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + penalPortion)
				l.InterestPaid = common.RoundMoney(l.InterestPaid + interestPortion)
			default:
				if interestDelta > 0 || penalDelta > 0 {
					_ = updateLoanTx(ctx, tx, l)
				}
				return common.NewBadRequest("outstanding interest and penal interest must be paid before a top-up can proceed, or set the top-up to deduct it from the payout instead")
			}
		}
		// The interest taken from the payout comes back in the top-up's own mode, so what has to be
		// available is the top-up split less that interest.
		intCash, intUpi, intBank := topUpInterestSplit(in, deductedFromPayout)
		if err := ensurePayoutFunds(ctx, l.BranchID, common.RoundMoney(in.CashAmount-intCash), in.BankID,
			common.RoundMoney(in.UpiAmount+in.BankTransferAmount-intUpi-intBank)); err != nil {
			return err
		}
		l.PrincipalAmount = common.RoundMoney(l.PrincipalAmount + amount)
		l.OutstandingAmount = common.RoundMoney(l.OutstandingAmount + amount)
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		cashOutAmount := common.RoundMoney(amount - deductedFromPayout)
		topUp := &models.LoanTopUp{
			LoanID:                l.ID,
			Amount:                amount,
			EligibleAmountAtTopUp: eligibleAtTopUp,
			CashAmount:            in.CashAmount,
			UpiAmount:             in.UpiAmount,
			BankTransferAmount:    in.BankTransferAmount,
			ChequeAmount:          in.ChequeAmount,
			OccurredOn:            occurredOn,
			Reference:             in.Reference,
			Status:                models.TopUpStatusActive,
		}
		if in.ReceivedByEmployeeID != 0 {
			topUp.ReceivedByEmployeeID = &in.ReceivedByEmployeeID
		}
		if pending != nil {
			topUp.ID = pending.ID
			topUp.TenantScoped = pending.TenantScoped
			topUp.CreatedAt = pending.CreatedAt
			topUp.ApprovalStage = models.ApprovalStageApproved
			topUp.SettleInterest = pending.SettleInterest
			if err := updateLoanTopUpTx(ctx, tx, topUp); err != nil {
				return err
			}
		} else if err := createLoanTopUpTx(ctx, tx, topUp); err != nil {
			return err
		}
		cashOut = cashOutAmount
		balanceAfter = common.RoundMoney(l.OutstandingAmount + clampMoney(l.AccruedInterest-l.InterestPaid) + clampMoney(l.AccruedPenalInterest-l.PenalInterestPaid) + l.OutstandingProcessingFee)
		// The cash lines join this transaction, so a failed cash line undoes the top-up too. The full top-up
		// goes out in the split staff chose; the interest taken from it is its own separate cash-in entry
		// (not netted off the payout), booked in the same mode and bank.
		deducted := common.RoundMoney(in.Amount - cashOut)
		txCtx := cashbook.WithTx(ctx, tx)
		if _, _, err := cashbook.RecordLoanTopUpCashOut(txCtx, l.ID, l.LoanNumber, in.Amount, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, l.BranchID, occurredOn, l.CustomerID, in.BankID); err != nil {
			return fmt.Errorf("could not record the top-up in Cash-in-Hand, top-up not saved: %w", err)
		}
		if deducted > 0.01 {
			_, groupID, err := cashbook.RecordLoanPaymentCashIn(txCtx, l.ID, l.LoanNumber, deducted, intCash, intUpi, intBank, 0, l.BranchID, occurredOn, "Interest (top-up settlement)", l.CustomerID, in.BankID)
			if err != nil {
				return fmt.Errorf("could not record the top-up interest in Cash-in-Hand, top-up not saved: %w", err)
			}
			var interestBankID *uint
			if intUpi+intBank > 0 {
				interestBankID = in.BankID
			}
			p := &models.LoanPayment{
				LoanID:                 l.ID,
				Amount:                 deducted,
				Type:                   models.PaymentTypeInterest,
				PaidOn:                 occurredOn.Add(time.Millisecond),
				Description:            "Interest settled from top-up payout",
				Method:                 common.DeriveMethod(intCash, intUpi, intBank, 0),
				CashAmount:             intCash,
				UpiAmount:              intUpi,
				BankTransferAmount:     intBank,
				BankID:                 interestBankID,
				PenalInterestApplied:   settledPenal,
				InterestApplied:        settledInterest,
				RunningBalance:         balanceAfter,
				CashTransactionGroupID: groupID,
			}
			if in.ReceivedByEmployeeID != 0 {
				p.ReceivedByEmployeeID = &in.ReceivedByEmployeeID
			}
			if err := createPaymentTx(ctx, tx, p); err != nil {
				return err
			}
		}
		result = l
		return nil
	})
	if err != nil {
		return nil, err
	}
	return GetLoan(ctx, result.ID, nil)
}

func listTopUps(ctx context.Context, loanID uint) ([]models.LoanTopUp, error) {
	if _, err := findLoanByID(ctx, loanID); err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	return findLoanTopUpByLoanID(ctx, loanID)
}

func createLoanTopUpTx(ctx context.Context, tx *gorm.DB, t *models.LoanTopUp) error {
	return tx.WithContext(ctx).Create(t).Error
}

func updateLoanTopUpTx(ctx context.Context, tx *gorm.DB, t *models.LoanTopUp) error {
	return tx.WithContext(ctx).Save(t).Error
}

func persistLoanTopUp(ctx context.Context, t *models.LoanTopUp) error {
	return config.DB.
		WithContext(ctx).Save(t).Error
}

func findLoanTopUpByID(ctx context.Context, id uint) (*models.LoanTopUp, error) {
	var t models.LoanTopUp
	if err := config.DB.
		WithContext(ctx).First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func findPendingByLoanID(ctx context.Context, loanID uint) (*models.LoanTopUp, error) {
	var t models.LoanTopUp
	err := config.DB.
		WithContext(ctx).Where("loan_id = ? AND status = ?", loanID, models.TopUpStatusPending).First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

func findLoanTopUpByLoanID(ctx context.Context, loanID uint) ([]models.LoanTopUp, error) {
	var recs []models.LoanTopUp
	err := config.DB.
		WithContext(ctx).Where("loan_id = ?", loanID).Order("occurred_on desc, id desc").Find(&recs).Error
	return recs, err
}

func findLoanTopUpActiveByLoanID(ctx context.Context, loanID uint) ([]models.LoanTopUp, error) {
	var recs []models.LoanTopUp
	err := config.DB.
		WithContext(ctx).Where("loan_id = ? AND status = ?", loanID, models.TopUpStatusActive).Order("occurred_on desc, id desc").Find(&recs).Error
	return recs, err
}

func findMostRecentDate(ctx context.Context, loanID uint) (time.Time, error) {
	var t models.LoanTopUp
	err := config.DB.
		WithContext(ctx).Where("loan_id = ? AND status = ?", loanID, models.TopUpStatusActive).Order("occurred_on desc, id desc").First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	return t.OccurredOn, nil
}

func TopUpLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req topUpRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	var occurredOn time.Time
	if req.OccurredOn != "" {
		occurredOn, err = parseDate(req.OccurredOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid occurred_on: expected YYYY-MM-DD"})
		}
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	rec, err := topUpLoan(ctx, loanID, TopUpInput{
		Amount:               req.Amount,
		CashAmount:           req.CashAmount,
		UpiAmount:            req.UpiAmount,
		BankTransferAmount:   req.BankTransferAmount,
		ChequeAmount:         req.ChequeAmount,
		OccurredOn:           occurredOn,
		Reference:            req.Reference,
		SettleInterest:       req.SettleInterest,
		BankID:               req.BankID,
		ReceivedByEmployeeID: actorEmployeeID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListTopUps(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := listTopUps(ctx, loanID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ApproveTopUp(c echo.Context) error {
	ctx := auth.RequestContext(c)
	topUpID, err := common.IDParam(c, "top_up_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req releaseApprovalRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorEmployeeID, actorRole, actorRoleID := auth.ActorFromContext(c)
	rec, err := approveTopUp(ctx, topUpID, auth.GetBranchScope(c), TopUpApprovalInput{
		Stage:           req.Stage,
		Action:          req.Action,
		ActorEmployeeID: actorEmployeeID,
		ActorRole:       actorRole,
		ActorRoleID:     actorRoleID,
		Remarks:         req.Remarks,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

var sanctionLimits = map[string]float64{
	"Branch Manager": 0,
	"Management":     0,
}

type ApprovalInput struct {
	Stage              string
	Action             string
	ActorEmployeeID    uint
	ActorRole          string
	ActorRoleID        uint
	Remarks            string
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	BankID             *uint
}

type approvalRequest struct {
	Stage              string  `json:"stage" binding:"required"`
	Action             string  `json:"action" binding:"required"`
	Remarks            string  `json:"remarks"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	BankID             *uint   `json:"bank_id"`
}

func firstSanctionStage(ctx context.Context) (string, error) {
	c, err := loanChain(ctx, common.FlowLoanSanction)
	if err != nil {
		return "", err
	}
	if st, ok := c.First(); ok {
		return st.Key, nil
	}
	return "LoanOperator", nil
}

func normalizeSanctionStage(stage string) string {
	if stage == "AuthorizedManagement" {
		return "FinalSanction"
	}
	return stage
}

func sanctionWarning(ctx context.Context, l *models.Loan) string {
	stage := normalizeSanctionStage(l.ApprovalStage)
	if stage == "" || stage == models.ApprovalStageApproved || stage == models.ApprovalStageRejected {
		return ""
	}
	role := common.RoleName(ctx, stage)
	if role == "" {
		f, _ := common.FindFlow(common.FlowLoanSanction)
		for _, step := range f.Stages {
			if step.Key == stage {
				role = step.Role
			}
		}
	}
	limit := sanctionLimits[role]
	if limit > 0 && l.PrincipalAmount > limit {
		return fmt.Sprintf("Principal ₹%.0f exceeds the typical ₹%.0f limit for %s — consider escalating.", l.PrincipalAmount, limit, role)
	}
	return ""
}

func SaveLoanApproval(ctx context.Context, loanID uint, in ApprovalInput) (*models.Loan, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if in.Action != models.ApprovalStageApproved && in.Action != models.ApprovalStageRejected && in.Action != "Verified" {
		return nil, common.NewBadRequest("action must be Approved or Rejected")
	}
	if l.ApprovalStage == models.ApprovalStageApproved || l.ApprovalStage == models.ApprovalStageRejected {
		return nil, common.NewBadRequest("loan  already disbursed")
	}
	chain, err := loanChain(ctx, common.FlowLoanSanction)
	if err != nil {
		return nil, err
	}
	stored := normalizeSanctionStage(l.ApprovalStage)
	step, ok := chain.ByKey(stored)
	if !ok {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	if sent := normalizeSanctionStage(in.Stage); sent != stored && sent != step.Key {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	stage := step.Key
	final := chain.IsFinal(stage)
	next, _ := chain.Next(stage)
	if !common.CanAct(ctx, in.ActorRoleID, common.FlowLoanSanction, stage) {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	if final && in.Action != models.ApprovalStageRejected {
		if err := ensurePayoutFunds(ctx, l.BranchID, in.CashAmount, in.BankID, in.UpiAmount+in.BankTransferAmount); err != nil {
			return nil, err
		}
	}
	disbursing := false
	rejected := in.Action == models.ApprovalStageRejected
	var nextStageLabel string
	if rejected {
		l.ApprovalStage = models.ApprovalStageRejected
		l.Status = models.StatusRejected
		now := time.Now()
		l.RejectedAt = &now
		l.RejectedByEmployeeID = &in.ActorEmployeeID
		l.RejectedByName = employeeName(ctx, in.ActorEmployeeID)
		l.RejectionRemarks = in.Remarks
	} else {
		switch {
		case !final:
			l.ApprovalStage = next.Key
			nextStageLabel = next.Label
		default:
			l.ApprovalStage = models.ApprovalStageApproved
			l.Status = models.StatusActive
			disbursing = true
			now := time.Now()
			l.SanctionedAmount = l.PrincipalAmount
			// The customer is paid the principal less the service charge, whether the charge is withheld
			// from the payout or added to the principal (the loan then carries the charge).
			l.DisbursedAmount = common.RoundMoney(l.PrincipalAmount - l.ServiceChargeAmount)
			l.DisbursementDate = &now
			startAccrualAtDisbursement(l, now)
		}
	}
	if disbursing {
		if err := common.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, l.DisbursedAmount); err != nil {
			return nil, err
		}
	}
	// The main ledger records only what was paid out to the customer, in the mode staff chose. The service
	// charge needs no payment breakdown: it is a debit on the loan's own ledger, with no mode.
	var payoutParts []cashbook.SplitPart
	if disbursing {
		var err error
		if payoutParts, err = cashbook.SplitParts(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, in.BankID); err != nil {
			return nil, err
		}
	}
	audit := &models.LoanApproval{
		LoanID:          loanID,
		Stage:           stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		ActorRole:       in.ActorRole,
		Remarks:         in.Remarks,
	}
	// The disbursement lines, the approval record, the loan and its ledger row are saved together: if any
	// of them fails none is kept, so the loan can never read "approved" without its cash lines (or the
	// other way round).
	if err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if disbursing {
			if _, err := cashbook.RecordLoanDisbursementGross(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, payoutParts, nil, l.BranchID, time.Now(), l.CustomerID); err != nil {
				return fmt.Errorf("could not record the disbursement in Cash-in-Hand, loan not approved: %w", err)
			}
		}
		if err := tx.Create(audit).Error; err != nil {
			return err
		}
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		if !disbursing {
			return nil
		}
		return createPaymentTx(ctx, tx, &models.LoanPayment{
			LoanID:             l.ID,
			Amount:             l.DisbursedAmount,
			Type:               models.PaymentTypeDisbursement,
			PaidOn:             time.Now(),
			Description:        "Loan disbursed",
			Method:             common.DeriveMethod(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount),
			CashAmount:         in.CashAmount,
			UpiAmount:          in.UpiAmount,
			BankTransferAmount: in.BankTransferAmount,
			ChequeAmount:       in.ChequeAmount,
			BankID:             in.BankID,
			RunningBalance:     l.OutstandingAmount,
		})
	}); err != nil {
		return nil, err
	}
	switch {
	case disbursing:
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Sanctioned", brandedMessage(ctx,
			"Dear %s, your gold loan %s has been sanctioned and ₹%.2f has been disbursed. Due date: %s. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, l.DisbursedAmount, l.DueDate.Format("02-Jan-2006"),
		), "loan_sanction", "loan", l.ID)
	case rejected:
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Rejected", brandedMessage(ctx,
			"Dear %s, your gold loan application %s has been rejected during approval. Please contact the branch for details. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber,
		), "loan_approval", "loan", l.ID)
	case nextStageLabel != "":
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Approved", brandedMessage(ctx,
			"Dear %s, your gold loan application %s has been approved at one stage and is now awaiting %s approval. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, nextStageLabel,
		), "loan_approval", "loan", l.ID)
	}
	return GetLoan(ctx, l.ID, nil)
}

func listApprovals(ctx context.Context, loanID uint) ([]models.LoanApproval, error) {
	if _, err := findLoanByID(ctx, loanID); err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	return findApprovalByLoanID(ctx, loanID)
}

func insertApproval(ctx context.Context, a *models.LoanApproval) error {
	return config.DB.
		WithContext(ctx).Create(a).Error
}

func findApprovalByLoanID(ctx context.Context, loanID uint) ([]models.LoanApproval, error) {
	var approvals []models.LoanApproval
	err := config.DB.
		WithContext(ctx).Where("loan_id = ?", loanID).Order("id asc").Find(&approvals).Error
	return approvals, err
}

func insertRequestApproval(ctx context.Context, a *models.RequestApproval) error {
	return config.DB.
		WithContext(ctx).Create(a).Error
}

func ApproveLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req approvalRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorEmployeeID, actorRole, actorRoleID := auth.ActorFromContext(c)
	rec, err := SaveLoanApproval(ctx, loanID, ApprovalInput{
		Stage:              req.Stage,
		Action:             req.Action,
		ActorEmployeeID:    actorEmployeeID,
		ActorRole:          actorRole,
		ActorRoleID:        actorRoleID,
		Remarks:            req.Remarks,
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

func ListApprovals(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := listApprovals(ctx, loanID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ApproveRequest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	requestID, err := common.IDParam(c, "request_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req releaseApprovalRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	lr, err := getRequest(ctx, requestID)
	if err != nil {
		return common.FailErr(c, err)
	}
	actorEmployeeID, actorRole, actorRoleID := auth.ActorFromContext(c)
	switch lr.Type {
	case models.RequestTypeExtension:
		rec, err := ApproveExtensionRequest(ctx, requestID, auth.GetBranchScope(c), ExtensionApprovalInput{
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
		common.Success(c, http.StatusOK, rec)
	case models.RequestTypeRelease:
		rec, err := ApproveReleaseRequest(ctx, requestID, auth.GetBranchScope(c), ReleaseApprovalInput{
			Stage:           req.Stage,
			Action:          req.Action,
			ActorEmployeeID: actorEmployeeID,
			ActorRoleID:     actorRoleID,
			Remarks:         req.Remarks,
		})
		if err != nil {
			return common.FailErr(c, err)
		}
		common.Success(c, http.StatusOK, rec)
	default:
		common.FailErr(c, common.NewBadRequest("type must be Extension or Release"))
	}
	return nil
}

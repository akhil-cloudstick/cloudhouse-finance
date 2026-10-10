package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

type ExtensionRequestInput struct {
	Months      int
	Detail      string
	RequestedBy string
}

type ExtensionApprovalInput struct {
	Stage           string
	Action          string
	ActorEmployeeID uint
	ActorRole       string
	ActorRoleID     uint
	Remarks         string
}

type extensionRequestRequest struct {
	Months      int    `json:"months" binding:"required"`
	Detail      string `json:"detail"`
	RequestedBy string `json:"requested_by"`
}

func SaveExtensionRequest(ctx context.Context, loanID uint, in ExtensionRequestInput) (*models.LoanRequest, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if in.Months <= 0 {
		return nil, common.NewBadRequest("requested extension months must be greater than zero")
	}
	if l.Status == models.StatusPendingApproval {
		return nil, common.NewBadRequest("this loan is still pending approval — extension or release can only be requested once it is approved and disbursed")
	}
	accrueAndSave(
		ctx, l)
	enrichLoan(ctx, l)
	if l.OutstandingInterest > moneyEpsilon || l.OutstandingPenalInterest > moneyEpsilon {
		return nil, common.NewBadRequest("outstanding interest and penal interest must be paid before an extension can be requested")
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = models.RequestedByStaff
	}
	chain, err := loanChain(ctx, common.FlowLoanExtension)
	if err != nil {
		return nil, err
	}
	first, needsApproval := chain.First()
	if !needsApproval && isLoanTerminal(l.Status) {
		return nil, common.NewBadRequest("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	}
	months := in.Months
	req := &models.LoanRequest{
		LoanID:                   loanID,
		Type:                     models.RequestTypeExtension,
		Status:                   models.RequestStatusPending,
		RequestedBy:              requestedBy,
		Detail:                   in.Detail,
		RequestedExtensionMonths: &months,
		ApprovalStage:            first.Pending,
		RequestedAt:              time.Now(),
	}
	if err := insertLoanRequest(ctx, req); err != nil {
		return nil, err
	}
	if !needsApproval {
		if _, err := applyExtension(ctx, req, nil, "Auto-approved — no extension approval stages configured"); err != nil {
			return nil, err
		}
		if err := persistLoanRequest(ctx, req); err != nil {
			return nil, err
		}
		notifyExtensionApproved(ctx, l, req)
	}
	return findLoanRequestByID(ctx, req.ID)
}

func applyExtension(ctx context.Context, req *models.LoanRequest, actorEmployeeID *uint, remarks string) (*models.Loan, error) {
	l, err := findLoanByID(ctx, req.LoanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if isLoanTerminal(l.Status) {
		return nil, common.NewBadRequest("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	}
	months := 0
	if req.RequestedExtensionMonths != nil {
		months = *req.RequestedExtensionMonths
	}
	newDue := l.DueDate.AddDate(0, months, 0)
	l.DueDate = newDue
	req.NewDueDate = &newDue
	l.DueSoonNotifiedAt = nil
	l.OverdueNotifiedAt = nil
	if _, err := recalculateAndSave(ctx, l); err != nil {
		return nil, err
	}
	req.ApprovalStage = models.ApprovalStageApproved
	req.Status = models.RequestStatusApproved
	now := time.Now()
	req.DecidedAt = &now
	req.DecidedByEmployeeID = actorEmployeeID
	req.Remarks = remarks
	return l, nil
}

func notifyExtensionApproved(ctx context.Context, l *models.Loan, req *models.LoanRequest) {
	notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Extension Approved", brandedMessage(ctx,
		"Dear %s, your extension request for loan %s has been fully approved. New due date: %s. — CloudHouse Finance",
		l.Customer.Name, l.LoanNumber, l.DueDate.Format("02-Jan-2006"),
	), "extension_request", "loan_request", req.ID)
}

func ApproveExtensionRequest(ctx context.Context, requestID uint, branchID *uint, in ExtensionApprovalInput) (*models.LoanRequest, error) {
	req, err := findLoanRequestByID(ctx, requestID)
	if err != nil {
		return nil, common.NewNotFound("loan request not found")
	}
	if err := checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != models.RequestTypeExtension {
		return nil, common.NewBadRequest("this request is not an Extension request")
	}
	if in.Action != models.ApprovalStageApproved && in.Action != models.ApprovalStageRejected {
		return nil, common.NewBadRequest("action must be Approved or Rejected")
	}
	if req.ApprovalStage == models.ApprovalStageApproved || req.ApprovalStage == models.ApprovalStageRejected {
		return nil, common.NewBadRequest("loan request has already been decided")
	}
	stage := req.ApprovalStage
	if stage == "" {
		stage = "PendingLoanOfficer"
	}
	chain, err := loanChain(ctx, common.FlowLoanExtension)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(stage)
	if !ok || in.Stage != step.Key {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	if !common.CanAct(ctx, in.ActorRoleID, common.FlowLoanExtension, step.Key) {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	next, hasNext := chain.Next(step.Key)
	if in.Action == models.ApprovalStageApproved {
		if l, err := findLoanByID(ctx, req.LoanID); err == nil {
			accrueAndSave(ctx, l)
			enrichLoan(ctx, l)
			if l.OutstandingInterest > moneyEpsilon || l.OutstandingPenalInterest > moneyEpsilon {
				return nil, common.NewBadRequest("outstanding interest and penal interest must be paid before an extension can be requested")
			}
		}
	}
	audit := &models.RequestApproval{
		RequestID:       requestID,
		Stage:           in.Stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		Remarks:         in.Remarks,
	}
	if err := insertRequestApproval(ctx, audit); err != nil {
		return nil, err
	}
	notifyLoan, _ := findLoanByID(ctx, req.LoanID)
	if in.Action == models.ApprovalStageRejected {
		req.ApprovalStage = models.ApprovalStageRejected
		req.Status = "Rejected"
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &in.ActorEmployeeID
		req.Remarks = in.Remarks
		if err := persistLoanRequest(ctx, req); err != nil {
			return nil, err
		}
		if notifyLoan != nil {
			notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Extension Rejected", brandedMessage(ctx,
				"Dear %s, your extension request for loan %s has been rejected. Please contact the branch for details. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), "extension_request", "loan_request", req.ID)
		}
		return findLoanRequestByID(ctx, req.ID)
	}
	finalApproval := false
	var nextStageLabel string
	if hasNext {
		req.ApprovalStage = next.Pending
		nextStageLabel = next.Label
	} else {
		actor := in.ActorEmployeeID
		l, err := applyExtension(ctx, req, &actor, in.Remarks)
		if err != nil {
			return nil, err
		}
		finalApproval = true
		notifyLoan = l
	}
	if err := persistLoanRequest(ctx, req); err != nil {
		return nil, err
	}
	if notifyLoan != nil {
		if finalApproval {
			notifyExtensionApproved(ctx, notifyLoan, req)
		} else if nextStageLabel != "" {
			notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Extension Approved", brandedMessage(ctx,
				"Dear %s, your extension request for loan %s has moved to the next approval stage (%s). — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber, nextStageLabel,
			), "extension_request", "loan_request", req.ID)
		}
	}
	return findLoanRequestByID(ctx, req.ID)
}

func CreateExtensionRequest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req extensionRequestRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := SaveExtensionRequest(ctx, loanID, ExtensionRequestInput{
		Months:      req.Months,
		Detail:      req.Detail,
		RequestedBy: req.RequestedBy,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

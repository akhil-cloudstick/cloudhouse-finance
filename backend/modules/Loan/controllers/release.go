package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

type ReleaseRequestInput struct {
	Detail      string
	RequestedBy string
	OrnamentIDs []uint
}

type ReleasePaymentInput struct {
	Type               string
	Amount             float64
	Discount           float64
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	BankID             *uint
	Method             string
	Reference          string
	InterestOverride   *float64
	DueDate            *time.Time
	ActorEmployeeID    uint
	ActorRoleID        uint
}

type ReleaseApprovalInput struct {
	Stage           string
	Action          string
	ActorEmployeeID uint
	ActorRoleID     uint
	Remarks         string
}

type releaseRequestRequest struct {
	Detail      string `json:"detail"`
	RequestedBy string `json:"requested_by"`
	OrnamentIDs []uint `json:"ornament_ids"`
}

type releasePaymentRequest struct {
	Type               string   `json:"type"`
	Amount             float64  `json:"amount"`
	Discount           float64  `json:"discount"`
	CashAmount         float64  `json:"cash_amount"`
	UpiAmount          float64  `json:"upi_amount"`
	BankTransferAmount float64  `json:"bank_transfer_amount"`
	ChequeAmount       float64  `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Method             string   `json:"method"`
	Reference          string   `json:"reference"`
	InterestOverride   *float64 `json:"interest_override"`
	DueDate            string   `json:"due_date"`
}

type releaseApprovalRequest struct {
	Stage   string `json:"stage" binding:"required"`
	Action  string `json:"action" binding:"required"`
	Remarks string `json:"remarks"`
}

func partialReleaseRemaining(outstandingBalance, principalAmount, remainingGoldValue, ltvPercent float64) float64 {
	buffer := 0.05 * principalAmount
	return (outstandingBalance + buffer) - (remainingGoldValue * ltvPercent / 100)
}

func partialReleaseDrift(outstandingBalance, remainingGoldValue, ltvPercent float64) float64 {
	return outstandingBalance - (remainingGoldValue * ltvPercent / 100)
}

func SaveReleaseRequest(ctx context.Context, loanID uint, in ReleaseRequestInput) (*models.LoanRequest, error) {
	l, err := GetLoan(ctx, loanID, nil)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if l.Status == models.StatusPendingApproval {
		return nil, common.NewBadRequest("this loan is still pending approval — extension or release can only be requested once it is approved and disbursed")
	}
	requestedBy := in.RequestedBy
	if requestedBy == "" {
		requestedBy = models.RequestedByStaff
	}
	pending, _, err := FindLoanRequests(ctx, LoanRequestFilter{LoanID: loanID, Status: models.RequestStatusPending})
	if err != nil {
		return nil, err
	}
	for _, r := range pending {
		if r.Type == models.RequestTypeRelease {
			return nil, common.NewConflict("a release has already been requested for this loan and is waiting for approval")
		}
	}
	active := make([]models.Ornament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		if o.ReleasedAt == nil {
			active = append(active, o)
		}
	}
	isPartial := false
	var selectedIDs []uint
	if len(in.OrnamentIDs) > 0 && len(in.OrnamentIDs) < len(active) {
		activeByID := make(map[uint]models.Ornament, len(active))
		for _, o := range active {
			activeByID[o.ID] = o
		}
		selectedSet := make(map[uint]bool, len(in.OrnamentIDs))
		for _, id := range in.OrnamentIDs {
			if _, ok := activeByID[id]; !ok {
				return nil, common.NewNotFound("ornament not found")
			}
			selectedSet[id] = true
		}
		selectedIDs = in.OrnamentIDs
		isPartial = true
	} else if len(in.OrnamentIDs) > 0 {
		activeByID := make(map[uint]bool, len(active))
		for _, o := range active {
			activeByID[o.ID] = true
		}
		for _, id := range in.OrnamentIDs {
			if !activeByID[id] {
				return nil, common.NewNotFound("ornament not found")
			}
		}
	}
	req := &models.LoanRequest{
		LoanID:      loanID,
		Type:        models.RequestTypeRelease,
		Status:      models.RequestStatusPending,
		RequestedBy: requestedBy,
		Detail:      in.Detail,
		IsPartial:   isPartial,
		RequestedAt: time.Now(),
	}
	if err := insertLoanRequest(ctx, req); err != nil {
		return nil, err
	}
	if isPartial {
		if err := createOrnamentSelections(ctx, req.ID, selectedIDs); err != nil {
			return nil, err
		}
	}
	return findLoanRequestByID(ctx, req.ID)
}

func SaveReleaseChecklist(ctx context.Context, requestID uint, branchID *uint, in ChecklistInput) (*models.LoanRequest, error) {
	req, err := findLoanRequestByID(ctx, requestID)
	if err != nil {
		return nil, common.NewNotFound("loan request not found")
	}
	if err := checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != models.RequestTypeRelease {
		return nil, common.NewBadRequest("this request is not a Release request")
	}
	if req.Status != models.RequestStatusPending {
		return nil, common.NewBadRequest("loan request has already been decided")
	}
	if !checkStagePermission(ctx, in.ActorRoleID, "can verify release checklist") {
		return nil, common.NewForbidden("Access denied")
	}
	if in.CustomerSawGold != nil {
		if req.Locked {
			return nil, common.NewConflict("this release request is locked after payment — it can no longer be rejected or have its checklist changed")
		}
		req.CustomerSawGold = *in.CustomerSawGold
	}
	if in.VerificationNotes != nil {
		req.VerificationNotes = *in.VerificationNotes
	}
	if in.Charges != nil {
		req.Charges = *in.Charges
	}
	if req.ApprovalStage == "" {
		req.ApprovalStage = models.ApprovalStagePendingManager
	}
	if err := persistLoanRequest(ctx, req); err != nil {
		return nil, err
	}
	return findLoanRequestByID(ctx, req.ID)
}

func recordReleaseRequestPayment(ctx context.Context, requestID uint, branchID *uint, in ReleasePaymentInput) (*models.LoanRequest, error) {
	req, err := findLoanRequestByID(ctx, requestID)
	if err != nil {
		return nil, common.NewNotFound("loan request not found")
	}
	if err := checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != models.RequestTypeRelease {
		return nil, common.NewBadRequest("this request is not a Release request")
	}
	if req.Status != models.RequestStatusPending {
		return nil, common.NewBadRequest("loan request has already been decided")
	}
	pastManagerForDriftTopUp := req.IsPartial && req.Locked &&
		req.ApprovalStage != models.ApprovalStageApproved && req.ApprovalStage != models.ApprovalStageRejected
	if req.ApprovalStage != "" && req.ApprovalStage != models.ApprovalStagePendingManager && !pastManagerForDriftTopUp {
		return nil, common.NewBadRequest("payment can only be recorded while the release request is at the Manager review stage")
	}
	if !checkStagePermission(ctx, in.ActorRoleID, "can verify release checklist") {
		return nil, common.NewForbidden("Access denied")
	}
	if in.Discount < 0 || in.Amount < 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	chargeDelta := common.RoundMoney(req.Charges - req.ChargesApplied)
	if chargeDelta < 0 {
		chargeDelta = 0
	}
	wasAlreadyRecorded := req.PaymentRecorded
	if in.Discount > 0 {
		if _, err := SaveLoanPayment(ctx, req.LoanID, PaymentInput{
			Amount:               in.Discount,
			Type:                 models.PaymentTypeDiscount,
			PaidOn:               time.Now(),
			ReceivedByEmployeeID: &in.ActorEmployeeID,
			Description:          "Release discount",
		}); err != nil {
			return nil, err
		}
	}
	paymentType := in.Type
	if paymentType == "" {
		paymentType = models.PaymentTypePartial
	}
	paymentAmount := in.Amount
	if chargeDelta > 0.01 && paymentAmount <= 0 {
		paymentAmount = chargeDelta
	}
	if paymentAmount > 0 {
		if _, err := SaveLoanPayment(ctx, req.LoanID, PaymentInput{
			Amount:               paymentAmount,
			Type:                 paymentType,
			ProcessingFee:        chargeDelta,
			PaidOn:               time.Now(),
			ReceivedByEmployeeID: &in.ActorEmployeeID,
			CashAmount:           in.CashAmount,
			UpiAmount:            in.UpiAmount,
			BankTransferAmount:   in.BankTransferAmount,
			ChequeAmount:         in.ChequeAmount,
			BankID:               in.BankID,
			Method:               in.Method,
			Reference:            in.Reference,
			InterestOverride:     in.InterestOverride,
			Description:          "Release payment",
		}); err != nil {
			return nil, err
		}
		req.ChargesApplied = common.RoundMoney(req.ChargesApplied + chargeDelta)
	}
	l, err := GetLoan(ctx, req.LoanID, branchID)
	if err != nil {
		return nil, err
	}
	req.RecordedDiscount = common.RoundMoney(req.RecordedDiscount + in.Discount)
	req.RecordedPayment = common.RoundMoney(req.RecordedPayment + in.Amount)
	if req.IsPartial {
		req.PaymentDueDate = nil
	} else if l.TotalOutstandingBalance <= 0.01 {
		req.PaymentDueDate = nil
	} else if in.Discount <= 0 && paymentAmount <= 0 {
	} else if in.DueDate == nil {
		return nil, common.NewBadRequest("a due date is required when the recorded amount doesn't cover the full settlement")
	} else {
		req.PaymentDueDate = in.DueDate
	}
	req.PaymentRecorded = true
	req.Locked = true
	if err := persistLoanRequest(ctx, req); err != nil {
		return nil, err
	}
	stillAtPaymentStage := req.ApprovalStage == "" || req.ApprovalStage == models.ApprovalStagePendingManager
	if !wasAlreadyRecorded || stillAtPaymentStage {
		if _, err := advanceReleaseRequestStage(ctx, req, in.ActorEmployeeID, "Auto-advanced after payment was recorded"); err != nil {
			return nil, err
		}
	}
	return findLoanRequestByID(ctx, req.ID)
}

func ApproveReleaseRequest(ctx context.Context, requestID uint, branchID *uint, in ReleaseApprovalInput) (*models.LoanRequest, error) {
	req, err := findLoanRequestByID(ctx, requestID)
	if err != nil {
		return nil, common.NewNotFound("loan request not found")
	}
	if err := checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != models.RequestTypeRelease {
		return nil, common.NewBadRequest("this request is not a Release request")
	}
	if in.Action != models.ApprovalStageApproved && in.Action != models.ApprovalStageRejected {
		return nil, common.NewBadRequest("action must be Approved or Rejected")
	}
	if req.ApprovalStage == models.ApprovalStageApproved || req.ApprovalStage == models.ApprovalStageRejected {
		return nil, common.NewBadRequest("loan request has already been decided")
	}
	if in.Action == models.ApprovalStageRejected && req.Locked {
		return nil, common.NewConflict("this release request is locked after payment — it can no longer be rejected or have its checklist changed")
	}
	if in.Action == models.ApprovalStageApproved && !req.CustomerSawGold {
		return nil, common.NewBadRequest("\"Customer has seen the gold\" must be ticked and a payment recorded before this can be approved")
	}
	if in.Action == models.ApprovalStageApproved && !req.PaymentRecorded {
		l, err := GetLoan(ctx, req.LoanID, nil)
		if err != nil {
			return nil, err
		}
		conditionAlreadyMet := false
		if req.IsPartial {
			remainingGoldValue, gvErr := partialReleaseRemainingGoldValue(ctx, req)
			if gvErr == nil && partialReleaseDrift(l.TotalOutstandingBalance, remainingGoldValue, l.SchemeLTVPercent) <= 0.01 {
				conditionAlreadyMet = true
			}
		} else if l.TotalOutstandingBalance <= 0.01 {
			conditionAlreadyMet = true
		}
		if !conditionAlreadyMet {
			return nil, common.NewBadRequest("\"Customer has seen the gold\" must be ticked and a payment recorded before this can be approved")
		}
	}
	stage := req.ApprovalStage
	if stage == "" {
		stage = models.ApprovalStagePendingManager
	}
	chain, err := loanChain(ctx, common.FlowLoanRelease)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(stage)
	if !ok || in.Stage != step.Key {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	if !common.CanAct(ctx, in.ActorRoleID, common.FlowLoanRelease, step.Key) {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
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
			notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Release Rejected", brandedMessage(ctx,
				"Dear %s, your gold release request for loan %s has been rejected. Please contact the branch for details. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), "release_request", "loan_request", req.ID)
		}
		return findLoanRequestByID(ctx, req.ID)
	}
	return advanceReleaseRequestStage(ctx, req, in.ActorEmployeeID, in.Remarks)
}

func advanceReleaseRequestStage(ctx context.Context, req *models.LoanRequest, actorEmployeeID uint, remarks string) (*models.LoanRequest, error) {
	stage := req.ApprovalStage
	if stage == "" {
		stage = models.ApprovalStagePendingManager
	}
	preApprovalStage, preStatus := req.ApprovalStage, req.Status
	notifyLoan, _ := findLoanByID(ctx, req.LoanID)
	chain, err := loanChain(ctx, common.FlowLoanRelease)
	if err != nil {
		return nil, err
	}
	cur, ok := chain.ByPending(stage)
	if !ok && !chain.Off() {
		return nil, common.NewBadRequest("approval action does not match the loan's current approval stage")
	}
	next, hasNext := chain.Next(cur.Key)
	finalApproval := false
	switch {
	case hasNext:
		req.ApprovalStage = next.Pending
	default:
		l, err := GetLoan(ctx, req.LoanID, nil)
		if err != nil {
			return nil, err
		}
		if req.IsPartial {
			remainingGoldValue, err := partialReleaseRemainingGoldValue(ctx, req)
			if err != nil {
				return nil, err
			}
			drift := partialReleaseDrift(l.TotalOutstandingBalance, remainingGoldValue, l.SchemeLTVPercent)
			if drift > 0.01 {
				return nil, common.NewConflict("outstanding balance has drifted above what the remaining collateral supports — record a top-up payment before approving")
			}
		}
		req.ApprovalStage = models.ApprovalStageApproved
		finalApproval = true
		req.SettlementAmount = l.TotalOutstandingBalance + req.Charges
		if !req.IsPartial {
			l.Status = models.StatusClosureRequested
			if err := persistLoan(ctx, l); err != nil {
				return nil, err
			}
		}
		req.Status = models.RequestStatusApproved
		now := time.Now()
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &actorEmployeeID
		req.Remarks = remarks
		if err := persistLoanRequest(ctx, req); err != nil {
			return nil, err
		}
		if _, err := completeRelease(ctx, req.LoanID, nil, actorEmployeeID); err != nil {
			req.ApprovalStage = preApprovalStage
			req.Status = preStatus
			req.DecidedAt = nil
			req.DecidedByEmployeeID = nil
			if rbErr := persistLoanRequest(ctx, req); rbErr != nil {
				log.Printf("could not roll back release request %d to %s after CompleteRelease failed: %v", req.ID, preStatus, rbErr)
			}
			return nil, err
		}
	}
	if err := persistLoanRequest(ctx, req); err != nil {
		return nil, err
	}
	if notifyLoan != nil {
		if finalApproval {
			notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Release Approved", brandedMessage(ctx,
				"Dear %s, your gold release request for loan %s has been fully approved. Closure is now being processed. — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber,
			), "release_request", "loan_request", req.ID)
		} else {
			notifyCustomer(ctx, notifyLoan.CustomerID, notifyLoan.Customer.Phone, "Release Approved", brandedMessage(ctx,
				"Dear %s, your gold release request for loan %s has moved to the next approval stage (%s). — CloudHouse Finance",
				notifyLoan.Customer.Name, notifyLoan.LoanNumber, next.Label,
			), "release_request", "loan_request", req.ID)
		}
	}
	return findLoanRequestByID(ctx, req.ID)
}

func partialReleaseRemainingGoldValue(ctx context.Context, req *models.LoanRequest) (float64, error) {
	all, err := findAllByLoanID(ctx, req.LoanID)
	if err != nil {
		return 0, err
	}
	selected := make(map[uint]bool, len(req.OrnamentSelections))
	for _, sel := range req.OrnamentSelections {
		selected[sel.OrnamentID] = true
	}
	var remaining float64
	for _, o := range all {
		if o.ReleasedAt != nil {
			continue
		}
		if !selected[o.ID] {
			remaining += o.GoldValue
		}
	}
	return remaining, nil
}

func completeRelease(ctx context.Context, loanID uint, branchID *uint, employeeID uint) (*models.Loan, error) {
	l, err := GetLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, err
	}
	if l.BankPledgeStatus == models.BankPledgeStatusPledged {
		return nil, common.NewBadRequest("gold is still pledged to a bank — release the bank pledge before releasing it to the customer")
	}
	hasActivePledge, err := hasActive(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if hasActivePledge {
		return nil, common.NewBadRequest("gold is still pledged to a bank — release the bank pledge before releasing it to the customer")
	}
	paidInFull := l.TotalOutstandingBalance <= 0.01
	var approved *models.LoanRequest
	if !paidInFull {
		approved, err = findApprovedReleaseByLoanID(ctx, loanID)
		if err != nil {
			return nil, common.NewNotFound("this loan has no approved release request")
		}
	} else if a, err := findApprovedReleaseByLoanID(ctx, loanID); err == nil {
		approved = a
	}
	if approved != nil && approved.IsPartial {
		return completePartialRelease(ctx, l, approved)
	}
	if l.TotalOutstandingBalance > 0.01 {
		return nil, common.NewBadRequest("the final settlement has not been fully paid yet — record the remaining payment before releasing the gold")
	}
	if err := packet.RecordGoldReleaseMovement(ctx, loanID, "Gold released to customer"); err != nil {
		log.Printf("packet gold-release movement failed for loan %d: %v", loanID, err)
	}
	l.Status = models.StatusClosed
	if err := persistLoan(ctx, l); err != nil {
		return nil, err
	}
	if pending, findErr := findPendingReleaseByLoanID(ctx, loanID); findErr == nil {
		now := time.Now()
		pending.Status = models.RequestStatusApproved
		pending.ApprovalStage = models.ApprovalStageApproved
		pending.SettlementAmount = pending.Charges
		pending.DecidedAt = &now
		pending.DecidedByEmployeeID = &employeeID
		if pending.Remarks == "" {
			pending.Remarks = "Auto-resolved — balance was paid in full and the release completed directly, without this request's own checklist/approval chain."
		}
		if err := persistLoanRequest(ctx, pending); err != nil {
			log.Printf("could not auto-resolve pending release request %d for loan %d: %v", pending.ID, loanID, err)
		}
	}
	return GetLoan(ctx, l.ID, nil)
}

func completePartialRelease(ctx context.Context, l *models.Loan, approved *models.LoanRequest) (*models.Loan, error) {
	selected := make(map[uint]bool, len(approved.OrnamentSelections))
	for _, sel := range approved.OrnamentSelections {
		selected[sel.OrnamentID] = true
	}
	if len(selected) == 0 {
		return nil, common.NewNotFound("this loan has no approved release request")
	}
	all, err := findAllByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	var releasedGross, releasedNet float64
	releasedCount := 0
	for i := range all {
		o := &all[i]
		if !selected[o.ID] || o.ReleasedAt != nil {
			continue
		}
		o.ReleasedAt = &now
		if err := persistOrnament(ctx, o); err != nil {
			return nil, err
		}
		releasedGross += o.GrossWeight
		releasedNet += o.NetWeight
		releasedCount++
	}
	{
		remarks := fmt.Sprintf("Partial release: %d ornament(s) handed back to customer", releasedCount)
		if err := packet.RecordPartialGoldReleaseMovement(ctx, l.ID, releasedGross, releasedNet, remarks); err != nil {
			log.Printf("packet partial gold-release movement failed for loan %d: %v", l.ID, err)
		}
	}
	if _, err := recalculateAndSave(ctx, l); err != nil {
		return nil, err
	}
	return GetLoan(ctx, l.ID, nil)
}

func pledgeReleaseRemark(treatment string) string {
	if treatment == models.BankPledgeCashTreatmentCashIn {
		return "Pledged amount booked back out of Cash-in-Hand"
	}
	return "No cash effect — pledge was recorded only"
}

func findApprovedReleaseByLoanID(ctx context.Context, loanID uint) (*models.LoanRequest, error) {
	var req models.LoanRequest
	err := config.DB.
		WithContext(ctx).Preload("Loan.Customer").Preload("OrnamentSelections").
		Where("loan_id = ? AND type = ? AND status = ?", loanID, models.RequestTypeRelease, models.RequestStatusApproved).
		Order("id desc").First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

func findPendingReleaseByLoanID(ctx context.Context, loanID uint) (*models.LoanRequest, error) {
	var req models.LoanRequest
	err := config.DB.
		WithContext(ctx).Preload("Loan.Customer").
		Where("loan_id = ? AND type = ? AND status = ?", loanID, models.RequestTypeRelease, models.RequestStatusPending).
		Order("id desc").First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

func CreateReleaseRequest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req releaseRequestRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := SaveReleaseRequest(ctx, loanID, ReleaseRequestInput{
		Detail:      req.Detail,
		RequestedBy: req.RequestedBy,
		OrnamentIDs: req.OrnamentIDs,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func VerifyReleaseChecklist(c echo.Context) error {
	ctx := auth.RequestContext(c)
	requestID, err := common.IDParam(c, "request_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var raw map[string]any
	if err := json.NewDecoder(c.Request().Body).Decode(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	var customerSawGold *bool
	if v, ok := raw["customer_saw_gold"]; ok {
		b, _ := v.(bool)
		customerSawGold = &b
	}
	var verificationNotes *string
	if v, ok := raw["verification_notes"]; ok {
		s, _ := v.(string)
		verificationNotes = &s
	}
	var charges *float64
	if v, ok := raw["charges"]; ok {
		f, _ := v.(float64)
		charges = &f
	}
	_, _, actorRoleID := auth.ActorFromContext(c)
	rec, err := SaveReleaseChecklist(ctx, requestID, auth.GetBranchScope(c), ChecklistInput{
		CustomerSawGold:   customerSawGold,
		VerificationNotes: verificationNotes,
		Charges:           charges,
		ActorRoleID:       actorRoleID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func RecordReleasePayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	requestID, err := common.IDParam(c, "request_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req releasePaymentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	var dueDate *time.Time
	if req.DueDate != "" {
		d, err := parseDate(req.DueDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid due_date: expected YYYY-MM-DD"})
		}
		dueDate = &d
	}
	actorEmployeeID, _, actorRoleID := auth.ActorFromContext(c)
	rec, err := recordReleaseRequestPayment(ctx, requestID, auth.GetBranchScope(c), ReleasePaymentInput{
		Type:               req.Type,
		Amount:             req.Amount,
		Discount:           req.Discount,
		CashAmount:         req.CashAmount,
		UpiAmount:          req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount,
		ChequeAmount:       req.ChequeAmount,
		BankID:             req.BankID,
		Method:             req.Method,
		Reference:          req.Reference,
		InterestOverride:   req.InterestOverride,
		DueDate:            dueDate,
		ActorEmployeeID:    actorEmployeeID,
		ActorRoleID:        actorRoleID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func CompleteRelease(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	rec, err := completeRelease(ctx, loanID, auth.GetBranchScope(c), actorEmployeeID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

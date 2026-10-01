package loan

import (
	"context"
	"time"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/workflow"
)

var (
	ErrInvalidWaiverType  = httpx.NewBadRequest("type must be \"Waiver\" or \"Adjustment\"")
	ErrWaiverReason       = httpx.NewBadRequest("a reason is required")
	ErrWaiverExceedsOwed  = httpx.NewBadRequest("a waiver cannot exceed the interest and penal interest currently owed")
	ErrAdjustmentTooLarge = httpx.NewBadRequest("an adjustment cannot exceed the principal currently outstanding")
	ErrNotWaiverRequest   = httpx.NewBadRequest("request is not a waiver/adjustment request")
)

// WaiverRequestInput mirrors the body of POST /loans/:id/waiver-request.
type WaiverRequestInput struct {
	Type            string // RequestTypeWaiver | RequestTypeAdjustment
	Amount          float64
	Reason          string
	ActorEmployeeID uint
}

// WaiverApprovalInput mirrors the body of POST /loans/requests/:id/approve
// for a Waiver/Adjustment request.
type WaiverApprovalInput struct {
	Stage           string // workflow.FlowLoanWaiver stage key
	Action          string // "Approved" | "Rejected"
	ActorEmployeeID uint
	ActorRoleID     uint
	Remarks         string
}

// checkWaiverCap refuses an amount the loan could not absorb right now:
// Waiver forgives only penal + interest owed, Adjustment only principal.
func (s *Service) checkWaiverCap(ctx context.Context, l *Loan, reqType string, amount float64) error {
	s.accrueAndSave(ctx, l)
	s.enrich(ctx, l)
	switch reqType {
	case RequestTypeWaiver:
		if amount > platform.RoundMoney(l.OutstandingInterest+l.OutstandingPenalInterest)+moneyEpsilon {
			return ErrWaiverExceedsOwed
		}
	case RequestTypeAdjustment:
		if amount > platform.RoundMoney(l.OutstandingAmount)+moneyEpsilon {
			return ErrAdjustmentTooLarge
		}
	}
	return nil
}

// CreateWaiverRequest raises a Waiver/Adjustment request on a loan. With the
// tenant's waiver approval chain switched off it is posted immediately.
func (s *Service) CreateWaiverRequest(ctx context.Context, loanID uint, branchID *uint, in WaiverRequestInput) (*LoanRequest, error) {
	if in.Type != RequestTypeWaiver && in.Type != RequestTypeAdjustment {
		return nil, ErrInvalidWaiverType
	}
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.Reason == "" {
		return nil, ErrWaiverReason
	}
	if err := s.checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, ErrNotFound
	}
	if isLoanTerminal(l.Status) || l.Status == StatusPendingApproval {
		return nil, ErrLoanTerminalState
	}
	amount := platform.RoundMoney(in.Amount)
	if err := s.checkWaiverCap(ctx, l, in.Type, amount); err != nil {
		return nil, err
	}

	chain, err := s.chain(ctx, workflow.FlowLoanWaiver)
	if err != nil {
		return nil, err
	}
	first, needsApproval := chain.First()
	req := &LoanRequest{
		LoanID:        loanID,
		Type:          in.Type,
		Status:        RequestStatusPending,
		RequestedBy:   RequestedByStaff,
		Detail:        in.Reason,
		Amount:        amount,
		ApprovalStage: first.Pending,
		RequestedAt:   time.Now(),
	}
	if err := s.requestRepo.Create(ctx, req); err != nil {
		return nil, err
	}
	if !needsApproval {
		actor := in.ActorEmployeeID
		if err := s.postWaiver(ctx, req, &actor, "Posted immediately — no waiver approval stages configured"); err != nil {
			return nil, err
		}
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

// postWaiver is a Waiver/Adjustment request's final approval: it posts the
// non-cash payment (no cash movement — see isCashPaymentType) and marks the
// request Approved. The cap is re-checked, since interest/principal can have
// moved while the request waited.
func (s *Service) postWaiver(ctx context.Context, req *LoanRequest, actorEmployeeID *uint, remarks string) error {
	l, err := s.repo.FindByID(ctx, req.LoanID)
	if err != nil {
		return ErrNotFound
	}
	if isLoanTerminal(l.Status) {
		return ErrLoanTerminalState
	}
	if err := s.checkWaiverCap(ctx, l, req.Type, req.Amount); err != nil {
		return err
	}
	paymentType := PaymentTypeWaiver
	if req.Type == RequestTypeAdjustment {
		paymentType = PaymentTypeAdjustment
	}
	if _, err := s.RecordPayment(ctx, req.LoanID, PaymentInput{
		Amount:               req.Amount,
		Type:                 paymentType,
		PaidOn:               time.Now(),
		ReceivedByEmployeeID: actorEmployeeID,
		Description:          req.Detail,
	}); err != nil {
		return err
	}
	now := time.Now()
	req.Status = RequestStatusApproved
	req.ApprovalStage = ApprovalStageApproved
	req.DecidedAt = &now
	req.DecidedByEmployeeID = actorEmployeeID
	req.Remarks = remarks
	return s.requestRepo.Update(ctx, req)
}

// ApproveWaiverRequest advances (or rejects) a Waiver/Adjustment request
// through the tenant's waiver approval chain; the final enabled stage posts it.
func (s *Service) ApproveWaiverRequest(ctx context.Context, requestID uint, branchID *uint, in WaiverApprovalInput) (*LoanRequest, error) {
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, ErrRequestNotFound
	}
	if err := s.checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != RequestTypeWaiver && req.Type != RequestTypeAdjustment {
		return nil, ErrNotWaiverRequest
	}
	if in.Action != ApprovalStageApproved && in.Action != ApprovalStageRejected {
		return nil, ErrInvalidAction
	}
	if req.Status != RequestStatusPending {
		return nil, ErrRequestAlreadyDecided
	}
	chain, err := s.chain(ctx, workflow.FlowLoanWaiver)
	if err != nil {
		return nil, err
	}
	step, ok := chain.ByPending(req.ApprovalStage)
	if !ok || in.Stage != step.Key {
		return nil, ErrWrongStage
	}
	if !s.workflowSvc.CanAct(ctx, in.ActorRoleID, workflow.FlowLoanWaiver, step.Key) {
		return nil, ErrWrongStage
	}

	actor := in.ActorEmployeeID
	next, hasNext := chain.Next(step.Key)
	switch {
	case in.Action == ApprovalStageRejected:
		now := time.Now()
		req.Status = RequestStatusRejected
		req.ApprovalStage = ApprovalStageRejected
		req.DecidedAt = &now
		req.DecidedByEmployeeID = &actor
		req.Remarks = in.Remarks
		if err := s.requestRepo.Update(ctx, req); err != nil {
			return nil, err
		}
	case hasNext:
		req.ApprovalStage = next.Pending
		if err := s.requestRepo.Update(ctx, req); err != nil {
			return nil, err
		}
	default:
		if err := s.postWaiver(ctx, req, &actor, in.Remarks); err != nil {
			return nil, err
		}
	}

	if err := s.requestApprovalRepo.Create(ctx, &RequestApproval{
		RequestID:       requestID,
		Stage:           in.Stage,
		Action:          in.Action,
		ActorEmployeeID: in.ActorEmployeeID,
		Remarks:         in.Remarks,
	}); err != nil {
		return nil, err
	}
	return s.requestRepo.FindByID(ctx, req.ID)
}

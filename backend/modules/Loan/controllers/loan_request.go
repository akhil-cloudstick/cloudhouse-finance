package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"net/http"
	"strconv"
	"strings"

	"gorm.io/gorm"

	"github.com/labstack/echo/v4"
)

type loanRequest struct {
	BranchID          uint              `json:"branch_id" binding:"required"`
	CustomerID        uint              `json:"customer_id" binding:"required"`
	SchemeID          uint              `json:"scheme_id" binding:"required"`
	OpenedDate        string            `json:"opened_date" binding:"required"`
	DueDate           string            `json:"due_date" binding:"required"`
	PrincipalAmount   float64           `json:"principal_amount" binding:"required"`
	Ornaments         []ornamentRequest `json:"ornaments" binding:"required,min=1"`
	LockerID          *uint             `json:"locker_id"`
	AdditionalInfo    string            `json:"additional_info"`
	ServiceChargeMode string            `json:"service_charge_mode"`
	OverallPhotoURL   string            `json:"overall_photo_url"`
	DraftID           *uint             `json:"draft_id"`
}

type updateLoanRequest struct {
	SchemeID        *uint    `json:"scheme_id"`
	PrincipalAmount *float64 `json:"principal_amount"`
	OverallPhotoURL *string  `json:"overall_photo_url"`
}

type purityTestRequest struct {
	TestedPurity          string  `json:"tested_purity" binding:"required"`
	TestedGrossWeight     float64 `json:"tested_gross_weight" binding:"required"`
	TestedDeductionWeight float64 `json:"tested_deduction_weight"`
	TestingRemarks        string  `json:"testing_remarks"`
	TestedBy              string  `json:"tested_by" binding:"required"`
	TestedAt              string  `json:"tested_at" binding:"required"`
}

type decideRequestRequest struct {
	Action  string `json:"action" binding:"required"`
	Remarks string `json:"remarks"`
}

type LoanRequestFilter struct {
	Status   string
	LoanID   uint
	Type     string
	Query    string
	BranchID *uint
	Limit    int
	Offset   int
}

func listRequests(ctx context.Context, f LoanRequestFilter) ([]models.LoanRequest, int64, error) {
	reqs, total, err := FindLoanRequests(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	return reqs, total, nil
}

func getRequest(ctx context.Context, requestID uint) (*models.LoanRequest, error) {
	req, err := findLoanRequestByID(ctx, requestID)
	if err != nil {
		return nil, common.NewNotFound("loan request not found")
	}
	return req, nil
}

func decideRequest(ctx context.Context, requestID uint, branchID *uint, approve bool, decidedByEmployeeID uint, remarks string) (*models.LoanRequest, error) {
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
	return nil, common.NewBadRequest("extension requests are now decided through the staged approval chain — use POST /loans/requests/:requestId/approve instead")
}

func findByRequestID(ctx context.Context, requestID uint) ([]models.RequestApproval, error) {
	var approvals []models.RequestApproval
	err := config.DB.
		WithContext(ctx).Where("request_id = ?", requestID).Order("id asc").Find(&approvals).Error
	return approvals, err
}

func (req loanRequest) toInput() (CreateInput, error) {
	opened, err := parseDate(req.OpenedDate)
	if err != nil {
		return CreateInput{}, common.NewBadRequest("invalid opened_date: expected YYYY-MM-DD")
	}
	due, err := parseDate(req.DueDate)
	if err != nil {
		return CreateInput{}, common.NewBadRequest("invalid due_date: expected YYYY-MM-DD")
	}
	ornaments := make([]OrnamentInput, len(req.Ornaments))
	for i, o := range req.Ornaments {
		ornaments[i] = o.toInput()
	}
	return CreateInput{
		BranchID:          req.BranchID,
		CustomerID:        req.CustomerID,
		SchemeID:          req.SchemeID,
		OpenedDate:        opened,
		DueDate:           due,
		PrincipalAmount:   req.PrincipalAmount,
		Ornaments:         ornaments,
		LockerID:          req.LockerID,
		AdditionalInfo:    req.AdditionalInfo,
		ServiceChargeMode: req.ServiceChargeMode,
		OverallPhotoURL:   req.OverallPhotoURL,
	}, nil
}

func insertLoanRequest(ctx context.Context, req *models.LoanRequest) error {
	return config.DB.
		WithContext(ctx).Create(req).Error
}

func persistLoanRequest(ctx context.Context, req *models.LoanRequest) error {
	return config.DB.
		WithContext(ctx).Save(req).Error
}

func findLoanRequestByID(ctx context.Context, id uint) (*models.LoanRequest, error) {
	var req models.LoanRequest
	if err := config.DB.
		WithContext(ctx).Preload("Loan.Customer").Preload("OrnamentSelections").First(&req, id).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

func FindLoanRequests(ctx context.Context, f LoanRequestFilter) ([]models.LoanRequest, int64, error) {
	q := config.DB.
		WithContext(ctx).Preload("Loan.Customer").Model(&models.LoanRequest{}).Order("loan_requests.id desc")
	if f.BranchID != nil || f.Query != "" {
		q = q.Joins("JOIN loans ON loans.id = loan_requests.loan_id")
	}
	if f.BranchID != nil {
		q = q.Where("loans.branch_id = ?", *f.BranchID)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("JOIN customers ON customers.id = loans.customer_id").
			Where("loans.loan_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ? OR customers.phone ILIKE ?", like, like, like, like)
	}
	if f.Type != "" {
		q = q.Where("loan_requests.type = ?", f.Type)
	}
	q = q.Where("loan_requests.type NOT IN ?", []string{"Waiver", "Adjustment"})
	if f.Status != "" {
		q = q.Where("loan_requests.status = ?", f.Status)
	}
	if f.LoanID != 0 {
		q = q.Where("loan_requests.loan_id = ?", f.LoanID)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	var reqs []models.LoanRequest
	err := q.Find(&reqs).Error
	return reqs, total, err
}

func ListRequests(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	f := LoanRequestFilter{Status: c.QueryParam("status"), Query: strings.TrimSpace(c.QueryParam("search"))}
	switch strings.ToLower(strings.TrimSpace(c.QueryParam("type"))) {
	case "":
	case "extension":
		f.Type = models.RequestTypeExtension
	case "release":
		f.Type = models.RequestTypeRelease
	default:
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid type: expected extension or release"})
	}
	if v := c.QueryParam("loan_id"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LoanID = uint(id)
		}
	}
	f.BranchID = auth.GetBranchScope(c)
	if limit > 0 {
		f.Limit, f.Offset = limit, offset
		rec, total, err := listRequests(ctx, f)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := listRequests(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func DecideRequest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	requestID, err := common.IDParam(c, "request_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req decideRequestRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	var approve bool
	switch req.Action {
	case models.ApprovalStageApproved:
		approve = true
	case models.ApprovalStageRejected:
		approve = false
	default:
		return common.FailErr(c, common.NewBadRequest("action must be Approved or Rejected"))
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	rec, err := decideRequest(ctx, requestID, auth.GetBranchScope(c), approve, actorEmployeeID, req.Remarks)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

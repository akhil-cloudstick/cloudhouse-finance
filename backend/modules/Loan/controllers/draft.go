package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"

	"gorm.io/gorm"
)

type DraftOrnamentInput struct {
	Name        string
	Purity      string
	GrossWeight float64
	Quantity    int
	ImageURL    string
	ImageName   string
}

type DraftInput struct {
	BranchID          uint
	CustomerID        *uint
	SchemeID          *uint
	LockerID          *uint
	PrincipalOverride *float64
	Ornaments         []DraftOrnamentInput
}

type draftOrnamentRequest struct {
	Name        string  `json:"name"`
	Purity      string  `json:"purity"`
	GrossWeight float64 `json:"gross_weight"`
	Quantity    int     `json:"quantity"`
	ImageURL    string  `json:"image_url"`
	ImageName   string  `json:"image_name"`
}

type draftRequest struct {
	BranchID          uint                   `json:"branch_id" binding:"required"`
	CustomerID        *uint                  `json:"customer_id"`
	SchemeID          *uint                  `json:"scheme_id"`
	LockerID          *uint                  `json:"locker_id"`
	PrincipalOverride *float64               `json:"principal_override"`
	Ornaments         []draftOrnamentRequest `json:"ornaments"`
}

func SaveDraft(ctx context.Context, actorEmployeeID uint, in DraftInput) (*models.LoanDraft, error) {
	if in.BranchID == 0 {
		return nil, common.NewBadRequest("branch_id is required to save a draft")
	}
	if _, err := common.FindBranchByID(ctx, in.BranchID); err != nil {
		return nil, common.NewBadRequest("branch does not exist")
	}
	d := &models.LoanDraft{
		CreatedByEmployeeID: actorEmployeeID,
		BranchID:            in.BranchID,
		CustomerID:          in.CustomerID,
		SchemeID:            in.SchemeID,
		LockerID:            in.LockerID,
		PrincipalOverride:   in.PrincipalOverride,
		Ornaments:           in.toOrnamentRows(),
	}
	if err := insertDraft(ctx, d); err != nil {
		return nil, err
	}
	return findDraftByID(ctx, d.ID)
}

func updateDraft(ctx context.Context, draftID, actorEmployeeID uint, in DraftInput) (*models.LoanDraft, error) {
	existing, err := getOwnDraft(ctx, draftID, actorEmployeeID)
	if err != nil {
		return nil, err
	}
	if in.BranchID == 0 {
		return nil, common.NewBadRequest("branch_id is required to save a draft")
	}
	if in.BranchID != existing.BranchID {
		if _, err := common.FindBranchByID(ctx, in.BranchID); err != nil {
			return nil, common.NewBadRequest("branch does not exist")
		}
	}
	existing.BranchID = in.BranchID
	existing.CustomerID = in.CustomerID
	existing.SchemeID = in.SchemeID
	existing.LockerID = in.LockerID
	existing.PrincipalOverride = in.PrincipalOverride
	existing.Ornaments = in.toOrnamentRows()
	if err := draftReplace(ctx, existing); err != nil {
		return nil, err
	}
	return findDraftByID(ctx, existing.ID)
}

func listDrafts(ctx context.Context, actorEmployeeID uint, branchScope *uint) ([]models.LoanDraft, error) {
	return findAllByEmployee(ctx, actorEmployeeID, branchScope)
}

func getDraft(ctx context.Context, draftID, actorEmployeeID uint) (*models.LoanDraft, error) {
	return getOwnDraft(ctx, draftID, actorEmployeeID)
}

func deleteDraft(ctx context.Context, draftID, actorEmployeeID uint) error {
	if _, err := getOwnDraft(ctx, draftID, actorEmployeeID); err != nil {
		return err
	}
	return removeDraft(ctx, draftID)
}

func deleteDraftQuietly(ctx context.Context, draftID, actorEmployeeID uint) {
	if draftID == 0 {
		return
	}
	if err := deleteDraft(ctx, draftID, actorEmployeeID); err != nil {
		log.Printf("loan: could not delete draft %d after submission: %v", draftID, err)
	}
}

func getOwnDraft(ctx context.Context, draftID, actorEmployeeID uint) (*models.LoanDraft, error) {
	d, err := findDraftByID(ctx, draftID)
	if err != nil {
		return nil, common.NewNotFound("loan draft not found")
	}
	if d.CreatedByEmployeeID != actorEmployeeID {
		return nil, common.NewNotFound("loan draft not found")
	}
	return d, nil
}

func preloadDraft(db *gorm.DB) *gorm.DB {
	return db.
		Preload("Branch").
		Preload("Customer").
		Preload("Scheme").
		Preload("Ornaments", func(db *gorm.DB) *gorm.DB {
			return db.Order("position asc, id asc")
		})
}

func (req draftRequest) toInput() DraftInput {
	ornaments := make([]DraftOrnamentInput, len(req.Ornaments))
	for i, o := range req.Ornaments {
		ornaments[i] = DraftOrnamentInput{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			Quantity:    o.Quantity,
			ImageURL:    o.ImageURL,
			ImageName:   o.ImageName,
		}
	}
	return DraftInput{
		BranchID:          req.BranchID,
		CustomerID:        req.CustomerID,
		SchemeID:          req.SchemeID,
		LockerID:          req.LockerID,
		PrincipalOverride: req.PrincipalOverride,
		Ornaments:         ornaments,
	}
}

func insertDraft(ctx context.Context, d *models.LoanDraft) error {
	return config.DB.
		WithContext(ctx).Create(d).Error
}

func draftReplace(ctx context.Context, d *models.LoanDraft) error {
	return config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("draft_id = ?", d.ID).Delete(&models.LoanDraftOrnament{}).Error; err != nil {
			return err
		}
		if err := tx.Omit("Ornaments", "Branch", "Customer", "Scheme").Save(d).Error; err != nil {
			return err
		}
		for i := range d.Ornaments {
			d.Ornaments[i].ID = 0
			d.Ornaments[i].DraftID = d.ID
			if err := tx.Create(&d.Ornaments[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func findDraftByID(ctx context.Context, id uint) (*models.LoanDraft, error) {
	var d models.LoanDraft
	if err := preloadDraft(config.DB.
		WithContext(ctx)).First(&d, id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

func findAllByEmployee(ctx context.Context, employeeID uint, branchScope *uint) ([]models.LoanDraft, error) {
	q := preloadDraft(config.DB.
		WithContext(ctx)).Model(&models.LoanDraft{}).
		Where("created_by_employee_id = ?", employeeID).
		Order("updated_at desc")
	if branchScope != nil {
		q = q.Where("branch_id = ?", *branchScope)
	}
	var drafts []models.LoanDraft
	err := q.Find(&drafts).Error
	return drafts, err
}

func removeDraft(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("draft_id = ?", id).Delete(&models.LoanDraftOrnament{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.LoanDraft{}, id).Error
	})
}

func SaveLoanDraft(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req draftRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	input := req.toInput()
	input.BranchID = auth.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := SaveDraft(ctx, actorEmployeeID, input)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func UpdateLoanDraft(c echo.Context) error {
	ctx := auth.RequestContext(c)
	draftID, err := common.IDParam(c, "draft_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req draftRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	input := req.toInput()
	input.BranchID = auth.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := updateDraft(ctx, draftID, actorEmployeeID, input)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListLoanDrafts(c echo.Context) error {
	ctx := auth.RequestContext(c)
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	rec, err := listDrafts(ctx, actorEmployeeID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetLoanDraft(c echo.Context) error {
	ctx := auth.RequestContext(c)
	draftID, err := common.IDParam(c, "draft_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	rec, err := getDraft(ctx, draftID, actorEmployeeID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func DeleteLoanDraft(c echo.Context) error {
	ctx := auth.RequestContext(c)
	draftID, err := common.IDParam(c, "draft_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	if err := deleteDraft(ctx, draftID, actorEmployeeID); err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessMessage(c, http.StatusOK, "Draft deleted successfully")
}

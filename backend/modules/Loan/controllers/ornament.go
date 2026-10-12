package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/labstack/echo/v4"
)

type OrnamentInput struct {
	Name            string
	Purity          string
	GrossWeight     float64
	DeductionWeight float64
	Quantity        int
	Remarks         string
	Images          []string
}

type AddOrnamentInput = OrnamentInput

type UpdateOrnamentInput = OrnamentInput

type ornamentRequest struct {
	Name            string   `json:"name" binding:"required"`
	Purity          string   `json:"purity" binding:"required"`
	GrossWeight     float64  `json:"gross_weight" binding:"required"`
	DeductionWeight float64  `json:"deduction_weight"`
	Quantity        int      `json:"quantity"`
	Remarks         string   `json:"remarks"`
	Images          []string `json:"images"`
}

type ornamentImageRequest struct {
	ImageURL string `json:"image_url" binding:"required"`
}

type CustomerOrnamentRow struct {
	models.Ornament
	LoanNumber string `json:"loan_number"`
}

func valueOrnament(o *models.Ornament, gr *commonModels.GoldRate) error {
	if o.GrossWeight <= 0 {
		return common.NewBadRequest("gross weight must be greater than zero")
	}
	rate, err := rateForPurity(gr, o.Purity)
	if err != nil {
		return err
	}
	o.NetWeight = o.GrossWeight - o.DeductionWeight
	if o.NetWeight < 0 {
		o.NetWeight = 0
	}
	o.GoldValue = o.NetWeight * rate
	return nil
}

func addOrnament(ctx context.Context, loanID uint, in AddOrnamentInput) (*models.Loan, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	rate, err := common.FindLatest(ctx)
	if err != nil {
		return nil, common.NewBadRequest("no gold rate has been published yet")
	}
	o := models.Ornament{
		LoanID:          loanID,
		Name:            in.Name,
		Purity:          in.Purity,
		GrossWeight:     in.GrossWeight,
		DeductionWeight: in.DeductionWeight,
		Quantity:        in.Quantity,
		Remarks:         in.Remarks,
	}
	if o.Quantity <= 0 {
		o.Quantity = 1
	}
	if err := valueOrnament(&o, rate); err != nil {
		return nil, err
	}
	if err := insertOrnament(ctx, &o); err != nil {
		return nil, err
	}
	return recalculateAndSave(ctx, l)
}

func deleteOrnament(ctx context.Context, ornamentID uint) (*models.Loan, error) {
	o, err := findOrnamentByID(ctx, ornamentID)
	if err != nil {
		return nil, common.NewNotFound("ornament not found")
	}
	l, err := findLoanByID(ctx, o.LoanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	switch l.Status {
	case models.StatusClosed, models.StatusRejected, models.StatusAuctioned, models.StatusAuctionedBalanceDue:
		return nil, common.NewBadRequest("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	}
	existing, err := FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	if len(existing) <= 1 {
		return nil, common.NewBadRequest("at least one ornament is required")
	}
	if err := config.DB.
		WithContext(ctx).Where("ornament_id = ?", ornamentID).Delete(&models.OrnamentImage{}).Error; err != nil {
		return nil, err
	}
	if err := config.DB.
		WithContext(ctx).Where("ornament_id = ?", ornamentID).Delete(&models.OrnamentPurityTest{}).Error; err != nil {
		return nil, err
	}
	if err := config.DB.
		WithContext(ctx).Delete(&models.Ornament{}, ornamentID).Error; err != nil {
		return nil, err
	}
	return recalculateAndSave(ctx, l)
}

func updateOrnament(ctx context.Context, ornamentID uint, in UpdateOrnamentInput) (*models.Loan, error) {
	o, err := findOrnamentByID(ctx, ornamentID)
	if err != nil {
		return nil, common.NewNotFound("ornament not found")
	}
	rate, err := common.FindLatest(ctx)
	if err != nil {
		return nil, common.NewBadRequest("no gold rate has been published yet")
	}
	o.Name = in.Name
	o.Purity = in.Purity
	o.GrossWeight = in.GrossWeight
	o.DeductionWeight = in.DeductionWeight
	o.Quantity = in.Quantity
	o.Remarks = in.Remarks
	if o.Quantity <= 0 {
		o.Quantity = 1
	}
	if err := valueOrnament(o, rate); err != nil {
		return nil, err
	}
	if err := persistOrnament(ctx, o); err != nil {
		return nil, err
	}
	l, err := findLoanByID(ctx, o.LoanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	return recalculateAndSave(ctx, l)
}

func SaveOrnamentImage(ctx context.Context, ornamentID uint, imageURL string) (*models.Ornament, error) {
	if _, err := findOrnamentByID(ctx, ornamentID); err != nil {
		return nil, common.NewNotFound("ornament not found")
	}
	img := &models.OrnamentImage{OrnamentID: ornamentID, ImageURL: imageURL}
	if err := addImage(ctx, img); err != nil {
		return nil, err
	}
	return findOrnamentByID(ctx, ornamentID)
}

func listOrnamentsForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerOrnamentRow, int64, error) {
	if _, err := common.FindCustomerByID(ctx, customerID); err != nil {
		return nil, 0, common.NewBadRequest("customer does not exist")
	}
	return findOrnamentByCustomerID(ctx, customerID, from, to, search, limit, offset)
}

func (in DraftInput) toOrnamentRows() []models.LoanDraftOrnament {
	rows := make([]models.LoanDraftOrnament, len(in.Ornaments))
	for i, o := range in.Ornaments {
		rows[i] = models.LoanDraftOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			Quantity:    o.Quantity,
			ImageURL:    o.ImageURL,
			ImageName:   o.ImageName,
			ImageURLs:   o.ImageURLs,
			Position:    i,
		}
	}
	return rows
}

func createOrnamentSelections(ctx context.Context, requestID uint, ornamentIDs []uint) error {
	if len(ornamentIDs) == 0 {
		return nil
	}
	rows := make([]models.LoanRequestOrnament, len(ornamentIDs))
	for i, id := range ornamentIDs {
		rows[i] = models.LoanRequestOrnament{RequestID: requestID, OrnamentID: id}
	}
	return config.DB.
		WithContext(ctx).Create(&rows).Error
}

func (r ornamentRequest) toInput() OrnamentInput {
	return OrnamentInput{
		Name:            r.Name,
		Purity:          r.Purity,
		GrossWeight:     r.GrossWeight,
		DeductionWeight: r.DeductionWeight,
		Quantity:        r.Quantity,
		Remarks:         r.Remarks,
		Images:          r.Images,
	}
}

func insertOrnament(ctx context.Context, o *models.Ornament) error {
	return config.DB.
		WithContext(ctx).Create(o).Error
}

func persistOrnament(ctx context.Context, o *models.Ornament) error {
	return config.DB.
		WithContext(ctx).Save(o).Error
}

func findOrnamentByID(ctx context.Context, id uint) (*models.Ornament, error) {
	var o models.Ornament
	if err := config.DB.
		WithContext(ctx).Preload("PurityTest").Preload("Images").First(&o, id).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func FindByLoanID(ctx context.Context, loanID uint) ([]models.Ornament, error) {
	var ornaments []models.Ornament
	err := config.DB.
		WithContext(ctx).Preload("PurityTest").Preload("Images").
		Where("loan_id = ? AND released_at IS NULL", loanID).Order("id asc").Find(&ornaments).Error
	return ornaments, err
}

func findAllByLoanID(ctx context.Context, loanID uint) ([]models.Ornament, error) {
	var ornaments []models.Ornament
	err := config.DB.
		WithContext(ctx).Preload("PurityTest").Preload("Images").
		Where("loan_id = ?", loanID).Order("id asc").Find(&ornaments).Error
	return ornaments, err
}

func findOrnamentByCustomerID(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerOrnamentRow, int64, error) {
	var rows []CustomerOrnamentRow
	q := config.DB.
		WithContext(ctx).Model(&models.Ornament{}).
		Select("ornaments.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = ornaments.loan_id").
		Where("loans.customer_id = ? AND ornaments.released_at IS NULL", customerID)
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("loans.loan_number ILIKE ? OR ornaments.name ILIKE ?", like, like)
	}
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("loans.opened_date desc, loans.id desc, ornaments.id asc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, total, err
}

func insertPurityTest(ctx context.Context, t *models.OrnamentPurityTest) error {
	return config.DB.
		WithContext(ctx).Save(t).Error
}

func addImage(ctx context.Context, img *models.OrnamentImage) error {
	return config.DB.
		WithContext(ctx).Create(img).Error
}

func AddOrnament(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req ornamentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := addOrnament(ctx, loanID, req.toInput())
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func UpdateOrnament(c echo.Context) error {
	ctx := auth.RequestContext(c)
	ornamentID, err := common.IDParam(c, "ornament_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req ornamentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := updateOrnament(ctx, ornamentID, req.toInput())
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func DeleteOrnament(c echo.Context) error {
	ornamentID, err := common.IDParam(c, "ornament_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := deleteOrnament(auth.RequestContext(c), ornamentID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func AddOrnamentImage(c echo.Context) error {
	ctx := auth.RequestContext(c)
	ornamentID, err := common.IDParam(c, "ornament_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req ornamentImageRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := SaveOrnamentImage(ctx, ornamentID, req.ImageURL)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListOrnamentsForCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	customerID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !customerInScope(c, ctx, customerID) {
		return nil
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return nil
	}
	rec, total, err := listOrnamentsForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.QueryParam("search")), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

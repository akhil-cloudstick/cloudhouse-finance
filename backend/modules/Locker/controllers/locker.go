package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Locker/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

const occupiedSQL = "(SELECT COUNT(*) FROM packets WHERE packets.current_locker_id = lockers.id AND packets.status = 'Locker Stored')"

type createRequest struct {
	Code     string `json:"code" binding:"required"`
	BranchID uint   `json:"branch_id" binding:"required"`
	Capacity int    `json:"capacity" binding:"required"`
}

type updateRequest struct {
	Code     string `json:"code" binding:"required"`
	BranchID uint   `json:"branch_id" binding:"required"`
	Capacity int    `json:"capacity" binding:"required"`
	IsActive bool   `json:"is_active"`
}

type LockerFilter struct {
	BranchID        *uint
	FilterBranchID  *uint
	FilterBranchIDs []uint
	StatusIn        []string
	Q               string
	ActiveOnly      bool
	Status          string
	Limit           int
	Offset          int
}

type PacketCounter interface {
	CountActivePackets(ctx context.Context, lockerID uint) (int, error)
}

type CreateInput struct {
	Code     string
	BranchID uint
	Capacity int
}

type UpdateInput struct {
	Code     string
	BranchID uint
	Capacity int
	IsActive bool
}

type View struct {
	models.Locker
	Occupied int `json:"occupied"`
}

func insertLocker(ctx context.Context, l *models.Locker) error {
	return config.DB.
		WithContext(ctx).Create(l).Error
}

func findAllLockers(ctx context.Context, branchID *uint) ([]models.Locker, error) {
	lockers, _, err := findLockersFiltered(ctx, LockerFilter{BranchID: branchID})
	return lockers, err
}

func findLockersFiltered(ctx context.Context, f LockerFilter) ([]models.Locker, int64, error) {
	var lockers []models.Locker
	q := config.DB.
		WithContext(ctx).Preload("Branch").Model(&models.Locker{}).Order("lockers.code asc")
	if f.BranchID != nil {
		q = q.Where("lockers.branch_id = ?", *f.BranchID)
	}
	if f.FilterBranchID != nil {
		q = q.Where("lockers.branch_id = ?", *f.FilterBranchID)
	}
	if len(f.FilterBranchIDs) > 0 {
		q = q.Where("lockers.branch_id IN ?", f.FilterBranchIDs)
	}
	if len(f.StatusIn) > 0 {
		var conds []string
		for _, s := range f.StatusIn {
			switch s {
			case "inactive":
				conds = append(conds, "lockers.is_active = false")
			case "full":
				conds = append(conds, "(lockers.is_active = true AND "+occupiedSQL+" >= lockers.capacity)")
			case "active":
				conds = append(conds, "(lockers.is_active = true AND "+occupiedSQL+" < lockers.capacity)")
			}
		}
		if len(conds) > 0 {
			q = q.Where("(" + strings.Join(conds, " OR ") + ")")
		}
	}
	if f.Q != "" {
		q = q.Where("lockers.code ILIKE ?", "%"+f.Q+"%")
	}
	if f.ActiveOnly {
		q = q.Where("lockers.is_active = ?", true)
	}
	switch f.Status {
	case "inactive":
		q = q.Where("lockers.is_active = ?", false)
	case "full":
		q = q.Where("lockers.is_active = ? AND "+occupiedSQL+" >= lockers.capacity", true)
	case "active":
		q = q.Where("lockers.is_active = ? AND "+occupiedSQL+" < lockers.capacity", true)
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
	err := q.Find(&lockers).Error
	return lockers, total, err
}

func findLockerByID(ctx context.Context, id uint) (*models.Locker, error) {
	var l models.Locker
	if err := config.DB.
		WithContext(ctx).Preload("Branch").First(&l, id).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func findByCode(ctx context.Context, code string) (*models.Locker, error) {
	var l models.Locker
	if err := config.DB.
		WithContext(ctx).Where("code = ?", code).First(&l).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func persistLocker(ctx context.Context, l *models.Locker) error {
	return config.DB.
		WithContext(ctx).Save(l).Error
}

func removeLocker(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Delete(&models.Locker{}, id).Error
}

func LockerCapacity(ctx context.Context, lockerID uint) (capacity int, isActive bool, ok bool, err error) {
	l, err := findLockerByID(ctx, lockerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, false, false, nil
		}
		return 0, false, false, err
	}
	return l.Capacity, l.IsActive, true, nil
}

func validateLocker(ctx context.Context, code string, branchID uint, capacity int) error {
	if code == "" {
		return common.NewBadRequest("code is required")
	}
	if capacity <= 0 {
		return common.NewBadRequest("capacity must be greater than zero")
	}
	ok, err := common.BranchExists(ctx, branchID)
	if err != nil {
		return err
	}
	if !ok {
		return common.NewBadRequest("branch does not exist")
	}
	return nil
}

func toView(ctx context.Context, l models.Locker) (View, error) {
	occupied, err := packet.CountActivePackets(ctx, l.ID)
	if err != nil {
		return View{}, err
	}
	return View{Locker: l, Occupied: occupied}, nil
}

func SaveLocker(ctx context.Context, in CreateInput) (*View, error) {
	if err := validateLocker(ctx, in.Code, in.BranchID, in.Capacity); err != nil {
		return nil, err
	}
	if existing, _ := findByCode(ctx, in.Code); existing != nil {
		return nil, common.NewConflict("a locker with this code already exists")
	}
	rec := &models.Locker{
		Code:     in.Code,
		BranchID: in.BranchID,
		Capacity: in.Capacity,
		IsActive: true,
	}
	if err := insertLocker(ctx, rec); err != nil {
		return nil, err
	}
	full, err := findLockerByID(ctx, rec.ID)
	if err != nil {
		return nil, err
	}
	v, err := toView(ctx, *full)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func listLockers(ctx context.Context, branchID *uint) ([]View, error) {
	views, _, err := findLockers(ctx, LockerFilter{BranchID: branchID})
	return views, err
}

func findLockers(ctx context.Context, f LockerFilter) ([]View, int64, error) {
	lockers, total, err := findLockersFiltered(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	views := make([]View, 0, len(lockers))
	for _, l := range lockers {
		v, err := toView(ctx, l)
		if err != nil {
			return nil, 0, err
		}
		views = append(views, v)
	}
	return views, total, nil
}

func getLocker(ctx context.Context, id uint, branchID *uint) (*View, error) {
	rec, err := findLockerByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("locker not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, common.NewNotFound("locker not found")
	}
	v, err := toView(ctx, *rec)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func updateLocker(ctx context.Context, id uint, in UpdateInput, branchID *uint) (*View, error) {
	if err := validateLocker(ctx, in.Code, in.BranchID, in.Capacity); err != nil {
		return nil, err
	}
	rec, err := findLockerByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("locker not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, common.NewNotFound("locker not found")
	}
	if existing, _ := findByCode(ctx, in.Code); existing != nil && existing.ID != id {
		return nil, common.NewConflict("a locker with this code already exists")
	}
	rec.Code = in.Code
	rec.BranchID = in.BranchID
	rec.Capacity = in.Capacity
	rec.IsActive = in.IsActive
	if err := persistLocker(ctx, rec); err != nil {
		return nil, err
	}
	full, err := findLockerByID(ctx, id)
	if err != nil {
		return nil, err
	}
	v, err := toView(ctx, *full)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func deleteLocker(ctx context.Context, id uint, branchID *uint) error {
	rec, err := findLockerByID(ctx, id)
	if err != nil {
		return common.NewNotFound("locker not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return common.NewNotFound("locker not found")
	}
	occupied, err := packet.CountActivePackets(ctx, rec.ID)
	if err != nil {
		return err
	}
	if occupied > 0 {
		return common.NewConflict("locker cannot be removed while it still holds packets")
	}
	return removeLocker(ctx, id)
}

func CreateLocker(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req createRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	branchID := auth.EnforceBranchOnWrite(c, req.BranchID)
	rec, err := SaveLocker(ctx, CreateInput{Code: req.Code, BranchID: branchID, Capacity: req.Capacity})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListLockers(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	f := LockerFilter{BranchID: auth.GetBranchScope(c)}
	if v := c.QueryParam("branch_id"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			b := uint(n)
			f.FilterBranchID = &b
		}
	}
	var branchIDs []uint
	for _, p := range strings.Split(c.QueryParam("branch_id"), ",") {
		if n, err := strconv.ParseUint(strings.TrimSpace(p), 10, 64); err == nil {
			branchIDs = append(branchIDs, uint(n))
		}
	}
	if len(branchIDs) > 1 {
		f.FilterBranchID, f.FilterBranchIDs = nil, branchIDs
	}
	f.Q = strings.TrimSpace(c.QueryParam("search"))
	if v := c.QueryParam("is_active"); v == "true" {
		f.ActiveOnly = true
	}
	var statuses []string
	for _, s := range strings.Split(strings.ToLower(c.QueryParam("status")), ",") {
		if s = strings.TrimSpace(s); s != "" {
			statuses = append(statuses, s)
		}
	}
	for _, s := range statuses {
		if s != "active" && s != "full" && s != "inactive" {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid status: expected active, full or inactive"})
		}
	}
	if len(statuses) == 1 {
		f.Status = statuses[0]
	} else {
		f.StatusIn = statuses
	}
	if limit > 0 {
		f.Limit, f.Offset = limit, offset
		rec, total, err := findLockers(ctx, f)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := findLockers(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func GetLockerById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getLocker(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func UpdateLocker(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req updateRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	branchID := auth.EnforceBranchOnWrite(c, req.BranchID)
	rec, err := updateLocker(ctx, id, UpdateInput{
		Code: req.Code, BranchID: branchID, Capacity: req.Capacity, IsActive: req.IsActive,
	}, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func DeleteLocker(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := deleteLocker(ctx, id, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessMessage(c, http.StatusOK, "Locker deleted successfully")
}

package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	loanModels "cloudhouse/backend/modules/Loan/models"
	"cloudhouse/backend/modules/Packet/models"
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

var loanNoLongerMovableStatuses = map[string]bool{
	loanModels.StatusAuctioned:           true,
	loanModels.StatusAuctionedBalanceDue: true,
	loanModels.StatusClosed:              true,
	loanModels.StatusRejected:            true,
}

var allowedTransitions = map[string][]string{
	"Packet Generated":        {models.StatusLockerStored},
	models.StatusLockerStored: {models.StatusBankPledged, models.StatusReleased},
	models.StatusBankPledged:  {models.StatusReturned},
	models.StatusReturned:     {models.StatusLockerStored, models.StatusReleased},
	"Ready For Release":       {models.StatusReleased},
	models.StatusReleased:     {},
}

var LockerCapacity func(ctx context.Context, lockerID uint) (capacity int, isActive bool, ok bool, err error)

type movementRequest struct {
	ToStatus   string `json:"to_status" binding:"required"`
	LockerID   *uint  `json:"locker_id"`
	EmployeeID uint   `json:"employee_id"`
	Remarks    string `json:"remarks"`
}

type Filter struct {
	LoanID          uint
	BranchID        *uint
	Status          string
	LockerID        uint
	StatusIn        []string
	FilterBranchIDs []uint
	CustomerIDs     []uint
	Q               string
	Limit           int
	Offset          int
}

type LockerCapacityProvider interface {
	Capacity(ctx context.Context, lockerID uint) (capacity int, isActive bool, ok bool, err error)
}

func preload(db *gorm.DB) *gorm.DB {
	return db.Preload("Loan").Preload("Loan.Customer").Preload("Loan.Branch").
		Preload("Loan.Ornaments", "released_at IS NULL")
}

func insertPacket(ctx context.Context, p *models.Packet) error {
	return config.DB.
		WithContext(ctx).Create(p).Error
}

func sumLoanOrnamentWeights(ctx context.Context, loanID uint) (grossWeight, netWeight float64, err error) {
	var row struct {
		GrossWeight float64
		NetWeight   float64
	}
	err = config.DB.
		WithContext(ctx).Table("ornaments").
		Select("COALESCE(SUM(gross_weight), 0) AS gross_weight, COALESCE(SUM(net_weight), 0) AS net_weight").
		Where("loan_id = ? AND released_at IS NULL", loanID).
		Scan(&row).Error
	return row.GrossWeight, row.NetWeight, err
}

func findPacketByID(ctx context.Context, id uint) (*models.Packet, error) {
	var p models.Packet
	if err := preload(config.DB.
		WithContext(ctx)).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func findByCode(ctx context.Context, code string) (*models.Packet, error) {
	var p models.Packet
	if err := preload(config.DB.
		WithContext(ctx)).Where("code = ?", code).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func FindActiveByLoanID(ctx context.Context, loanID uint) (*models.Packet, error) {
	var p models.Packet
	err := preload(config.DB.
		WithContext(ctx)).
		Where("loan_id = ? AND status <> ?", loanID, models.StatusReleased).
		Order("id desc").First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func findPackets(ctx context.Context, f Filter) ([]models.Packet, int64, error) {
	q := preload(config.DB.
		WithContext(ctx)).Model(&models.Packet{})
	if f.LoanID != 0 {
		q = q.Where("packets.loan_id = ?", f.LoanID)
	}
	if len(f.StatusIn) > 0 {
		q = q.Where("packets.status IN ?", f.StatusIn)
	} else if f.Status != "" {
		q = q.Where("packets.status = ?", f.Status)
	}
	if f.LockerID != 0 {
		q = q.Where("packets.current_locker_id = ?", f.LockerID)
	}
	if f.BranchID != nil || f.Q != "" || len(f.FilterBranchIDs) > 0 || len(f.CustomerIDs) > 0 {
		q = q.Joins("JOIN loans ON loans.id = packets.loan_id").
			Joins("JOIN customers ON customers.id = loans.customer_id")
	}
	if f.BranchID != nil {
		q = q.Where("loans.branch_id = ?", *f.BranchID)
	}
	if len(f.FilterBranchIDs) > 0 {
		q = q.Where("loans.branch_id IN ?", f.FilterBranchIDs)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("loans.customer_id IN ?", f.CustomerIDs)
	}
	if f.Q != "" {
		needle := "%" + f.Q + "%"
		q = q.Joins("LEFT JOIN lockers ON lockers.id = packets.current_locker_id").
			Where("packets.code ILIKE ? OR loans.loan_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ? OR lockers.code ILIKE ?",
				needle, needle, needle, needle, needle)
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
	var packets []models.Packet
	err := q.Order("packets.id desc").Find(&packets).Error
	return packets, total, err
}

func persistPacket(ctx context.Context, p *models.Packet) error {
	return config.DB.
		WithContext(ctx).Save(p).Error
}

func createMovement(ctx context.Context, m *models.PacketMovement) error {
	return config.DB.
		WithContext(ctx).Create(m).Error
}

func findMovements(ctx context.Context, packetID uint) ([]models.PacketMovement, error) {
	var ms []models.PacketMovement
	err := config.DB.
		WithContext(ctx).Where("packet_id = ?", packetID).Order("created_at asc, id asc").Find(&ms).Error
	return ms, err
}

func countAll(ctx context.Context) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.Packet{}).Count(&count).Error
	return count, err
}

func maxCodeSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := config.DB.
		WithContext(ctx).Model(&models.Packet{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'PKT-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

func CountActivePackets(ctx context.Context, lockerID uint) (int, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.Packet{}).
		Where("current_locker_id = ? AND status = ?", lockerID, models.StatusLockerStored).
		Count(&count).Error
	return int(count), err
}

func isAllowed(from, to string) bool {
	for _, s := range allowedTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

func createPacket(ctx context.Context, loanID uint, lockerID *uint) (*models.Packet, error) {
	maxSuffix, err := maxCodeSuffix(ctx)
	if err != nil {
		return nil, err
	}
	p := &models.Packet{
		Code:   fmt.Sprintf("PKT-%06d", maxSuffix+1),
		LoanID: loanID,
		Status: "Packet Generated",
	}
	if grossWeight, netWeight, err := sumLoanOrnamentWeights(ctx, loanID); err != nil {
		log.Printf("packet: could not sum ornament weights for loan %d at packet creation: %v", loanID, err)
	} else {
		p.TotalGrossWeight = grossWeight
		p.TotalNetWeight = netWeight
	}
	remarks := ""
	if lockerID != nil && *lockerID != 0 {
		if err := checkLockerCapacity(ctx, *lockerID); err != nil {
			log.Printf("packet: requested locker %d unavailable at creation for loan %d: %v — packet left ungrouped", *lockerID, loanID, err)
		} else {
			p.Status = models.StatusLockerStored
			p.CurrentLockerID = lockerID
			remarks = "Locker assigned at packet creation"
		}
	}
	if err := insertPacket(ctx, p); err != nil {
		return nil, err
	}
	mv := &models.PacketMovement{PacketID: p.ID, FromStatus: "", ToStatus: p.Status, LockerID: p.CurrentLockerID, Remarks: remarks}
	if err := createMovement(ctx, mv); err != nil {
		return nil, err
	}
	return findPacketByID(ctx, p.ID)
}

func CreatePacketForLoan(ctx context.Context, loanID uint, lockerID *uint) error {
	_, err := createPacket(ctx, loanID, lockerID)
	return err
}

func checkLockerCapacity(ctx context.Context, lockerID uint) error {
	capacity, isActive, ok, err := LockerCapacity(ctx, lockerID)
	if err != nil {
		return err
	}
	if !ok || !isActive {
		return common.NewBadRequest("locker does not exist or is inactive")
	}
	occupied, err := CountActivePackets(ctx, lockerID)
	if err != nil {
		return err
	}
	if occupied >= capacity {
		return common.NewConflict("locker is at full capacity")
	}
	return nil
}

func getPacket(ctx context.Context, id uint, branchID *uint) (*models.Packet, error) {
	rec, err := findPacketByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("packet not found")
	}
	if branchID != nil && rec.Loan.BranchID != *branchID {
		return nil, common.NewNotFound("packet not found")
	}
	return rec, nil
}

func getByCode(ctx context.Context, code string, branchID *uint) (*models.Packet, error) {
	rec, err := findByCode(ctx, code)
	if err != nil {
		return nil, common.NewNotFound("packet not found")
	}
	if branchID != nil && rec.Loan.BranchID != *branchID {
		return nil, common.NewNotFound("packet not found")
	}
	return rec, nil
}

func listPackets(ctx context.Context, f Filter) ([]models.Packet, int64, error) {
	return findPackets(ctx, f)
}

func listMovements(ctx context.Context, packetID uint, branchID *uint) ([]models.PacketMovement, error) {
	if _, err := getPacket(ctx, packetID, branchID); err != nil {
		return nil, err
	}
	return findMovements(ctx, packetID)
}

func SavePacketMovement(ctx context.Context, packetID uint, toStatus string, lockerID *uint, employeeID uint, remarks string) (*models.Packet, error) {
	p, err := findPacketByID(ctx, packetID)
	if err != nil {
		return nil, common.NewNotFound("packet not found")
	}
	if !isAllowed(p.Status, toStatus) {
		return nil, common.NewConflict("invalid packet stage transition")
	}
	if toStatus == models.StatusLockerStored {
		if lockerID == nil || *lockerID == 0 {
			return nil, common.NewBadRequest("locker_id is required for this transition")
		}
		if err := checkLockerCapacity(ctx, *lockerID); err != nil {
			return nil, err
		}
	}
	fromStatus := p.Status
	p.Status = toStatus
	if toStatus == models.StatusLockerStored {
		p.CurrentLockerID = lockerID
	} else {
		p.CurrentLockerID = nil
	}
	if err := persistPacket(ctx, p); err != nil {
		return nil, err
	}
	mv := &models.PacketMovement{
		PacketID:        p.ID,
		FromStatus:      fromStatus,
		ToStatus:        toStatus,
		LockerID:        lockerID,
		ActorEmployeeID: employeeID,
		Remarks:         remarks,
	}
	if err := createMovement(ctx, mv); err != nil {
		return nil, err
	}
	return findPacketByID(ctx, p.ID)
}

func RecordBankPledgeMovement(ctx context.Context, loanID uint, remarks string) error {
	p, err := FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}
	if !isAllowed(p.Status, models.StatusBankPledged) {
		return common.NewConflict("invalid packet stage transition")
	}
	_, err = SavePacketMovement(ctx, p.ID, models.StatusBankPledged, nil, 0, remarks)
	return err
}

func RecordBankReleaseMovement(ctx context.Context, loanID uint, remarks string) error {
	p, err := FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}
	if !isAllowed(p.Status, models.StatusReturned) {
		return common.NewConflict("invalid packet stage transition")
	}
	_, err = SavePacketMovement(ctx, p.ID, models.StatusReturned, nil, 0, remarks)
	return err
}

func RecordGoldReleaseMovement(ctx context.Context, loanID uint, remarks string) error {
	p, err := FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}
	if p.Status != models.StatusReleased && !isAllowed(p.Status, models.StatusReleased) {
		return common.NewConflict("invalid packet stage transition")
	}
	_, err = SavePacketMovement(ctx, p.ID, models.StatusReleased, nil, 0, remarks)
	return err
}

func RecordPartialGoldReleaseMovement(ctx context.Context, loanID uint, releasedGrossWeight, releasedNetWeight float64, remarks string) error {
	p, err := FindActiveByLoanID(ctx, loanID)
	if err != nil {
		return err
	}
	p.TotalGrossWeight -= releasedGrossWeight
	p.TotalNetWeight -= releasedNetWeight
	if p.TotalGrossWeight < 0 {
		p.TotalGrossWeight = 0
	}
	if p.TotalNetWeight < 0 {
		p.TotalNetWeight = 0
	}
	if err := persistPacket(ctx, p); err != nil {
		return err
	}
	mv := &models.PacketMovement{
		PacketID:   p.ID,
		FromStatus: p.Status,
		ToStatus:   p.Status,
		Remarks:    remarks,
	}
	return createMovement(ctx, mv)
}

func ListPackets(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	var f Filter
	if v := c.QueryParam("loan_id"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LoanID = uint(n)
		}
	}
	f.BranchID = auth.GetBranchScope(c)
	if v := c.QueryParam("locker_id"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LockerID = uint(n)
		}
	}
	if statuses := splitCSV(c.QueryParam("status")); len(statuses) > 1 {
		f.StatusIn = statuses
	} else {
		f.Status = c.QueryParam("status")
	}
	f.FilterBranchIDs = parseUintCSV(c.QueryParam("branch_id"))
	f.CustomerIDs = parseUintCSV(c.QueryParam("customer_id"))
	f.Q = strings.TrimSpace(c.QueryParam("search"))
	if limit > 0 {
		f.Limit, f.Offset = limit, offset
		rec, total, err := listPackets(ctx, f)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	recs, _, err := listPackets(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, recs)
}

func GetPacketById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getPacket(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetPacketByCode(c echo.Context) error {
	ctx := auth.RequestContext(c)
	rec, err := getByCode(ctx, c.Param("code"), auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListPacketMovements(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	recs, err := listMovements(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, recs)
}

func RecordPacketMovement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req movementRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	p, err := getPacket(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	if loanNoLongerMovableStatuses[p.Loan.Status] {
		return common.FailErr(c, common.NewConflict("this loan's gold has already left custody — no further packet movement is possible"))
	}
	rec, err := SavePacketMovement(ctx, id, req.ToStatus, req.LockerID, req.EmployeeID, req.Remarks)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// closedKeepDays is how long a closed loan stays on a PC's local copy: effectively always (100 years), so the first download holds every loan the branch ever had.
const closedKeepDays = 36500

// pullCustomer is a customer as the customers API returns it (masked Aadhaar and all), plus the PC-visible UUID.
type pullCustomer struct {
	commonModels.CustomerResponse
	UUID string `json:"uuid"`
}

type pullResponse struct {
	Loans     []models.Loan  `json:"loans"`
	Customers []pullCustomer `json:"customers"`
	Deleted   pullDeleted             `json:"deleted"`
	Cursor    string                  `json:"cursor"`
}

type pullDeleted struct {
	Loans     []string `json:"loans"`
	Customers []string `json:"customers"`
}

// SyncPull returns this branch's loans and customers changed since the cursor, for the exe to write over its
// local copy. The first pull (no cursor) sends every open loan plus loans closed in the last 90 days. Removed
// rows come back as UUIDs under "deleted". The cursor is the newest change seen; a row is never skipped, and one
// at the boundary may repeat, which is harmless because the exe upserts by UUID.
func SyncPull(c echo.Context) error {
	ctx := auth.RequestContext(c)
	scope := auth.GetBranchScope(c)
	// A role that works across branches (an admin) gets every branch: which one is on screen is a view the
	// screens apply to the local copy, so switching branch offline needs no new download.
	if _, pinned := auth.SingleBranchPin(c); !pinned && auth.IsCrossBranchRole(c) {
		scope = nil
	}
	var since time.Time
	if raw := c.QueryParam("since"); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return common.Fail(c, http.StatusBadRequest, "invalid since cursor")
		}
		since = t
	}
	pulledAt := time.Now()

	lq := config.DB.WithContext(ctx).Unscoped().Model(&models.Loan{})
	if scope != nil {
		lq = lq.Where("branch_id = ?", *scope)
	}
	if since.IsZero() {
		lq = lq.Where("deleted_at IS NULL AND (status <> ? OR updated_at >= ?)", models.StatusClosed, pulledAt.AddDate(0, 0, -closedKeepDays))
	} else {
		lq = lq.Where("updated_at >= ?", since)
	}
	var rows []models.Loan
	if err := preloadAll(lq).Order("updated_at, id").Find(&rows).Error; err != nil {
		return common.FailErr(c, err)
	}

	cq := config.DB.WithContext(ctx).Unscoped().Model(&commonModels.Customer{}).Preload("Branch")
	if scope != nil {
		cq = cq.Where("(branch_id = ? OR id IN (SELECT customer_id FROM loans WHERE branch_id = ? AND deleted_at IS NULL))", *scope, *scope)
	}
	if since.IsZero() {
		cq = cq.Where("deleted_at IS NULL")
	} else {
		cq = cq.Where("updated_at >= ?", since)
	}
	var custs []commonModels.Customer
	if err := cq.Order("updated_at, id").Find(&custs).Error; err != nil {
		return common.FailErr(c, err)
	}

	out := pullResponse{Loans: []models.Loan{}, Customers: []pullCustomer{}, Deleted: pullDeleted{Loans: []string{}, Customers: []string{}}}
	cursor := since
	for _, l := range rows {
		if l.DeletedAt.Valid {
			out.Deleted.Loans = append(out.Deleted.Loans, l.UUID)
		} else {
			// the same read-time figures (interest to date, due flags, totals) a list of loans carries, so a PC
			// showing its local copy shows what the server would have shown
			enrichLoan(ctx, &l)
			out.Loans = append(out.Loans, l)
		}
		if l.UpdatedAt.After(cursor) {
			cursor = l.UpdatedAt
		}
	}
	for _, cu := range custs {
		if cu.DeletedAt.Valid {
			out.Deleted.Customers = append(out.Deleted.Customers, cu.UUID)
		} else {
			cu := cu
			out.Customers = append(out.Customers, pullCustomer{CustomerResponse: common.CustomerToResponse(&cu), UUID: cu.UUID})
		}
		if cu.UpdatedAt.After(cursor) {
			cursor = cu.UpdatedAt
		}
	}
	if cursor.IsZero() {
		cursor = pulledAt
	}
	out.Cursor = cursor.UTC().Format(time.RFC3339Nano)
	return common.Success(c, http.StatusOK, out)
}

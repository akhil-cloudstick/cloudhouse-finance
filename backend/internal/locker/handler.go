package locker

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

type createRequest struct {
	Code     string `json:"code" binding:"required"`
	BranchID uint   `json:"branchId" binding:"required"`
	Capacity int    `json:"capacity" binding:"required"`
}

type updateRequest struct {
	Code     string `json:"code" binding:"required"`
	BranchID uint   `json:"branchId" binding:"required"`
	Capacity int    `json:"capacity" binding:"required"`
	IsActive bool   `json:"isActive"`
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	branchID := platform.EnforceBranchOnWrite(c, req.BranchID)
	rec, err := h.svc.Create(ctx, CreateInput{Code: req.Code, BranchID: branchID, Capacity: req.Capacity})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f := LockerFilter{BranchID: platform.GetBranchScope(c)}
	if v := c.Query("branchId"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			b := uint(n)
			f.FilterBranchID = &b
		}
	}
	f.Q = strings.TrimSpace(c.Query("q"))
	if v := c.Query("active"); v == "true" {
		f.ActiveOnly = true
	}

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		f.Limit, f.Offset = limit+1, offset
		rec, total, err := h.svc.Find(ctx, f)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		// One write only — the same duplicated line that was breaking the
		// paged Employees list was here too, doubling the response body and
		// making the paged Lockers list unparseable in the browser. See
		// internal/employee/handler.go's List for the full explanation.
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}
	rec, err := h.svc.List(ctx, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(ctx, id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Update(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	branchID := platform.EnforceBranchOnWrite(c, req.BranchID)
	rec, err := h.svc.Update(ctx, id, UpdateInput{
		Code: req.Code, BranchID: branchID, Capacity: req.Capacity, IsActive: req.IsActive,
	}, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Delete(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.svc.Delete(ctx, id, platform.GetBranchScope(c)); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Locker deleted successfully")
}

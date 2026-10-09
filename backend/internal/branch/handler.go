package branch

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

// createRequest is the JSON body accepted by POST /branches.
type createRequest struct {
	Name    string `json:"name" binding:"required"`
	Code    string `json:"code"`
	Address string `json:"address" binding:"required"`
	Phone   string `json:"phone"`
}

// updateRequest is the JSON body accepted by PUT /branches/:id.
type updateRequest struct {
	Name     string `json:"name" binding:"required"`
	Code     string `json:"code"`
	Address  string `json:"address" binding:"required"`
	Phone    string `json:"phone"`
	IsActive bool   `json:"isActive"`
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	empID, role, _ := platform.ActorFromContext(c)
	rec, err := h.svc.Create(ctx, CreateInput{Name: req.Name, Code: req.Code, Address: req.Address, Phone: req.Phone}, actor{empID, role})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// Quota backs GET /branches/quota — the business's plan and how many active
// branches it has. Advisory only: the create/reactivate paths enforce it.
func (h *Handler) Quota(c *gin.Context) {
	usage, err := h.svc.Usage(platform.RequestContext(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, usage)
}

// List backs GET /branches?q=&active=&limit=&offset= — q matches name/code,
// active=true drops deactivated branches. Opt-in
// pagination: no limit returns the bare array (the original shape); limit
// > 0 returns {items, hasMore, total}.
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f := Filter{BranchID: platform.GetBranchScope(c), Query: strings.TrimSpace(c.Query("q")), ActiveOnly: c.Query("active") == "true"}

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
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}

	rec, _, err := h.svc.Find(ctx, f)
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
	rec, err := h.svc.Get(ctx, id)
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
	empID, role, _ := platform.ActorFromContext(c)
	rec, err := h.svc.Update(ctx, id, UpdateInput{
		Name: req.Name, Code: req.Code, Address: req.Address, Phone: req.Phone, IsActive: req.IsActive,
	}, actor{empID, role})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// Delete deactivates (soft-disables) a branch rather than hard-deleting it,
// so historical records keep a valid BranchID reference.
func (h *Handler) Delete(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	empID, role, _ := platform.ActorFromContext(c)
	rec, err := h.svc.Deactivate(ctx, id, actor{empID, role})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// Switchable backs the branch switcher — GET /branches/switchable.
//
// Deliberately NOT gated on platform.GetBranchScope: it answers "which
// branches may I switch between", which a scoped list cannot answer once a
// selection is active. See Service.ListSwitchable.
func (h *Handler) Switchable(c *gin.Context) {
	ctx := platform.RequestContext(c)
	// A single-branch business has nothing to switch between, whatever the
	// role — every request is pinned to its Head Office.
	_, pinned := platform.SingleBranchPin(c)
	crossBranch := platform.IsCrossBranchRole(c) && !pinned

	// A confined role's own branch, read from the same claims the scope
	// itself is built from — never from the request.
	var own uint
	if scope := platform.GetBranchScope(c); scope != nil {
		own = *scope
	}

	rec, err := h.svc.ListSwitchable(ctx, crossBranch, own)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"branches": rec, "canSwitch": crossBranch})
}

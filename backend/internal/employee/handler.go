package employee

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// createRequest is the JSON body accepted by POST /employees.
type createRequest struct {
	Name     string `json:"name" binding:"required"`
	Role     string `json:"role" binding:"required"`
	BranchID uint   `json:"branchId" binding:"required"`
	Phone    string `json:"phone"`
	// Username/Password optionally set up login credentials right away
	// (see internal/auth — login accepts Username or Phone).
	Username string `json:"username"`
	Password string `json:"password"`
}

// updateRequest is the JSON body accepted by PUT /employees/:id.
type updateRequest struct {
	Name           string  `json:"name" binding:"required"`
	Role           string  `json:"role" binding:"required"`
	BranchID       uint    `json:"branchId" binding:"required"`
	Phone          string  `json:"phone"`
	LoansProcessed int     `json:"loansProcessed"`
	Collections    float64 `json:"collections"`
	Followups      int     `json:"followups"`
	Pending        int     `json:"pending"`
	// Username/Email/Password are optional — set/rotate an employee's
	// login credentials via this same endpoint (see internal/auth — login
	// accepts Username or Phone, not Email).
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	branchID := platform.EnforceBranchOnWrite(c, req.BranchID)
	actorID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.Create(ctx, CreateInput{Name: req.Name, Role: req.Role, BranchID: branchID, Phone: req.Phone, Username: req.Username, Password: req.Password}, actorID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchScope := platform.GetBranchScope(c)

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.List(ctx, branchScope, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}

	rec, _, err := h.svc.List(ctx, branchScope, 0, 0)
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
	actorID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.Update(ctx, id, UpdateInput{
		Name: req.Name, Role: req.Role, BranchID: branchID, Phone: req.Phone,
		LoansProcessed: req.LoansProcessed, Collections: req.Collections,
		Followups: req.Followups, Pending: req.Pending,
		Username: req.Username, Email: req.Email, Password: req.Password,
	}, platform.GetBranchScope(c), actorID)
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
	actorID, _, _ := platform.ActorFromContext(c)
	if err := h.svc.Delete(ctx, id, platform.GetBranchScope(c), actorID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Employee deleted successfully")
}

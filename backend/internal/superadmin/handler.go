package superadmin

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to the Service.
//
// Every method here assumes platform.SuperAdminAuthMiddleware already ran — see
// routes.go, which is the ONLY gate these routes carry. There is no
// CRUDPermissions layer anywhere in this file, on purpose: see the package
// doc comment.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// actor reconstructs the calling SuperAdminUser from the claims
// SuperAdminAuthMiddleware set on the context, for the audit log's ActorName —
// no extra database round-trip needed to know who is asking.
func actor(c *gin.Context) *SuperAdminUser {
	idVal, _ := c.Get("superAdminUserId")
	nameVal, _ := c.Get("superAdminName")
	id, _ := idVal.(uint)
	name, _ := nameVal.(string)
	return &SuperAdminUser{ID: id, Name: name}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *Handler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	token, u, err := h.svc.Login(platform.RequestContext(c), req.Username, req.Password)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"token": token, "superAdminUser": gin.H{"id": u.ID, "name": u.Name, "username": u.Username}})
}

// --- Businesses --------------------------------------------------------------

type createBusinessRequest struct {
	Name          string `json:"name"`
	Code          string `json:"code"`
	TierID        uint   `json:"tierId"`
	AdminUsername string `json:"adminUsername"`
	AdminPassword string `json:"adminPassword"`
	AdminName     string `json:"adminName"`
	AdminPhone    string `json:"adminPhone"`
	Reason        string `json:"reason"`
}

func (h *Handler) CreateBusiness(c *gin.Context) {
	var req createBusinessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	t, err := h.svc.CreateBusiness(platform.RequestContext(c), actor(c), CreateBusinessInput{
		Name:          req.Name,
		Code:          req.Code,
		TierID:        req.TierID,
		AdminUsername: req.AdminUsername,
		AdminPassword: req.AdminPassword,
		AdminName:     req.AdminName,
		AdminPhone:    req.AdminPhone,
	}, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, t)
}

func (h *Handler) ListBusinesses(c *gin.Context) {
	rec, err := h.svc.ListBusinesses(platform.RequestContext(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) GetBusiness(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.GetBusiness(platform.RequestContext(c), id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type reasonRequest struct {
	Reason string `json:"reason"`
}

func (h *Handler) SuspendBusiness(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req reasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.SuspendBusiness(platform.RequestContext(c), actor(c), id, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) ReactivateBusiness(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req reasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.ReactivateBusiness(platform.RequestContext(c), actor(c), id, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type changeTierRequest struct {
	TierID uint   `json:"tierId"`
	Reason string `json:"reason"`
}

func (h *Handler) ChangeTier(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req changeTierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.ChangeTier(platform.RequestContext(c), actor(c), id, req.TierID, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type adjustExpiryRequest struct {
	// ExpiresAt is a pointer so the JSON key can be explicitly present with
	// value null (clear the expiry) vs entirely absent (no client bug should
	// silently clear it) — encoding/json only distinguishes those two with
	// a pointer field.
	ExpiresAt *time.Time `json:"expiresAt"`
	Reason    string     `json:"reason"`
}

func (h *Handler) AdjustExpiry(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req adjustExpiryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.AdjustExpiry(platform.RequestContext(c), actor(c), id, req.ExpiresAt, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// --- Tiers ---------------------------------------------------------------

func (h *Handler) ListTiers(c *gin.Context) {
	rec, err := h.svc.ListTiers(platform.RequestContext(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type setTierPriceRequest struct {
	PriceInPaise int64  `json:"priceInPaise"`
	Reason       string `json:"reason"`
}

func (h *Handler) SetTierPrice(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req setTierPriceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.SetTierPrice(platform.RequestContext(c), actor(c), id, req.PriceInPaise, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// --- Audit -----------------------------------------------------------------

func (h *Handler) ListAuditLog(c *gin.Context) {
	var f AuditLogFilter
	// A QUERY parameter, not a path one — httpx.IDParam only reads
	// c.Param(), so parsed directly here instead. A malformed value is
	// ignored (falls back to "no filter") rather than a 400: this is an
	// optional narrowing on a GET, not required input.
	if v := c.Query("tenantId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			tid := uint(id)
			f.TenantID = &tid
		}
	}
	f.Action = c.Query("action")
	rec, err := h.svc.ListAuditLog(platform.RequestContext(c), f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

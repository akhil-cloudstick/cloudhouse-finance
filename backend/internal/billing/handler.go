package billing

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler exposes both the tenant-facing billing endpoints (gated by the
// employee JWT + "can manage billing" permission, mounted under
// /api/v1/billing) and the public Razorpay webhook (mounted separately,
// with NO auth middleware at all — see Webhook's own doc comment).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Status handles GET /billing/status.
func (h *Handler) Status(c *gin.Context) {
	ctx := platform.RequestContext(c)
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok {
		httpx.FailErr(c, httpx.NewBadRequest("no business on this session"))
		return
	}
	status, err := h.svc.GetStatus(ctx, tenantID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, status)
}

// Subscribe handles POST /billing/subscribe.
func (h *Handler) Subscribe(c *gin.Context) {
	ctx := platform.RequestContext(c)
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok {
		httpx.FailErr(c, httpx.NewBadRequest("no business on this session"))
		return
	}
	res, err := h.svc.Subscribe(ctx, tenantID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, res)
}

type confirmRequest struct {
	RazorpaySubscriptionID string `json:"razorpaySubscriptionId" binding:"required"`
	RazorpayPaymentID      string `json:"razorpayPaymentId" binding:"required"`
	RazorpaySignature      string `json:"razorpaySignature" binding:"required"`
}

// Confirm handles POST /billing/confirm — called by the frontend right
// after Razorpay's checkout widget reports success (see
// Service.ConfirmSubscription's doc comment for why this exists alongside
// the webhook rather than instead of it).
func (h *Handler) Confirm(c *gin.Context) {
	ctx := platform.RequestContext(c)
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok {
		httpx.FailErr(c, httpx.NewBadRequest("no business on this session"))
		return
	}
	var req confirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.FailErr(c, httpx.NewBadRequest("razorpaySubscriptionId, razorpayPaymentId and razorpaySignature are required"))
		return
	}
	if err := h.svc.ConfirmSubscription(ctx, tenantID, req.RazorpaySubscriptionID, req.RazorpayPaymentID, req.RazorpaySignature); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"confirmed": true})
}

// Webhook handles POST /webhooks/razorpay — mounted with NO auth middleware
// (see app.go's mount site). This is Razorpay's own server calling in, not
// a logged-in employee or customer; the ONLY gate is the signature Service
// verifies against the raw body. Every response is 200 unless the body
// can't even be read, matching Razorpay's own retry semantics: a
// non-2xx tells Razorpay to retry the SAME delivery, which is correct for a
// transient failure but would loop forever on a permanently-unrecognized
// event, so a rejected/unrecognized event still returns 200 having done
// nothing (Service.HandleWebhook's own doc comment covers the "ignore, not
// error" cases; only a signature failure is worth surfacing as non-2xx).
func (h *Handler) Webhook(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	signature := c.GetHeader("X-Razorpay-Signature")
	ctx := platform.AllowCrossTenant(c.Request.Context())
	if err := h.svc.HandleWebhook(ctx, body, signature); err != nil {
		if err == ErrWebhookSignatureInvalid {
			c.Status(http.StatusBadRequest)
			return
		}
		// Any other error (malformed payload, etc.) — still 200. Razorpay
		// would otherwise retry a payload that will never parse any
		// differently.
	}
	c.Status(http.StatusOK)
}

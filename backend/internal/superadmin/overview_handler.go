package superadmin

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// BusinessOverview backs GET /superadmin/businesses/:id/overview.
func (h *Handler) BusinessOverview(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	out, err := h.svc.BusinessOverview(platform.RequestContext(c), id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, out)
}

// ListPayments backs GET /superadmin/businesses/:id/payments.
func (h *Handler) ListPayments(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	ctx := platform.RequestContext(c)
	if _, err := h.svc.GetBusiness(platform.AllowCrossTenant(ctx), id); err != nil {
		httpx.FailErr(c, err)
		return
	}
	out, err := h.svc.ListPayments(ctx, id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, out)
}

type recordPaymentRequest struct {
	AmountInPaise int64  `json:"amountInPaise"`
	PaidOn        string `json:"paidOn"`
	Mode          string `json:"mode"`
	Reference     string `json:"reference"`
	Note          string `json:"note"`
	PeriodFrom    string `json:"periodFrom"`
	PeriodTo      string `json:"periodTo"`
}

// RecordPayment backs POST /superadmin/businesses/:id/payments.
func (h *Handler) RecordPayment(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req recordPaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.RecordPayment(platform.RequestContext(c), actor(c), id, RecordPaymentInput{
		AmountInPaise: req.AmountInPaise,
		PaidOn:        req.PaidOn,
		Mode:          req.Mode,
		Reference:     req.Reference,
		Note:          req.Note,
		PeriodFrom:    req.PeriodFrom,
		PeriodTo:      req.PeriodTo,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// DeletePayment backs DELETE /superadmin/businesses/:id/payments/:paymentId.
func (h *Handler) DeletePayment(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	paymentID, err := httpx.IDParam(c, "paymentId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req reasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	if err := h.svc.DeletePayment(platform.RequestContext(c), actor(c), id, paymentID, req.Reason); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"deleted": true})
}

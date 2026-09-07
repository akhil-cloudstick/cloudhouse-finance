package customer

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
)

// --- Customer mobile app (customer-mobile/) — batch 4: Profile & KYC. These
// handlers wrap the existing Service exactly like the staff handlers above,
// but are mounted under /api/v1/customer/profile (see main.go), gated by
// platform.CustomerAuthMiddleware rather than the staff AuthMiddleware.
//
// Unlike the loan handlers (a customer owns many loans, so :id needs an
// ownership check), a customer has exactly one Customer row and its ID IS
// customerId from the JWT — so these routes take no :id/body customer id at
// all, and every call passes branchID=nil (same "no scope" semantics staff
// admins already get from platform.GetBranchScope).

// customerIDFromContext mirrors customerauth.customerIDFromContext and
// internal/loan/customer_handler.go's own copy — kept as its own copy here
// rather than exported from customerauth, since internal/customer already
// avoids importing sibling domain packages it doesn't otherwise need.
func customerIDFromContext(c *gin.Context) (uint, bool) {
	v, ok := c.Get("customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

// CustomerGetProfile backs GET /customer/profile — returns the authenticated
// customer's own record, reusing the same CustomerResponse shape the staff
// endpoints return (never the raw model).
func (h *Handler) CustomerGetProfile(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	rec, err := h.svc.Get(ctx, customerID, nil)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec.ToResponse())
}

// CustomerVerifyPAN backs POST /customer/profile/verify-pan — identical
// wrapping of Service.VerifyPAN to the staff Handler.VerifyPAN, just
// customerID sourced from the JWT instead of :id + branch scope.
func (h *Handler) CustomerVerifyPAN(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	rec, result, err := h.svc.VerifyPAN(ctx, customerID, nil)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"customer":    rec.ToResponse(),
		"message":     result.Message,
		"matchedName": result.FullName,
		"traceId":     result.TraceID,
	})
}

// CustomerStartAadhaarVerify backs POST /customer/profile/aadhaar/start —
// same pattern as the staff Handler.StartAadhaarVerify, reusing the shared
// startAadhaarVerifyRequest body (redirectUrl). The customer app supplies
// its own deep-link URL (e.g. ambikacustomer://aadhaar-callback via
// expo-linking), not a web page.
func (h *Handler) CustomerStartAadhaarVerify(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req startAadhaarVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	digReq, err := h.svc.StartAadhaarVerify(ctx, customerID, nil, req.RedirectURL)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"id":        digReq.ID,
		"url":       digReq.URL,
		"status":    digReq.Status,
		"validUpto": digReq.ValidUpto,
	})
}

// CustomerCheckAadhaarVerify backs GET /customer/profile/aadhaar/status —
// polled by the mobile app after the DigiLocker browser flow returns.
func (h *Handler) CustomerCheckAadhaarVerify(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	rec, status, aadhaar, err := h.svc.CheckAadhaarVerify(ctx, customerID, nil)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if aadhaar == nil {
		httpx.Success(c, http.StatusOK, gin.H{"status": status.Status})
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"customer":    rec.ToResponse(),
		"status":      status.Status,
		"matchedName": aadhaar.Aadhaar.Name,
		"dob":         aadhaar.Aadhaar.DateOfBirth,
	})
}

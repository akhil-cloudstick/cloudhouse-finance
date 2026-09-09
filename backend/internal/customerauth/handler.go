package customerauth

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/upload"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

type requestOTPInput struct {
	// BusinessCode identifies the lender whose app link the borrower
	// opened. Optional while only one business exists.
	BusinessCode string `json:"businessCode"`
	Phone        string `json:"phone" binding:"required"`
}

// RequestOTP always responds 200 regardless of whether the phone is
// registered, except it does surface a clear "not registered" message per
// the plan (contact your branch) — unlike employee forgot-password, a
// customer app is a closed system tied to an existing loan-account
// relationship, so there's no ambiguity to protect by staying silent here.
func (h *Handler) RequestOTP(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var in requestOTPInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	if err := h.svc.RequestOTP(ctx, in.BusinessCode, in.Phone); err != nil {
		if errors.Is(err, ErrCustomerNotFound) {
			httpx.Fail(c, http.StatusNotFound, "This phone number is not registered. Please contact your branch.")
			return
		}
		log.Printf("customerauth: request-otp error for %q: %v", in.Phone, err)
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "A sign-in code has been sent via WhatsApp.")
}

type verifyOTPInput struct {
	// BusinessCode identifies the lender whose app link the borrower
	// opened. Optional while only one business exists.
	BusinessCode string `json:"businessCode"`
	Phone        string `json:"phone" binding:"required"`
	Code         string `json:"code" binding:"required"`
}

type sessionResponse struct {
	Token    string                    `json:"token"`
	Customer customer.CustomerResponse `json:"customer"`
}

func (h *Handler) VerifyOTP(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var in verifyOTPInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	token, cust, err := h.svc.VerifyOTP(ctx, in.BusinessCode, in.Phone, in.Code)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	// Borrowers view their own loan paperwork as images/PDFs, so their
	// session needs the same path-scoped file cookie staff get.
	upload.SetAuthCookie(c, token, int(sessionTokenTTL.Seconds()))

	httpx.Success(c, http.StatusOK, sessionResponse{Token: token, Customer: cust.ToResponse()})
}

type registerDeviceInput struct {
	DeviceID string `json:"deviceId" binding:"required"`
}

// RegisterDevice requires a valid customer session JWT (CustomerAuthMiddleware
// runs first) — it's called right after verify-otp succeeds, while the app
// still holds a fresh session token.
func (h *Handler) RegisterDevice(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	var in registerDeviceInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	deviceToken, err := h.svc.RegisterDevice(ctx, customerID, in.DeviceID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"deviceToken": deviceToken})
}

type deviceLoginInput struct {
	DeviceToken string `json:"deviceToken" binding:"required"`
}

// DeviceLogin is public (no session JWT yet — that's the point, it's how a
// new session JWT is obtained) but requires the device token itself, which
// only a device that previously completed register-device holds.
func (h *Handler) DeviceLogin(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var in deviceLoginInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	token, cust, err := h.svc.DeviceLogin(ctx, in.DeviceToken)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	// Borrowers view their own loan paperwork as images/PDFs, so their
	// session needs the same path-scoped file cookie staff get.
	upload.SetAuthCookie(c, token, int(sessionTokenTTL.Seconds()))

	httpx.Success(c, http.StatusOK, sessionResponse{Token: token, Customer: cust.ToResponse()})
}

func (h *Handler) Refresh(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	token, err := h.svc.Refresh(ctx, customerID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"token": token})
}

func customerIDFromContext(c *gin.Context) (uint, bool) {
	v, ok := c.Get("customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

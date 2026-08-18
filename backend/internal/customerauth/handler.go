package customerauth

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/customer"
)

const genericErr = "Something went wrong on our end. Please try again."

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrInvalidOrExpiredOTP), errors.Is(err, ErrTooManyAttempts),
		errors.Is(err, ErrInvalidDeviceToken), errors.Is(err, ErrDeviceIDRequired):
		return http.StatusBadRequest
	case errors.Is(err, ErrCustomerNotFound):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

func respondErr(c *gin.Context, err error) {
	status := statusForErr(err)
	if status == http.StatusInternalServerError {
		log.Printf("customerauth: internal error: %v", err)
		c.JSON(status, gin.H{"error": genericErr})
		return
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

type requestOTPInput struct {
	Phone string `json:"phone" binding:"required"`
}

// RequestOTP always responds 200 regardless of whether the phone is
// registered, except it does surface a clear "not registered" message per
// the plan (contact your branch) — unlike employee forgot-password, a
// customer app is a closed system tied to an existing loan-account
// relationship, so there's no ambiguity to protect by staying silent here.
func (h *Handler) RequestOTP(c *gin.Context) {
	var in requestOTPInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RequestOTP(in.Phone); err != nil {
		if errors.Is(err, ErrCustomerNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "This phone number is not registered. Please contact your branch."})
			return
		}
		log.Printf("customerauth: request-otp error for %q: %v", in.Phone, err)
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "A sign-in code has been sent via WhatsApp."})
}

type verifyOTPInput struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

type sessionResponse struct {
	Token    string                    `json:"token"`
	Customer customer.CustomerResponse `json:"customer"`
}

func (h *Handler) VerifyOTP(c *gin.Context) {
	var in verifyOTPInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	token, cust, err := h.svc.VerifyOTP(in.Phone, in.Code)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, sessionResponse{Token: token, Customer: cust.ToResponse()})
}

type registerDeviceInput struct {
	DeviceID string `json:"deviceId" binding:"required"`
}

// RegisterDevice requires a valid customer session JWT (CustomerAuthMiddleware
// runs first) — it's called right after verify-otp succeeds, while the app
// still holds a fresh session token.
func (h *Handler) RegisterDevice(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	var in registerDeviceInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	deviceToken, err := h.svc.RegisterDevice(customerID, in.DeviceID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deviceToken": deviceToken})
}

type deviceLoginInput struct {
	DeviceToken string `json:"deviceToken" binding:"required"`
}

// DeviceLogin is public (no session JWT yet — that's the point, it's how a
// new session JWT is obtained) but requires the device token itself, which
// only a device that previously completed register-device holds.
func (h *Handler) DeviceLogin(c *gin.Context) {
	var in deviceLoginInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	token, cust, err := h.svc.DeviceLogin(in.DeviceToken)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, sessionResponse{Token: token, Customer: cust.ToResponse()})
}

func (h *Handler) Refresh(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	token, err := h.svc.Refresh(customerID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token})
}

func customerIDFromContext(c *gin.Context) (uint, bool) {
	v, ok := c.Get("customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

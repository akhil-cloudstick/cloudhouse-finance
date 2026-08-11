package auth

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/employee"
)

// genericErr is returned instead of a raw internal error so we never leak
// SQL/driver/SMTP details to the client. The real error is logged
// server-side.
const genericErr = "Something went wrong on our end. Please try again."

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrInvalidCredentials), errors.Is(err, ErrAccountNotSetUp):
		return http.StatusUnauthorized
	case errors.Is(err, ErrInvalidOrExpiredToken):
		return http.StatusBadRequest
	case errors.Is(err, employee.ErrNotFound):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

func respondErr(c *gin.Context, err error) {
	status := statusForErr(err)
	if status == http.StatusInternalServerError {
		log.Printf("auth: internal error: %v", err)
		c.JSON(status, gin.H{"error": genericErr})
		return
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

// LoginResponse is the JSON body returned by POST /auth/login.
type LoginResponse struct {
	Token    string             `json:"token"`
	Employee *employee.Employee `json:"employee"`
}

func (h *Handler) Login(c *gin.Context) {
	var in LoginInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	token, emp, err := h.svc.Login(in.Email, in.Password)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, LoginResponse{Token: token, Employee: emp})
}

// ForgotPassword always responds 200 regardless of whether the email is
// registered, so the API never reveals which emails have accounts.
// ErrInvalidCredentials (meaning "no such email" in this context) is
// swallowed; any other/unexpected error still logs but also responds 200
// to avoid leaking account existence via timing/error differences.
func (h *Handler) ForgotPassword(c *gin.Context) {
	var in ForgotPasswordInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ForgotPassword(in.Email); err != nil && !errors.Is(err, ErrInvalidCredentials) {
		log.Printf("auth: forgot-password error for %q: %v", in.Email, err)
	}
	c.JSON(http.StatusOK, gin.H{"message": "If that email is registered, a password reset link has been sent."})
}

func (h *Handler) ResetPassword(c *gin.Context) {
	var in ResetPasswordInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ResetPassword(in.Token, in.NewPassword); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Password has been reset. You can now log in."})
}

// Me returns the calling employee's public fields + role, reading the
// employee ID that AuthMiddleware set on the context.
func (h *Handler) Me(c *gin.Context) {
	employeeIDVal, ok := c.Get("employeeId")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	employeeID, ok := employeeIDVal.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	emp, err := h.svc.Me(employeeID)
	if err != nil {
		respondErr(c, employee.ErrNotFound)
		return
	}
	c.JSON(http.StatusOK, emp)
}

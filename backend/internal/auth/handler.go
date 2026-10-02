package auth

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/upload"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc       *Service
	jwtExpiry time.Duration
}

func NewHandler(svc *Service, jwtExpiry time.Duration) *Handler {
	return &Handler{svc: svc, jwtExpiry: jwtExpiry}
}

// LoginResponse is the JSON body returned by POST /auth/login.
type LoginResponse struct {
	Token    string             `json:"token"`
	Employee *employee.Employee `json:"employee"`
}

func (h *Handler) Login(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var in LoginInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	token, emp, err := h.svc.Login(ctx, in.BusinessCode, in.Identifier, in.Password)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	// Mirror the token into a path-scoped cookie so <img src="/uploads/...">
	// can authenticate — an image tag cannot send an Authorization header.
	// See upload.AuthCookieName.
	upload.SetAuthCookie(c, token, int(h.jwtExpiry.Seconds()))

	httpx.Success(c, http.StatusOK, LoginResponse{Token: token, Employee: emp})
}

// ForgotPassword tells the caller exactly what happened so the reset page can
// react: 404 when the phone number is not registered with this business,
// 403 when it belongs to an employee with no login, 503 when the code could
// not be sent, 200 once the SMS is on its way.
func (h *Handler) ForgotPassword(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var in ForgotPasswordInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	if err := h.svc.ForgotPassword(ctx, in.BusinessCode, in.Phone); err != nil {
		var se httpx.StatusedError
		if !errors.As(err, &se) {
			// An unexpected DB/driver failure: the code was not sent.
			log.Printf("auth: forgot-password error for %q: %v", in.Phone, err)
			err = ErrResetCodeNotSent
		}
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "A reset code has been sent by SMS.")
}

func (h *Handler) ResetPassword(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var in ResetPasswordInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	if err := h.svc.ResetPassword(ctx, in.BusinessCode, in.Phone, in.OTP, in.NewPassword); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Password has been reset. You can now log in.")
}

// Me returns the calling employee's public fields + role, reading the
// employee ID that AuthMiddleware set on the context.
func (h *Handler) Me(c *gin.Context) {
	ctx := platform.RequestContext(c)
	employeeIDVal, ok := c.Get("employeeId")
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	employeeID, ok := employeeIDVal.(uint)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	emp, err := h.svc.Me(ctx, employeeID)
	if err != nil {
		httpx.FailErr(c, employee.ErrNotFound)
		return
	}
	httpx.Success(c, http.StatusOK, emp)
}

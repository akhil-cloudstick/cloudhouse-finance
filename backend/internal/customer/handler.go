package customer

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"ambikagold/backend/internal/platform"

	"github.com/gin-gonic/gin"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// customerRequest is the JSON body accepted by create/update. Aadhaar is
// accepted here as plaintext (over HTTPS in production) and is encrypted
// server-side before it ever reaches storage — see service.go.
type customerRequest struct {
	Name    string `json:"name" binding:"required"`
	Phone   string `json:"phone" binding:"required"`
	DOB     string `json:"dob"` // "YYYY-MM-DD", optional
	Address string `json:"address"`

	BranchID uint `json:"branchId" binding:"required"`

	PhotoURL         string `json:"photoUrl"`
	IdentityProofURL string `json:"identityProofUrl"`
	AddressProofURL  string `json:"addressProofUrl"`
	KYCDocumentURL   string `json:"kycDocumentUrl"`

	PAN     string `json:"pan"`
	Aadhaar string `json:"aadhaar"`

	NomineeName     string `json:"nomineeName"`
	NomineeRelation string `json:"nomineeRelation"`
	NomineePhone    string `json:"nomineePhone"`
}

func parseDOB(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	return time.Parse("2006-01-02", s)
}

func (req customerRequest) toInput() (CreateInput, error) {
	dob, err := parseDOB(req.DOB)
	if err != nil {
		return CreateInput{}, errors.New("invalid dob: expected YYYY-MM-DD")
	}
	return CreateInput{
		Name:    req.Name,
		Phone:   req.Phone,
		DOB:     dob,
		Address: req.Address,

		BranchID: req.BranchID,

		PhotoURL:         req.PhotoURL,
		IdentityProofURL: req.IdentityProofURL,
		AddressProofURL:  req.AddressProofURL,
		KYCDocumentURL:   req.KYCDocumentURL,

		PAN:     req.PAN,
		Aadhaar: req.Aadhaar,

		NomineeName:     req.NomineeName,
		NomineeRelation: req.NomineeRelation,
		NomineePhone:    req.NomineePhone,
	}, nil
}

func idParam(c *gin.Context) (uint, error) {
	v, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return 0, errors.New("invalid id")
	}
	return uint(v), nil
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrNameRequired), errors.Is(err, ErrPhoneRequired),
		errors.Is(err, ErrBranchReq), errors.Is(err, ErrBranchInvalid),
		errors.Is(err, ErrPANRequired), errors.Is(err, ErrNoDigilockerRequest):
		return http.StatusBadRequest
	case errors.Is(err, ErrSetuNotConfigured), errors.Is(err, ErrDigilockerNotConfigured):
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) Create(c *gin.Context) {
	var req customerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input, err := req.toInput()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	branchID := platform.EnforceBranchOnWrite(c, input.BranchID)
	input.BranchID = branchID
	rec, err := h.svc.Create(input)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec.ToResponse())
}

// List returns all matching customers when no `limit` query param is given
// (the full Customers & KYC page's behaviour, unchanged). When `limit` is
// given (the paginated SearchableSelect in NewLoan.tsx), it fetches one
// extra row beyond the page to cheaply determine `hasMore` without a
// separate COUNT query, and responds with the {items, hasMore} envelope
// instead of a bare array.
func (h *Handler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	if limit <= 0 {
		rec, err := h.svc.List(c.Query("q"), 0, 0, platform.GetBranchScope(c))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, ToResponseList(rec))
		return
	}

	rec, err := h.svc.List(c.Query("q"), limit+1, offset, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	c.JSON(http.StatusOK, gin.H{"items": ToResponseList(rec), "hasMore": hasMore})
}

func (h *Handler) Get(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec.ToResponse())
}

func (h *Handler) Update(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req customerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input, err := req.toInput()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	branchID := platform.EnforceBranchOnWrite(c, input.BranchID)
	input.BranchID = branchID
	rec, err := h.svc.Update(id, input, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec.ToResponse())
}

// VerifyPAN triggers a live Setu PAN-verify call (see
// internal/platform/setu.go) for this customer's on-file PAN and persists
// the resulting status. Returns the updated customer plus the raw Setu
// message/matched name so the UI can show what actually came back, not just
// the stored status.
func (h *Handler) VerifyPAN(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, result, err := h.svc.VerifyPAN(id, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"customer":    rec.ToResponse(),
		"message":     result.Message,
		"matchedName": result.FullName,
		"traceId":     result.TraceID,
	})
}

// startAadhaarVerifyRequest carries the frontend's own callback page URL —
// DigiLocker redirects the customer's browser there once they finish
// logging in, so the frontend (which knows its own origin) supplies it
// rather than the backend hardcoding one.
type startAadhaarVerifyRequest struct {
	RedirectURL string `json:"redirectUrl" binding:"required"`
}

// StartAadhaarVerify begins a DigiLocker Aadhaar-verify request (see
// internal/platform/setu_digilocker.go) and returns the login URL the
// CUSTOMER must open themselves to authenticate with Aadhaar + OTP.
func (h *Handler) StartAadhaarVerify(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req startAadhaarVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	digReq, err := h.svc.StartAadhaarVerify(id, platform.GetBranchScope(c), req.RedirectURL)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":        digReq.ID,
		"url":       digReq.URL,
		"status":    digReq.Status,
		"validUpto": digReq.ValidUpto,
	})
}

// CheckAadhaarVerify polls the outstanding DigiLocker request (started by
// StartAadhaarVerify) for this customer. Returns "unauthenticated" while
// the customer hasn't finished logging in yet (poll again later), or the
// updated customer plus the fetched Aadhaar name/DOB once "authenticated".
func (h *Handler) CheckAadhaarVerify(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, status, aadhaar, err := h.svc.CheckAadhaarVerify(id, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	if aadhaar == nil {
		c.JSON(http.StatusOK, gin.H{"status": status.Status})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"customer":    rec.ToResponse(),
		"status":      status.Status,
		"matchedName": aadhaar.Aadhaar.Name,
		"dob":         aadhaar.Aadhaar.DateOfBirth,
	})
}

func (h *Handler) Delete(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Delete(id, platform.GetBranchScope(c)); err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

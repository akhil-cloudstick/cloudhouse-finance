package customer

import (
	"net/http"
	"strconv"
	"time"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"

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
		return CreateInput{}, httpx.NewBadRequest("invalid dob: expected YYYY-MM-DD")
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

func (h *Handler) Create(c *gin.Context) {
	var req customerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	input, err := req.toInput()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	branchID := platform.EnforceBranchOnWrite(c, input.BranchID)
	input.BranchID = branchID
	rec, err := h.svc.Create(input)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec.ToResponse())
}

// List returns all matching customers when no `limit` query param is given
// (the full Customers & KYC page's behaviour, unchanged). When `limit` is
// given (the paginated SearchableSelect in NewLoan.tsx), it fetches one
// extra row beyond the page to cheaply determine `hasMore` without a
// separate COUNT query, and responds with the {items, hasMore} shape
// (itself now sitting under the outer {success, data} envelope).
func (h *Handler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	f := CustomerFilter{
		Query:         c.Query("q"),
		BranchID:      platform.GetBranchScope(c),
		PANStatus:     c.Query("panStatus"),
		AadhaarStatus: c.Query("aadhaarStatus"),
	}

	if limit <= 0 {
		rec, _, err := h.svc.List(f)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, ToResponseList(rec))
		return
	}

	f.Limit, f.Offset = limit+1, offset
	rec, total, err := h.svc.List(f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": ToResponseList(rec), "hasMore": hasMore, "total": total})
}

func (h *Handler) Get(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec.ToResponse())
}

// GetAadhaarFull returns the customer's full, decrypted Aadhaar number —
// the one place any API response ever carries more than AadhaarLast4. Used
// to prefill the full Aadhaar number on the printable pledge agreement
// (frontend/modules/loans/utils/indemnityBond.ts, mobile/src/utils/
// loanPrint.ts); gated at the route by perms.Update, same elevated bar as
// the DigiLocker Aadhaar-verify endpoints.
func (h *Handler) GetAadhaarFull(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	aadhaar, err := h.svc.DecryptAadhaar(id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"aadhaar": aadhaar})
}

func (h *Handler) Update(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req customerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	input, err := req.toInput()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	branchID := platform.EnforceBranchOnWrite(c, input.BranchID)
	input.BranchID = branchID
	rec, err := h.svc.Update(id, input, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec.ToResponse())
}

// VerifyPAN triggers a live Setu PAN-verify call (see
// internal/platform/setu.go) for this customer's on-file PAN and persists
// the resulting status. Returns the updated customer plus the raw Setu
// message/matched name so the UI can show what actually came back, not just
// the stored status.
func (h *Handler) VerifyPAN(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, result, err := h.svc.VerifyPAN(id, platform.GetBranchScope(c))
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
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req startAadhaarVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	digReq, err := h.svc.StartAadhaarVerify(id, platform.GetBranchScope(c), req.RedirectURL)
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

// CheckAadhaarVerify polls the outstanding DigiLocker request (started by
// StartAadhaarVerify) for this customer. Returns "unauthenticated" while
// the customer hasn't finished logging in yet (poll again later), or the
// updated customer plus the fetched Aadhaar name/DOB once "authenticated".
func (h *Handler) CheckAadhaarVerify(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, status, aadhaar, err := h.svc.CheckAadhaarVerify(id, platform.GetBranchScope(c))
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

func (h *Handler) Delete(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.svc.Delete(id, platform.GetBranchScope(c)); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Customer deleted successfully")
}

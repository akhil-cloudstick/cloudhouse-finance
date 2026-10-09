package bank

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// List mirrors customer/loan/scheme's pagination convention: plain array
// when `limit` is absent (unchanged for existing callers, e.g. the web
// bank directory and NewLoan.tsx's SearchableSelect), {items, hasMore}
// envelope when present (the mobile app's paginated list).
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	// A bank account belongs to one business branch: with a branch selected
	// (or for a branch-confined role) only that branch's accounts are listed.
	scope := platform.GetBranchScope(c)

	if limit <= 0 {
		rec, _, _, _, err := h.svc.ListWithBalances(ctx, c.Query("q"), scope, 0, 0)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
		return
	}

	rec, total, totalBalance, unassigned, err := h.svc.ListWithBalances(ctx, c.Query("q"), scope, limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"items": rec, "hasMore": hasMore, "total": total,
		// Σ balance over every matching account (not just this page), and
		// bank-mode money recorded without naming a bank — together they make
		// the Bank balance card.
		"totalBalance": totalBalance, "unassignedBalance": unassigned,
	})
}

type bankRequest struct {
	Name      string `json:"name"`
	BranchID  uint   `json:"branchId"`
	Branch    string `json:"branch"`
	Ifsc      string `json:"ifsc"`
	AccountNo string `json:"accountNo"`
	Phone     string `json:"phone"`
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req bankRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, created, err := h.svc.FindOrCreate(ctx, CreateInput{Name: req.Name, BranchID: platform.EnforceBranchOnWrite(c, req.BranchID), Branch: req.Branch, Ifsc: req.Ifsc, AccountNo: req.AccountNo, Phone: req.Phone})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if created {
		httpx.Success(c, http.StatusCreated, rec)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// Get returns a single bank by id — the Bank Management admin screen's edit
// form and the Party Transactions page's bank header both need this.
func (h *Handler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(ctx, id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// Update is the Bank Management admin screen's real, explicit update —
// distinct from Create/FindOrCreate's reuse-or-create semantics.
func (h *Handler) Update(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req bankRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	branchID := req.BranchID
	if branchID != 0 {
		branchID = platform.EnforceBranchOnWrite(c, branchID)
	}
	rec, err := h.svc.Update(ctx, id, CreateInput{Name: req.Name, BranchID: branchID, Branch: req.Branch, Ifsc: req.Ifsc, AccountNo: req.AccountNo, Phone: req.Phone})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// Delete hard-deletes a bank — refused (ErrInUse) while any CashMovement/
// BankPledgeRecord still references it; see Service.Delete's doc comment.
func (h *Handler) Delete(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.svc.Delete(ctx, id); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"deleted": true})
}

type mergeRequest struct {
	TargetID uint `json:"targetId" binding:"required"`
}

// Merge reassigns a duplicate bank's history onto the canonical bank named
// by :id (the target) then deletes the source — see Service.Merge.
func (h *Handler) Merge(c *gin.Context) {
	ctx := platform.RequestContext(c)
	sourceID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req mergeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.Merge(ctx, sourceID, req.TargetID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

package reminder

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

type reminderRequest struct {
	CustomerID uint   `json:"customerId" binding:"required"`
	LoanID     *uint  `json:"loanId"`
	Type       string `json:"type" binding:"required"`
	DueDate    string `json:"dueDate" binding:"required"` // "YYYY-MM-DD"
	Note       string `json:"note"`
	Status     string `json:"status"`
	EmployeeID uint   `json:"employeeId"`
}

func parseDate(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	return time.Parse("2006-01-02", s)
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
	case errors.Is(err, ErrCustomerReq), errors.Is(err, ErrCustomerInvalid),
		errors.Is(err, ErrTypeInvalid), errors.Is(err, ErrDueDateReq):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) Create(c *gin.Context) {
	var req reminderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	dueDate, err := parseDate(req.DueDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dueDate: expected YYYY-MM-DD"})
		return
	}
	rec, err := h.svc.Create(CreateInput{
		CustomerID:          req.CustomerID,
		LoanID:              req.LoanID,
		Type:                req.Type,
		DueDate:             dueDate,
		Note:                req.Note,
		CreatedByEmployeeID: req.EmployeeID,
	})
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	var f Filter
	if v, _ := strconv.ParseUint(c.Query("customerId"), 10, 64); v != 0 {
		f.CustomerID = uint(v)
	}
	if v, _ := strconv.ParseUint(c.Query("loanId"), 10, 64); v != 0 {
		f.LoanID = uint(v)
	}
	f.Status = c.Query("status")
	if s := c.Query("from"); s != "" {
		if t, err := parseDate(s); err == nil {
			f.From = &t
		}
	}
	if s := c.Query("to"); s != "" {
		if t, err := parseDate(s); err == nil {
			f.To = &t
		}
	}
	f.BranchID = platform.GetBranchScope(c)
	rec, err := h.svc.List(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
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
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Update(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req reminderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	dueDate, err := parseDate(req.DueDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dueDate: expected YYYY-MM-DD"})
		return
	}
	rec, err := h.svc.Update(id, UpdateInput{
		Type:    req.Type,
		DueDate: dueDate,
		Note:    req.Note,
		Status:  req.Status,
	})
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Complete(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Complete(id)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// SendWhatsApp backs PUT /reminders/:id/send-whatsapp — texts the reminder's
// note to its customer over WhatsApp (via the OpenWA instance configured
// under Settings > WhatsApp) and marks the reminder Done.
func (h *Handler) SendWhatsApp(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.SendWhatsApp(id)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Delete(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Delete(id); err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// Calendar backs GET /reminders/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD —
// defaults to the current calendar month when either bound is omitted, so
// the frontend's initial load (no query params yet) just works.
func (h *Handler) Calendar(c *gin.Context) {
	now := time.Now()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	to := from.AddDate(0, 1, -1)

	if s := c.Query("from"); s != "" {
		if t, err := parseDate(s); err == nil {
			from = t
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from: expected YYYY-MM-DD"})
			return
		}
	}
	if s := c.Query("to"); s != "" {
		if t, err := parseDate(s); err == nil {
			to = t
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid to: expected YYYY-MM-DD"})
			return
		}
	}

	events, err := h.svc.GetCalendarEvents(from, to, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, events)
}

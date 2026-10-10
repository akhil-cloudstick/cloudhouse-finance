package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	loan "cloudhouse/backend/modules/Loan/controllers"
	personalLoan "cloudhouse/backend/modules/PersonalLoan/controllers"
	"cloudhouse/backend/modules/Reminder/models"
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

var validTypes = map[string]bool{
	"Follow-Up":      true,
	"Promise-to-Pay": true,
	"Custom":         true,
}

type reminderRequest struct {
	CustomerID uint   `json:"customer_id" binding:"required"`
	LoanID     *uint  `json:"loan_id"`
	Type       string `json:"type" binding:"required"`
	DueDate    string `json:"due_date" binding:"required"`
	Note       string `json:"note"`
	Status     string `json:"status"`
	EmployeeID uint   `json:"employee_id"`
}

type Filter struct {
	CustomerID uint
	LoanID     uint
	Status     string
	From       *time.Time
	To         *time.Time
	BranchID   *uint
	Query      string
	Limit      int
	Offset     int
}

type CreateInput struct {
	CustomerID          uint
	LoanID              *uint
	Type                string
	DueDate             time.Time
	Note                string
	CreatedByEmployeeID uint
}

type UpdateInput struct {
	Type    string
	DueDate time.Time
	Note    string
	Status  string
}

func parseDate(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	return time.Parse("2006-01-02", s)
}

func insertReminder(ctx context.Context, rem *models.Reminder) error {
	return config.DB.
		WithContext(ctx).Create(rem).Error
}

func persistReminder(ctx context.Context, rem *models.Reminder) error {
	return config.DB.
		WithContext(ctx).Save(rem).Error
}

func removeReminder(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Delete(&models.Reminder{}, id).Error
}

func findReminderByID(ctx context.Context, id uint) (*models.Reminder, error) {
	var rem models.Reminder
	if err := config.DB.
		WithContext(ctx).Preload("Customer").First(&rem, id).Error; err != nil {
		return nil, err
	}
	return &rem, nil
}

func findReminders(ctx context.Context, f Filter) ([]models.Reminder, int64, error) {
	q := config.DB.
		WithContext(ctx).Preload("Customer").Model(&models.Reminder{}).Order("reminders.due_date asc, reminders.id asc")
	if f.BranchID != nil || f.Query != "" {
		q = q.Joins("JOIN customers ON customers.id = reminders.customer_id")
	}
	if f.BranchID != nil {
		q = q.Where("customers.branch_id = ?", *f.BranchID)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("LEFT JOIN loans ON loans.id = reminders.loan_id").
			Where("customers.name ILIKE ? OR customers.code ILIKE ? OR loans.loan_number ILIKE ?", like, like, like)
	}
	if f.CustomerID != 0 {
		q = q.Where("reminders.customer_id = ?", f.CustomerID)
	}
	if f.LoanID != 0 {
		q = q.Where("reminders.loan_id = ?", f.LoanID)
	}
	if f.Status != "" {
		q = q.Where("reminders.status = ?", f.Status)
	}
	if f.From != nil {
		q = q.Where("reminders.due_date >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("reminders.due_date <= ?", *f.To)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	var reminders []models.Reminder
	err := q.Find(&reminders).Error
	return reminders, total, err
}

func businessName(ctx context.Context) string {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "your lender"
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil || t.Name == "" {
		return "your lender"
	}
	return t.Name
}

func validate(customerID uint, typ string, dueDate time.Time) error {
	if customerID == 0 {
		return common.NewBadRequest("customer is required")
	}
	if !validTypes[typ] {
		return common.NewBadRequest("type must be Follow-Up, Promise-to-Pay, or Custom")
	}
	if dueDate.IsZero() {
		return common.NewBadRequest("due date is required")
	}
	return nil
}

func SaveReminder(ctx context.Context, in CreateInput) (*models.Reminder, error) {
	if err := validate(in.CustomerID, in.Type, in.DueDate); err != nil {
		return nil, err
	}
	if _, err := common.FindCustomerByID(ctx, in.CustomerID); err != nil {
		return nil, common.NewBadRequest("customer does not exist")
	}
	rec := &models.Reminder{
		CustomerID:          in.CustomerID,
		LoanID:              in.LoanID,
		Type:                in.Type,
		DueDate:             in.DueDate,
		Note:                in.Note,
		Status:              "Pending",
		CreatedByEmployeeID: in.CreatedByEmployeeID,
	}
	if err := insertReminder(ctx, rec); err != nil {
		return nil, err
	}
	return findReminderByID(ctx, rec.ID)
}

func getReminder(ctx context.Context, id uint, branchID *uint) (*models.Reminder, error) {
	rec, err := findReminderByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("reminder not found")
	}
	if branchID != nil && rec.Customer.BranchID != *branchID {
		return nil, common.NewNotFound("reminder not found")
	}
	return rec, nil
}

func listReminders(ctx context.Context, f Filter) ([]models.Reminder, int64, error) {
	return findReminders(ctx, f)
}

func updateReminder(ctx context.Context, id uint, in UpdateInput) (*models.Reminder, error) {
	rec, err := findReminderByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("reminder not found")
	}
	if err := validate(rec.CustomerID, in.Type, in.DueDate); err != nil {
		return nil, err
	}
	rec.Type = in.Type
	rec.DueDate = in.DueDate
	rec.Note = in.Note
	if in.Status != "" {
		rec.Status = in.Status
	}
	if err := persistReminder(ctx, rec); err != nil {
		return nil, err
	}
	return findReminderByID(ctx, rec.ID)
}

func completeReminder(ctx context.Context, id uint) (*models.Reminder, error) {
	rec, err := findReminderByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("reminder not found")
	}
	rec.Status = "Done"
	if err := persistReminder(ctx, rec); err != nil {
		return nil, err
	}
	return findReminderByID(ctx, rec.ID)
}

func sendWhatsApp(ctx context.Context, id uint) (*models.Reminder, error) {
	rec, err := findReminderByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("reminder not found")
	}
	message := rec.Note
	if message == "" {
		message = fmt.Sprintf("This is a reminder from %s regarding your %s.", businessName(ctx), rec.Type)
	}
	sendErr := config.WhatsApp.
		Send(rec.Customer.Phone, message)
	if !config.IsDemoRun(ctx) {
		logRec := &commonModels.CommunicationLog{
			RecipientName:     rec.Customer.Name,
			RecipientPhone:    rec.Customer.Phone,
			ChatID:            common.NormalizeChatID(rec.Customer.Phone),
			Channel:           commonModels.ChannelWhatsApp,
			TriggerType:       "reminder",
			MessageBody:       message,
			RelatedEntityType: "reminder",
			RelatedEntityID:   rec.ID,
			Status:            commonModels.StatusSent,
		}
		if sendErr != nil {
			logRec.Status = commonModels.StatusFailed
			logRec.ErrorMessage = sendErr.Error()
		}
		_ = common.InsertCommLog(ctx, logRec)
	}
	if sendErr != nil {
		return nil, fmt.Errorf("sending whatsapp reminder: %w", sendErr)
	}
	rec.Status = "Done"
	if err := persistReminder(ctx, rec); err != nil {
		return nil, err
	}
	return findReminderByID(ctx, rec.ID)
}

func deleteReminder(ctx context.Context, id uint) error {
	if _, err := findReminderByID(ctx, id); err != nil {
		return common.NewNotFound("reminder not found")
	}
	return removeReminder(ctx, id)
}

func getCalendarEvents(ctx context.Context, from, to time.Time, branchID *uint, query string, page, pageSize int) ([]models.CalendarEvent, int, error) {
	from = truncateDay(from)
	to = truncateDay(to)
	var events []models.CalendarEvent
	loans, err := loan.FindOpenForCalendar(ctx)
	if err != nil {
		return nil, 0, err
	}
	now := truncateDay(time.Now())
	for _, l := range loans {
		if branchID != nil && l.BranchID != *branchID {
			continue
		}
		due := truncateDay(l.DueDate)
		custID := l.CustomerID
		custName := l.Customer.Name
		if !due.Before(from) && !due.After(to) {
			evType, title := "LoanDue", "Loan due"
			if due.Before(now) {
				evType, title = "Overdue", "Loan overdue"
			}
			events = append(events, models.CalendarEvent{
				Date:         due.Format("2006-01-02"),
				Type:         evType,
				Title:        fmt.Sprintf("%s — %s", title, l.LoanNumber),
				Detail:       custName,
				LoanID:       &l.ID,
				LoanNumber:   l.LoanNumber,
				CustomerID:   &custID,
				CustomerName: custName,
				CustomerCode: l.Customer.Code,
			})
		}
		if due.Before(now) && (due.Before(from) || due.After(to)) && !now.Before(from) && !now.After(to) {
			events = append(events, models.CalendarEvent{
				Date:         now.Format("2006-01-02"),
				Type:         "Overdue",
				Title:        fmt.Sprintf("Loan overdue — %s", l.LoanNumber),
				Detail:       custName,
				LoanID:       &l.ID,
				LoanNumber:   l.LoanNumber,
				CustomerID:   &custID,
				CustomerName: custName,
				CustomerCode: l.Customer.Code,
			})
		}
		for _, occ := range monthlyOccurrences(l.OpenedDate, from, to) {
			events = append(events, models.CalendarEvent{
				Date:         occ.Format("2006-01-02"),
				Type:         "InterestDue",
				Title:        fmt.Sprintf("Interest payment reminder — %s", l.LoanNumber),
				Detail:       custName,
				LoanID:       &l.ID,
				LoanNumber:   l.LoanNumber,
				CustomerID:   &custID,
				CustomerName: custName,
				CustomerCode: l.Customer.Code,
			})
		}
	}
	{
		installments, err := personalLoan.ListPendingInstallmentsForCalendar(ctx, branchID)
		if err != nil {
			return nil, 0, err
		}
		for _, inst := range installments {
			due := truncateDay(inst.DueDate)
			loanID := inst.LoanID
			if !due.Before(from) && !due.After(to) {
				evType, title := "PersonalLoanDue", "Installment due"
				if due.Before(now) {
					evType, title = "PersonalLoanOverdue", "Installment overdue"
				}
				events = append(events, models.CalendarEvent{
					Date:           due.Format("2006-01-02"),
					Type:           evType,
					Title:          fmt.Sprintf("%s — %s", title, inst.LoanNumber),
					Detail:         inst.CustomerName,
					PersonalLoanID: &loanID,
					LoanNumber:     inst.LoanNumber,
					CustomerID:     &inst.CustomerID,
					CustomerName:   inst.CustomerName,
					CustomerCode:   inst.CustomerCode,
				})
			}
			if due.Before(now) && (due.Before(from) || due.After(to)) && !now.Before(from) && !now.After(to) {
				events = append(events, models.CalendarEvent{
					Date:           now.Format("2006-01-02"),
					Type:           "PersonalLoanOverdue",
					Title:          fmt.Sprintf("Installment overdue — %s", inst.LoanNumber),
					Detail:         inst.CustomerName,
					PersonalLoanID: &loanID,
					LoanNumber:     inst.LoanNumber,
					CustomerID:     &inst.CustomerID,
					CustomerName:   inst.CustomerName,
					CustomerCode:   inst.CustomerCode,
				})
			}
		}
	}
	scheduledAuctions, err := loan.FindScheduledForCalendar(ctx)
	if err != nil {
		return nil, 0, err
	}
	for _, a := range scheduledAuctions {
		if branchID != nil && a.BranchID != *branchID {
			continue
		}
		date := truncateDay(a.AuctionDate)
		if date.Before(from) || date.After(to) {
			continue
		}
		loanID := a.LoanID
		custID := a.CustomerID
		events = append(events, models.CalendarEvent{
			Date:         date.Format("2006-01-02"),
			Type:         "AuctionScheduled",
			Title:        fmt.Sprintf("Auction scheduled — %s", a.LoanNumber),
			Detail:       a.CustomerName,
			LoanID:       &loanID,
			LoanNumber:   a.LoanNumber,
			CustomerID:   &custID,
			CustomerName: a.CustomerName,
			CustomerCode: a.CustomerCode,
		})
	}
	from2, to2 := from, to
	reminders, _, err := findReminders(ctx, Filter{From: &from2, To: &to2, BranchID: branchID})
	if err != nil {
		return nil, 0, err
	}
	for _, r := range reminders {
		evType := "Custom"
		switch r.Type {
		case "Follow-Up":
			evType = "FollowUp"
		case "Promise-to-Pay":
			evType = "PromiseToPay"
		}
		rID := r.ID
		custID := r.CustomerID
		events = append(events, models.CalendarEvent{
			Date:         truncateDay(r.DueDate).Format("2006-01-02"),
			Type:         evType,
			Title:        fmt.Sprintf("%s — %s", r.Type, r.Customer.Name),
			Detail:       r.Note,
			LoanID:       r.LoanID,
			CustomerID:   &custID,
			CustomerName: r.Customer.Name,
			CustomerCode: r.Customer.Code,
			ReminderID:   &rID,
			Status:       r.Status,
		})
	}
	events = filterCalendarEvents(events, query)
	isOverdue := func(e models.CalendarEvent) bool { return e.Type == "Overdue" || e.Type == "PersonalLoanOverdue" }
	sort.SliceStable(events, func(i, j int) bool {
		a, b := events[i], events[j]
		if isOverdue(a) != isOverdue(b) {
			return isOverdue(a)
		}
		return a.Date < b.Date
	})
	total := len(events)
	if page <= 0 || pageSize <= 0 {
		return events, total, nil
	}
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return events[start:end], total, nil
}

func filterCalendarEvents(events []models.CalendarEvent, query string) []models.CalendarEvent {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return events
	}
	kept := events[:0]
	for _, e := range events {
		if strings.Contains(strings.ToLower(e.CustomerName), needle) ||
			strings.Contains(strings.ToLower(e.CustomerCode), needle) ||
			strings.Contains(strings.ToLower(e.LoanNumber), needle) {
			kept = append(kept, e)
		}
	}
	return kept
}

func truncateDay(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

func monthlyOccurrences(openedDate, from, to time.Time) []time.Time {
	var out []time.Time
	if openedDate.IsZero() || to.Before(openedDate) {
		return out
	}
	day := openedDate.Day()
	// Start at the first monthly anniversary on/after `from` (but never before openedDate itself).
	year, month := from.Year(), from.Month()
	if from.Before(openedDate) {
		year, month = openedDate.Year(), openedDate.Month()
	}
	cursor := time.Date(year, month, day, 0, 0, 0, 0, openedDate.Location())
	if cursor.Before(openedDate) {
		cursor = cursor.AddDate(0, 1, 0)
	}
	for !cursor.After(to) {
		if !cursor.Before(from) {
			out = append(out, cursor)
		}
		cursor = cursor.AddDate(0, 1, 0)
	}
	return out
}

func CreateReminder(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req reminderRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	dueDate, err := parseDate(req.DueDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid due_date: expected YYYY-MM-DD"})
	}
	rec, err := SaveReminder(ctx, CreateInput{
		CustomerID:          req.CustomerID,
		LoanID:              req.LoanID,
		Type:                req.Type,
		DueDate:             dueDate,
		Note:                req.Note,
		CreatedByEmployeeID: req.EmployeeID,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListReminders(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	var f Filter
	if v, _ := strconv.ParseUint(c.QueryParam("customer_id"), 10, 64); v != 0 {
		f.CustomerID = uint(v)
	}
	if v, _ := strconv.ParseUint(c.QueryParam("loan_id"), 10, 64); v != 0 {
		f.LoanID = uint(v)
	}
	f.Status = c.QueryParam("status")
	if s := c.QueryParam("from"); s != "" {
		if t, err := parseDate(s); err == nil {
			f.From = &t
		}
	}
	if s := c.QueryParam("to"); s != "" {
		if t, err := parseDate(s); err == nil {
			f.To = &t
		}
	}
	f.BranchID = auth.GetBranchScope(c)
	f.Query = strings.TrimSpace(c.QueryParam("search"))
	if limit > 0 {
		f.Limit, f.Offset = limit, offset
		rec, total, err := listReminders(ctx, f)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := listReminders(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func GetReminderById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getReminder(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func UpdateReminder(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req reminderRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	dueDate, err := parseDate(req.DueDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid due_date: expected YYYY-MM-DD"})
	}
	rec, err := updateReminder(ctx, id, UpdateInput{
		Type:    req.Type,
		DueDate: dueDate,
		Note:    req.Note,
		Status:  req.Status,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func CompleteReminder(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := completeReminder(ctx, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SendReminderWhatsApp(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := sendWhatsApp(ctx, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func DeleteReminder(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := deleteReminder(ctx, id); err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessMessage(c, http.StatusOK, "Reminder deleted successfully")
}

func GetReminderCalendar(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, _ := strconv.Atoi(c.QueryParam("page"))
	pageSize, _ := strconv.Atoi(c.QueryParam("page_size"))
	now := time.Now()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	to := from.AddDate(0, 1, -1)
	if s := c.QueryParam("from"); s != "" {
		if t, err := parseDate(s); err == nil {
			from = t
		} else {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid from: expected YYYY-MM-DD"})
		}
	}
	if s := c.QueryParam("to"); s != "" {
		if t, err := parseDate(s); err == nil {
			to = t
		} else {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid to: expected YYYY-MM-DD"})
		}
	}
	events, total, err := getCalendarEvents(ctx, from, to, auth.GetBranchScope(c), strings.TrimSpace(c.QueryParam("search")), page, pageSize)
	if err != nil {
		return common.FailErr(c, err)
	}
	if page > 0 && pageSize > 0 {
		return common.Success(c, http.StatusOK, echo.Map{"events": events, "total_count": total})
	}
	return common.Success(c, http.StatusOK, events)
}

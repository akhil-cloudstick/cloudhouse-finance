package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/SuperAdmin/models"
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

var PaymentModes = map[string]bool{
	"cash": true, "bank_transfer": true, "upi": true, "cheque": true, "card": true, "other": true,
}

var openLoanStatuses = []string{
	"Pending Approval", "Active", "Due Soon", "Overdue", "Closure Requested",
	"Defaulted", "Auction Eligible", "Auctioned - Balance Due",
}

type SubscriptionPayment struct {
	ID             uint       `json:"id" gorm:"primaryKey"`
	TenantID       uint       `json:"tenant_id" gorm:"not null;index"`
	AmountInPaise  int64      `json:"amount_in_paise" gorm:"not null"`
	PaidOn         time.Time  `json:"paid_on" gorm:"not null;type:date"`
	Mode           string     `json:"mode" gorm:"not null;size:20"`
	Reference      string     `json:"reference" gorm:"size:120"`
	Note           string     `json:"note" gorm:"size:500"`
	PeriodFrom     *time.Time `json:"period_from,omitempty" gorm:"type:date"`
	PeriodTo       *time.Time `json:"period_to,omitempty" gorm:"type:date"`
	PlanName       string     `json:"plan_name" gorm:"size:60"`
	RecordedByID   uint       `json:"recorded_by_id" gorm:"not null"`
	RecordedByName string     `json:"recorded_by_name" gorm:"not null;size:120"`
	CreatedAt      time.Time  `json:"created_at"`
}

type BusinessUsage struct {
	Branches             int64      `json:"branches"`
	BranchesTotal        int64      `json:"branches_total"`
	BranchQuota          uint       `json:"branch_quota"`
	Unlimited            bool       `json:"unlimited"`
	Employees            int64      `json:"employees"`
	Customers            int64      `json:"customers"`
	LoansTotal           int64      `json:"loans_total"`
	LoansActive          int64      `json:"loans_active"`
	PersonalLoans        int64      `json:"personal_loans_active"`
	Investments          int64      `json:"investments_active"`
	GoldSales            int64      `json:"gold_sales"`
	Files                int64      `json:"files"`
	StorageBytes         int64      `json:"storage_bytes"`
	OutstandingPrincipal float64    `json:"outstanding_principal"`
	LastActivityAt       *time.Time `json:"last_activity_at,omitempty"`
}

type BusinessOverview struct {
	Business    *commonModels.Tenant  `json:"business"`
	Usage       BusinessUsage         `json:"usage"`
	Payments    []SubscriptionPayment `json:"payments"`
	TotalPaid   int64                 `json:"total_paid_in_paise"`
	LastPayment *SubscriptionPayment  `json:"last_payment,omitempty"`
	RecentAudit []models.AuditLog     `json:"recent_activity"`
}

type RecordPaymentInput struct {
	AmountInPaise int64
	PaidOn        string
	Mode          string
	Reference     string
	Note          string
	PeriodFrom    string
	PeriodTo      string
}

type recordPaymentRequest struct {
	AmountInPaise int64  `json:"amount_in_paise"`
	PaidOn        string `json:"paid_on"`
	Mode          string `json:"mode"`
	Reference     string `json:"reference"`
	Note          string `json:"note"`
	PeriodFrom    string `json:"period_from"`
	PeriodTo      string `json:"period_to"`
}

func businessOverview(ctx context.Context, id uint) (*BusinessOverview, error) {
	crossCtx := config.AllowCrossTenant(ctx)
	t, err := common.FindTenantByID(crossCtx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	usage, err := businessUsage(crossCtx, t)
	if err != nil {
		return nil, err
	}
	payments, err := listPayments(ctx, id)
	if err != nil {
		return nil, err
	}
	var total int64
	for _, p := range payments {
		total += p.AmountInPaise
	}
	out := &BusinessOverview{Business: t, Usage: *usage, Payments: payments, TotalPaid: total}
	if len(payments) > 0 {
		out.LastPayment = &payments[0]
	}
	tid := id
	out.RecentAudit, err = findAuditLogs(ctx, AuditLogFilter{TenantID: &tid, Limit: 20})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func businessUsage(ctx context.Context, t *commonModels.Tenant) (*BusinessUsage, error) {
	db := config.BaseDB.
		WithContext(ctx)
	scoped := func(table string) *gorm.DB {
		return db.Table(table).Where(table+".tenant_id = ?", t.ID)
	}
	u := &BusinessUsage{BranchQuota: t.Tier.BranchQuota, Unlimited: common.TierIsUnlimited(t.Tier)}
	counts := []struct {
		dst   *int64
		table string
		where string
		args  []any
	}{
		{&u.Branches, "branches", "is_active = true AND deleted_at IS NULL", nil},
		{&u.BranchesTotal, "branches", "deleted_at IS NULL", nil},
		{&u.Employees, "employees", "deleted_at IS NULL", nil},
		{&u.Customers, "customers", "deleted_at IS NULL", nil},
		{&u.LoansTotal, "loans", "deleted_at IS NULL", nil},
		{&u.LoansActive, "loans", "deleted_at IS NULL AND status IN ?", []any{openLoanStatuses}},
		{&u.PersonalLoans, "personal_loans", "status = ?", []any{"Active"}},
		{&u.Investments, "investments", "status = ?", []any{"Active"}},
		{&u.GoldSales, "gold_sales", "", nil},
		{&u.Files, "uploaded_files", "", nil},
	}
	for _, c := range counts {
		q := scoped(c.table)
		if c.where != "" {
			q = q.Where(c.where, c.args...)
		}
		if err := q.Count(c.dst).Error; err != nil {
			// A table a module never created (fresh install, module never migrated) should not take the whole page down.
			if isMissingRelation(err) {
				continue
			}
			return nil, fmt.Errorf("usage count %s: %w", c.table, err)
		}
	}
	if err := scoped("uploaded_files").Select("COALESCE(SUM(size_bytes), 0)").Scan(&u.StorageBytes).Error; err != nil {
		return nil, fmt.Errorf("usage storage: %w", err)
	}
	if err := scoped("loans").Where("deleted_at IS NULL AND status IN ?", openLoanStatuses).
		Select("COALESCE(SUM(outstanding_amount), 0)").Scan(&u.OutstandingPrincipal).Error; err != nil {
		return nil, fmt.Errorf("usage outstanding: %w", err)
	}
	var last sql.NullTime
	if err := scoped("audit_log_entries").Select("MAX(created_at)").Row().Scan(&last); err != nil && !isMissingRelation(err) {
		return nil, fmt.Errorf("usage last activity: %w", err)
	}
	if last.Valid {
		u.LastActivityAt = &last.Time
	}
	return u, nil
}

func isMissingRelation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "does not exist")
}

func listPayments(ctx context.Context, tenantID uint) ([]SubscriptionPayment, error) {
	var out []SubscriptionPayment
	err := config.BaseDB.
		WithContext(config.AllowCrossTenant(ctx)).
		Where("tenant_id = ?", tenantID).
		Order("paid_on desc, id desc").Find(&out).Error
	if out == nil {
		out = []SubscriptionPayment{}
	}
	return out, err
}

func recordPayment(ctx context.Context, actor *models.SuperAdminUser, tenantID uint, in RecordPaymentInput) (*SubscriptionPayment, error) {
	crossCtx := config.AllowCrossTenant(ctx)
	t, err := common.FindTenantByID(crossCtx, tenantID)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	if in.AmountInPaise <= 0 {
		return nil, common.NewBadRequest("payment amount must be greater than zero")
	}
	mode := strings.TrimSpace(in.Mode)
	if !PaymentModes[mode] {
		return nil, common.NewBadRequest("payment mode must be one of cash, bank_transfer, upi, cheque, card, other")
	}
	paidOn, err := time.Parse("2006-01-02", strings.TrimSpace(in.PaidOn))
	if err != nil || paidOn.After(time.Now()) {
		return nil, common.NewBadRequest("payment date is required (YYYY-MM-DD) and cannot be in the future")
	}
	from, err := optionalDate(in.PeriodFrom)
	if err != nil {
		return nil, common.NewBadRequest("invalid period start: expected YYYY-MM-DD")
	}
	to, err := optionalDate(in.PeriodTo)
	if err != nil {
		return nil, common.NewBadRequest("invalid period end: expected YYYY-MM-DD")
	}
	if from != nil && to != nil && to.Before(*from) {
		return nil, common.NewBadRequest("the period end cannot be before the period start")
	}
	rec := &SubscriptionPayment{
		TenantID:       t.ID,
		AmountInPaise:  in.AmountInPaise,
		PaidOn:         paidOn,
		Mode:           mode,
		Reference:      strings.TrimSpace(in.Reference),
		Note:           strings.TrimSpace(in.Note),
		PeriodFrom:     from,
		PeriodTo:       to,
		PlanName:       t.Tier.Name,
		RecordedByID:   actor.ID,
		RecordedByName: actor.Name,
	}
	if err := config.BaseDB.
		WithContext(crossCtx).Create(rec).Error; err != nil {
		return nil, err
	}
	tid := t.ID
	auditBusiness(ctx, actor, "record_payment", &tid, t.Name,
		fmt.Sprintf("recorded payment of ₹%s (%s) paid on %s", rupees(rec.AmountInPaise), mode, paidOn.Format("2006-01-02")),
		rec.Note)
	return rec, nil
}

func deletePayment(ctx context.Context, actor *models.SuperAdminUser, tenantID, paymentID uint, reason string) error {
	if err := validateReason(reason); err != nil {
		return err
	}
	crossCtx := config.AllowCrossTenant(ctx)
	t, err := common.FindTenantByID(crossCtx, tenantID)
	if err != nil {
		return common.NewNotFound("business not found")
	}
	var rec SubscriptionPayment
	if err := config.BaseDB.
		WithContext(crossCtx).
		Where("id = ? AND tenant_id = ?", paymentID, tenantID).First(&rec).Error; err != nil {
		return common.NewNotFound("payment not found")
	}
	if err := config.BaseDB.
		WithContext(crossCtx).Delete(&rec).Error; err != nil {
		return err
	}
	tid := t.ID
	auditBusiness(ctx, actor, "delete_payment", &tid, t.Name,
		fmt.Sprintf("deleted recorded payment of ₹%s (%s) paid on %s", rupees(rec.AmountInPaise), rec.Mode, rec.PaidOn.Format("2006-01-02")),
		reason)
	return nil
}

func optionalDate(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func rupees(paise int64) string {
	return fmt.Sprintf("%d.%02d", paise/100, paise%100)
}

func GetBusinessOverview(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	out, err := businessOverview(auth.RequestContext(c), id)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, out)
}

func ListBusinessPayments(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	ctx := auth.RequestContext(c)
	if _, err := getBusiness(config.AllowCrossTenant(ctx), id); err != nil {
		return common.FailErr(c, err)
	}
	out, err := listPayments(ctx, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, out)
}

func RecordBusinessPayment(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req recordPaymentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	rec, err := recordPayment(auth.RequestContext(c), actor(c), id, RecordPaymentInput{
		AmountInPaise: req.AmountInPaise,
		PaidOn:        req.PaidOn,
		Mode:          req.Mode,
		Reference:     req.Reference,
		Note:          req.Note,
		PeriodFrom:    req.PeriodFrom,
		PeriodTo:      req.PeriodTo,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func DeleteBusinessPayment(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	paymentID, err := common.IDParam(c, "payment_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req reasonRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	if err := deletePayment(auth.RequestContext(c), actor(c), id, paymentID, req.Reason); err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"deleted": true})
}

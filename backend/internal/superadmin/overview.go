package superadmin

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
)

// SubscriptionPayment is one payment a business made to the vendor for its
// plan, recorded BY HAND by a superadmin.
//
// Information only: nothing is charged, collected or reconciled through this
// table, and no other code reads it to decide anything (expiry, status and
// plan are still changed with their own actions). It exists so the business
// detail page can answer "what has this business paid us, and when".
//
// Vendor-side and deliberately NOT tenant-scoped: the business's own staff
// never read it, and it is written/read only from the superadmin console
// under platform.AllowCrossTenant with an explicit tenant_id predicate.
type SubscriptionPayment struct {
	ID       uint `json:"id" gorm:"primaryKey"`
	TenantID uint `json:"tenantId" gorm:"not null;index"`

	AmountInPaise int64     `json:"amountInPaise" gorm:"not null"`
	PaidOn        time.Time `json:"paidOn" gorm:"not null;type:date"`
	Mode          string    `json:"mode" gorm:"not null;size:20"`
	Reference     string    `json:"reference" gorm:"size:120"`
	Note          string    `json:"note" gorm:"size:500"`

	// PeriodFrom/PeriodTo optionally record which plan period the payment
	// covers. Purely descriptive, like everything else here.
	PeriodFrom *time.Time `json:"periodFrom,omitempty" gorm:"type:date"`
	PeriodTo   *time.Time `json:"periodTo,omitempty" gorm:"type:date"`

	// PlanName snapshots the plan at recording time, so a later plan change
	// does not rewrite what this payment was for.
	PlanName string `json:"planName" gorm:"size:60"`

	RecordedByID   uint      `json:"recordedById" gorm:"not null"`
	RecordedByName string    `json:"recordedByName" gorm:"not null;size:120"`
	CreatedAt      time.Time `json:"createdAt"`
}

func (SubscriptionPayment) TableName() string { return "subscription_payments" }

// PaymentModes is the closed set a recorded payment may use.
var PaymentModes = map[string]bool{
	"cash": true, "bank_transfer": true, "upi": true, "cheque": true, "card": true, "other": true,
}

var (
	ErrPaymentAmount   = httpx.NewBadRequest("payment amount must be greater than zero")
	ErrPaymentMode     = httpx.NewBadRequest("payment mode must be one of cash, bank_transfer, upi, cheque, card, other")
	ErrPaymentDate     = httpx.NewBadRequest("payment date is required (YYYY-MM-DD) and cannot be in the future")
	ErrPaymentPeriod   = httpx.NewBadRequest("the period end cannot be before the period start")
	ErrPaymentNotFound = httpx.NewNotFound("payment not found")
)

const (
	ActionRecordPayment = "record_payment"
	ActionDeletePayment = "delete_payment"
)

// BusinessUsage is the "how much is this business using" block of the
// detail page. Every figure is a plain count/sum over that ONE business's
// rows (explicit tenant_id predicate — see usageCount).
type BusinessUsage struct {
	Branches      int64 `json:"branches"`      // active, not deleted
	BranchesTotal int64 `json:"branchesTotal"` // including deactivated
	BranchQuota   uint  `json:"branchQuota"`   // 0 = unlimited
	Unlimited     bool  `json:"unlimited"`
	Employees     int64 `json:"employees"`
	Customers     int64 `json:"customers"`
	LoansTotal    int64 `json:"loansTotal"`
	LoansActive   int64 `json:"loansActive"`
	PersonalLoans int64 `json:"personalLoansActive"`
	Investments   int64 `json:"investmentsActive"`
	GoldSales     int64 `json:"goldSales"`
	Files         int64 `json:"files"`
	StorageBytes  int64 `json:"storageBytes"`

	// OutstandingPrincipal is the sum of OutstandingAmount over open gold
	// loans, in rupees (the loans table stores numeric rupees).
	OutstandingPrincipal float64 `json:"outstandingPrincipal"`

	// LastActivityAt is the most recent entry in the business's own audit
	// log — the closest thing to "last used" the schema records.
	LastActivityAt *time.Time `json:"lastActivityAt,omitempty"`
}

// BusinessOverview is everything the superadmin business detail page shows.
type BusinessOverview struct {
	Business    *tenant.Tenant        `json:"business"`
	Usage       BusinessUsage         `json:"usage"`
	Payments    []SubscriptionPayment `json:"payments"`
	TotalPaid   int64                 `json:"totalPaidInPaise"`
	LastPayment *SubscriptionPayment  `json:"lastPayment,omitempty"`
	RecentAudit []AuditLog            `json:"recentActivity"`
}

// openLoanStatuses are the loan states that still hold a customer's gold and
// principal — everything except closed, rejected and fully auctioned.
var openLoanStatuses = []string{
	"Pending Approval", "Active", "Due Soon", "Overdue", "Closure Requested",
	"Defaulted", "Auction Eligible", "Auctioned - Balance Due",
}

// BusinessOverview assembles the detail page for one business.
func (s *Service) BusinessOverview(ctx context.Context, id uint) (*BusinessOverview, error) {
	crossCtx := platform.AllowCrossTenant(ctx)
	t, err := s.tenantRepo.FindByID(crossCtx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}

	usage, err := s.businessUsage(crossCtx, t)
	if err != nil {
		return nil, err
	}

	payments, err := s.ListPayments(ctx, id)
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
	out.RecentAudit, err = s.repo.FindAuditLogs(ctx, AuditLogFilter{TenantID: &tid, Limit: 20})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// businessUsage runs every usage figure for one business. ctx is already
// cross-tenant (the superadmin has no tenant of its own), so every query
// names tenant_id explicitly — that predicate is the ONLY thing keeping one
// business's numbers out of another's, and it is applied in one place.
func (s *Service) businessUsage(ctx context.Context, t *tenant.Tenant) (*BusinessUsage, error) {
	db := s.db.WithContext(ctx)
	scoped := func(table string) *gorm.DB {
		return db.Table(table).Where(table+".tenant_id = ?", t.ID)
	}
	u := &BusinessUsage{BranchQuota: t.Tier.BranchQuota, Unlimited: t.Tier.IsUnlimited()}

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
			// A table a module never created (fresh install, module never
			// migrated) should not take the whole page down.
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
	// NullTime: MAX over zero rows is NULL, which is every brand-new business.
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

// ListPayments returns a business's recorded payments, newest first.
func (s *Service) ListPayments(ctx context.Context, tenantID uint) ([]SubscriptionPayment, error) {
	var out []SubscriptionPayment
	err := s.db.WithContext(platform.AllowCrossTenant(ctx)).
		Where("tenant_id = ?", tenantID).
		Order("paid_on desc, id desc").Find(&out).Error
	if out == nil {
		out = []SubscriptionPayment{}
	}
	return out, err
}

// RecordPaymentInput is one hand-recorded payment.
type RecordPaymentInput struct {
	AmountInPaise int64
	PaidOn        string // YYYY-MM-DD
	Mode          string
	Reference     string
	Note          string
	PeriodFrom    string // optional YYYY-MM-DD
	PeriodTo      string // optional YYYY-MM-DD
}

// RecordPayment adds one payment to a business's history. Information only
// — it changes nothing about the business's status, plan or expiry.
func (s *Service) RecordPayment(ctx context.Context, actor *SuperAdminUser, tenantID uint, in RecordPaymentInput) (*SubscriptionPayment, error) {
	crossCtx := platform.AllowCrossTenant(ctx)
	t, err := s.tenantRepo.FindByID(crossCtx, tenantID)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	if in.AmountInPaise <= 0 {
		return nil, ErrPaymentAmount
	}
	mode := strings.TrimSpace(in.Mode)
	if !PaymentModes[mode] {
		return nil, ErrPaymentMode
	}
	paidOn, err := time.Parse("2006-01-02", strings.TrimSpace(in.PaidOn))
	if err != nil || paidOn.After(time.Now()) {
		return nil, ErrPaymentDate
	}
	from, err := optionalDate(in.PeriodFrom)
	if err != nil {
		return nil, httpx.NewBadRequest("invalid period start: expected YYYY-MM-DD")
	}
	to, err := optionalDate(in.PeriodTo)
	if err != nil {
		return nil, httpx.NewBadRequest("invalid period end: expected YYYY-MM-DD")
	}
	if from != nil && to != nil && to.Before(*from) {
		return nil, ErrPaymentPeriod
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
	if err := s.db.WithContext(crossCtx).Create(rec).Error; err != nil {
		return nil, err
	}
	tid := t.ID
	s.audit(ctx, actor, ActionRecordPayment, &tid, t.Name,
		fmt.Sprintf("recorded payment of ₹%s (%s) paid on %s", rupees(rec.AmountInPaise), mode, paidOn.Format("2006-01-02")),
		rec.Note)
	return rec, nil
}

// DeletePayment removes a payment recorded by mistake. The audit log keeps
// the record that it existed and why it was removed.
func (s *Service) DeletePayment(ctx context.Context, actor *SuperAdminUser, tenantID, paymentID uint, reason string) error {
	if err := validateReason(reason); err != nil {
		return err
	}
	crossCtx := platform.AllowCrossTenant(ctx)
	t, err := s.tenantRepo.FindByID(crossCtx, tenantID)
	if err != nil {
		return ErrBusinessNotFound
	}
	var rec SubscriptionPayment
	// Both ids are required to match, so a payment id from another business
	// can never be deleted through this business's URL.
	if err := s.db.WithContext(crossCtx).
		Where("id = ? AND tenant_id = ?", paymentID, tenantID).First(&rec).Error; err != nil {
		return ErrPaymentNotFound
	}
	if err := s.db.WithContext(crossCtx).Delete(&rec).Error; err != nil {
		return err
	}
	tid := t.ID
	s.audit(ctx, actor, ActionDeletePayment, &tid, t.Name,
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

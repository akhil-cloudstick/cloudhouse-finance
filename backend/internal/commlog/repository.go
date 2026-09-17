package commlog

import (
	"context"
	"regexp"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

var nonDigits = regexp.MustCompile(`\D`)

// NormalizeChatID mirrors platform.OpenWASender's own (unexported) phone ->
// chat-id normalization, duplicated here in miniature so commlog doesn't
// need to import internal/platform just for this. Only used for display/
// audit purposes — the actual send always goes through the real sender.
func NormalizeChatID(phone string) string {
	digits := nonDigits.ReplaceAllString(phone, "")
	if len(digits) == 11 && digits[0] == '0' {
		digits = digits[1:]
	}
	if len(digits) == 10 {
		digits = "91" + digits
	}
	return digits + "@c.us"
}

// Repository provides GORM-backed persistence for CommunicationLog records.
type Repository struct {
	db   platform.DB
	base *gorm.DB // unpinned handle to the shared pool, for CreateBackground's own short-lived pin
}

func NewRepository(db platform.DB, base *gorm.DB) *Repository {
	return &Repository{db: db, base: base}
}

func (r *Repository) Create(ctx context.Context, rec *CommunicationLog) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

// CreateBackground is Create for a caller running in a goroutine that
// outlives the HTTP request it started in — e.g. loan.Service.notifyCustomer,
// which sends WhatsApp notifications on its own goroutine so a slow/
// unreachable gateway doesn't hold the request open (see its doc comment).
//
// ctx there is the request's context (via context.WithoutCancel, so it isn't
// cancelled early, but still CARRIES the request's pinned-connection value):
// platform.PinTenantConn's deferred release() closes that *sql.Conn the
// instant the HTTP handler returns, almost always before this goroutine's
// write runs, so Create on it fails every time with "sql: connection is
// already closed" — silently dropping the audit row for every
// loan/reminder/auth notification. Confirmed against this exact repo: rows
// written from the reminder cron (no HTTP request, so no pinned connection
// to lose) succeed; rows attempted from a request handler's background
// goroutine (loan submission, sanction, approval, …) never landed.
//
// The fix is to check out a SEPARATE connection scoped to rec's own tenant —
// never write unpinned, since this table is Row-Level-Security-scoped by
// TenantID and an unpinned write would run without app.tenant_id set — held
// only for this one insert, so it has nothing to race against.
func (r *Repository) CreateBackground(tenantID uint, rec *CommunicationLog) error {
	// WithTenant is required alongside PinConn's own set_config: PinConn only
	// tells POSTGRES which business this connection speaks for (RLS); GORM's
	// own tenant-stamp callback (platform.stampCallback) separately reads the
	// tenant from the Go context on every Create, and stamps ErrNoTenantInContext
	// instead of a row if it's missing.
	ctx := platform.WithTenant(context.Background(), tenantID)
	ctx, release, err := platform.PinConn(ctx, r.base, tenantID)
	if err != nil {
		return err
	}
	defer release()
	return platform.NewConnPinner(r.base).WithContext(ctx).Create(rec).Error
}

// Filter mirrors the query params the Communication History report accepts
// (internal/reports). All fields optional/zero-value-means-"don't filter".
type Filter struct {
	From              *time.Time
	To                *time.Time
	Channel           string
	TriggerType       string
	RelatedEntityType string
	Status            string
}

// List returns matching communication log rows, newest first.
func (r *Repository) List(ctx context.Context, f Filter) ([]CommunicationLog, error) {
	var rows []CommunicationLog
	q := r.db.WithContext(ctx).Model(&CommunicationLog{}).Order("created_at desc, id desc")
	q = applyFilter(q, f)
	err := q.Find(&rows).Error
	return rows, err
}

// Count returns how many rows match f — used by the reports handler to
// report total_count alongside a paginated slice.
func (r *Repository) Count(ctx context.Context, f Filter) (int64, error) {
	var count int64
	q := r.db.WithContext(ctx).Model(&CommunicationLog{})
	q = applyFilter(q, f)
	err := q.Count(&count).Error
	return count, err
}

func applyFilter(q *gorm.DB, f Filter) *gorm.DB {
	if f.From != nil {
		q = q.Where("created_at >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("created_at <= ?", *f.To)
	}
	if f.Channel != "" {
		q = q.Where("channel = ?", f.Channel)
	}
	if f.TriggerType != "" {
		q = q.Where("trigger_type = ?", f.TriggerType)
	}
	if f.RelatedEntityType != "" {
		q = q.Where("related_entity_type = ?", f.RelatedEntityType)
	}
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	return q
}

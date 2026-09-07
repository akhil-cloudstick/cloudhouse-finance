package reports

import (
	"context"
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/tenant"
)

// Service implements every report's query/aggregation logic directly
// against the database (see model.go's package doc comment for why this
// package queries by table name rather than importing every domain
// package's GORM model).
type Service struct {
	db          *gorm.DB
	commlogRepo *commlog.Repository
	tenantRepo  *tenant.Repository
}

func NewService(db *gorm.DB, commlogRepo *commlog.Repository, tenantRepo *tenant.Repository) *Service {
	return &Service{db: db, commlogRepo: commlogRepo, tenantRepo: tenantRepo}
}

// BusinessName resolves the tenant's own display name for the PDF export's
// letterhead line (multi-tenancy plan, Step 9) — exported since Handler.Export
// calls it directly. Falls back to a neutral label rather than another
// business's name if the lookup fails for any reason.
func (s *Service) BusinessName(ctx context.Context) string {
	id, ok := platform.TenantFromContext(ctx)
	if !ok {
		return "Gold Loan Report"
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil || t.Name == "" {
		return "Gold Loan Report"
	}
	return t.Name
}

// dateRange defaults an unset From/To to a wide-open range so a report with
// no filters supplied returns "everything" rather than nothing.
func dateRange(f Filter) (from, to time.Time) {
	from = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	to = time.Now().AddDate(1, 0, 0)
	if f.From != nil {
		from = *f.From
	}
	if f.To != nil {
		// Inclusive of the whole "to" day.
		to = f.To.AddDate(0, 0, 1)
	}
	return from, to
}

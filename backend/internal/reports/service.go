package reports

import (
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/commlog"
)

// Service implements every report's query/aggregation logic directly
// against the database (see model.go's package doc comment for why this
// package queries by table name rather than importing every domain
// package's GORM model).
type Service struct {
	db          *gorm.DB
	commlogRepo *commlog.Repository
}

func NewService(db *gorm.DB, commlogRepo *commlog.Repository) *Service {
	return &Service{db: db, commlogRepo: commlogRepo}
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

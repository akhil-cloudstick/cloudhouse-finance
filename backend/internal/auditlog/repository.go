package auditlog

import (
	"context"
	"log"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for Entry.
//
// Every method takes ctx and calls WithContext, same as every other
// repository in this codebase — the tenant is stamped on Create and applied
// to Find by the automatic query filter, exactly like every other
// tenant-scoped table.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, e *Entry) error {
	return r.db.WithContext(ctx).Create(e).Error
}

// Log is the convenience form every call site actually uses — builds and
// inserts an Entry in one call, and NEVER returns an error to the caller: a
// missing audit row is a problem to notice and fix server-side, not a
// reason to fail the write it is trying to record (the actual employee/
// branch change already committed by the time this runs). Mirrors
// internal/superadmin.Service.audit's same reasoning.
func (r *Repository) Log(ctx context.Context, actorEmployeeID uint, actorName, action, entityType string, entityID uint, entityName, detail string) {
	e := &Entry{
		ActorEmployeeID: actorEmployeeID,
		ActorName:       actorName,
		Action:          action,
		EntityType:      entityType,
		EntityID:        entityID,
		EntityName:      entityName,
		Detail:          detail,
	}
	if err := r.Create(ctx, e); err != nil {
		log.Printf("auditlog: failed to record %s on %s #%d: %v", action, entityType, entityID, err)
	}
}

// Filter narrows the list — every field optional.
type Filter struct {
	EntityType string
	Action     string
	Limit      int
	Offset     int
}

func (r *Repository) FindAll(ctx context.Context, f Filter) ([]Entry, error) {
	q := r.db.WithContext(ctx).Order("created_at desc")
	if f.EntityType != "" {
		q = q.Where("entity_type = ?", f.EntityType)
	}
	if f.Action != "" {
		q = q.Where("action = ?", f.Action)
	}
	if f.Limit > 0 {
		q = q.Limit(f.Limit).Offset(f.Offset)
	}
	var out []Entry
	err := q.Find(&out).Error
	return out, err
}

package workflow

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for the workflow tables.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

// FindAll returns every stored stage setting for the caller's tenant.
func (r *Repository) FindAll(ctx context.Context) ([]ApprovalStageSetting, error) {
	var rows []ApprovalStageSetting
	err := r.db.WithContext(ctx).Find(&rows).Error
	return rows, err
}

// FindByFlow returns the stored stage settings of one flow.
func (r *Repository) FindByFlow(ctx context.Context, flow string) ([]ApprovalStageSetting, error) {
	var rows []ApprovalStageSetting
	err := r.db.WithContext(ctx).Where("flow = ?", flow).Find(&rows).Error
	return rows, err
}

// Upsert creates or updates the single row for (flow, stage).
func (r *Repository) Upsert(ctx context.Context, flow, stage string, enabled bool) error {
	var rec ApprovalStageSetting
	err := r.db.WithContext(ctx).Where("flow = ? AND stage = ?", flow, stage).First(&rec).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		rec = ApprovalStageSetting{Flow: flow, Stage: stage, Enabled: enabled}
		return r.db.WithContext(ctx).Create(&rec).Error
	}
	rec.Enabled = enabled
	return r.db.WithContext(ctx).Save(&rec).Error
}

// CreateAction appends one audit row.
func (r *Repository) CreateAction(ctx context.Context, a *ApprovalAction) error {
	return r.db.WithContext(ctx).Create(a).Error
}

// ListActions returns the audit rows of one item, oldest first.
func (r *Repository) ListActions(ctx context.Context, flow string, entityID uint) ([]ApprovalAction, error) {
	var rows []ApprovalAction
	err := r.db.WithContext(ctx).Where("flow = ? AND entity_id = ?", flow, entityID).Order("created_at ASC, id ASC").Find(&rows).Error
	return rows, err
}

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

// FindAll returns every stored legacy stage setting for the caller's tenant.
func (r *Repository) FindAll(ctx context.Context) ([]ApprovalStageSetting, error) {
	var rows []ApprovalStageSetting
	err := r.db.WithContext(ctx).Find(&rows).Error
	return rows, err
}

// FindAllChains returns every stored chain for the caller's tenant.
func (r *Repository) FindAllChains(ctx context.Context) ([]ApprovalChain, error) {
	var rows []ApprovalChain
	err := r.db.WithContext(ctx).Find(&rows).Error
	return rows, err
}

// FindAllModes returns every stored category mode for the caller's tenant.
func (r *Repository) FindAllModes(ctx context.Context) ([]ApprovalCategoryMode, error) {
	var rows []ApprovalCategoryMode
	err := r.db.WithContext(ctx).Find(&rows).Error
	return rows, err
}

// ListRoles returns every role of the caller's tenant.
func (r *Repository) ListRoles(ctx context.Context) ([]roleRow, error) {
	var rows []roleRow
	err := r.db.WithContext(ctx).Order("name asc").Find(&rows).Error
	return rows, err
}

// FindRole returns one role of the caller's tenant.
func (r *Repository) FindRole(ctx context.Context, id uint) (*roleRow, error) {
	var row roleRow
	if err := r.db.WithContext(ctx).First(&row, id).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// SaveCategory stores a category's mode and the given chains (scope →
// role-ID list) in one transaction. Chains not in the map are untouched.
func (r *Repository) SaveCategory(ctx context.Context, category string, shared bool, chains map[string]string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var mode ApprovalCategoryMode
		err := tx.Where("category = ?", category).First(&mode).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			mode = ApprovalCategoryMode{Category: category, Shared: shared}
			if err := tx.Create(&mode).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			mode.Shared = shared
			if err := tx.Save(&mode).Error; err != nil {
				return err
			}
		}
		for scope, ids := range chains {
			var rec ApprovalChain
			err := tx.Where("scope = ?", scope).First(&rec).Error
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				rec = ApprovalChain{Scope: scope, RoleIDs: ids}
				if err := tx.Create(&rec).Error; err != nil {
					return err
				}
			case err != nil:
				return err
			default:
				rec.RoleIDs = ids
				if err := tx.Save(&rec).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
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

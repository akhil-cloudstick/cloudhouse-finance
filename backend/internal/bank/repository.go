package bank

import (
	"context"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Bank records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, b *Bank) error {
	return r.db.WithContext(ctx).Create(b).Error
}

// FindAll returns banks matching query, plus the TOTAL row count for that
// query (Limit/Offset ignored, 0 when limit <= 0). limit == 0 returns every
// match unpaged (the web bank directory's behaviour); limit > 0 applies
// FindAll returns banks matching query, plus the TOTAL row count for that
// query (Limit/Offset ignored, 0 when limit <= 0). limit == 0 returns every
// match unpaged (the web bank directory's behaviour); limit > 0 applies
// Limit/Offset (the mobile app's paginated list) — same convention as
// customer/loan/scheme's FindAll.
func (r *Repository) FindAll(ctx context.Context, query string, limit, offset int) ([]Bank, int64, error) {
	var banks []Bank
	q := r.db.WithContext(ctx).Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Bank{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&banks).Error
	return banks, total, err
}

// FindByName looks up a bank by a case-insensitive exact match on Name.
// Returns gorm.ErrRecordNotFound (via err) when no row matches.
func (r *Repository) FindByName(ctx context.Context, name string) (*Bank, error) {
	var b Bank
	if err := r.db.WithContext(ctx).Where("name ILIKE ?", name).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// FindByID looks up a single bank by primary key.
func (r *Repository) FindByID(ctx context.Context, id uint) (*Bank, error) {
	var b Bank
	if err := r.db.WithContext(ctx).First(&b, id).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func (r *Repository) Update(ctx context.Context, b *Bank) error {
	return r.db.WithContext(ctx).Save(b).Error
}

// CountReferences mirrors branch.Repository.CountReferences's raw-table-name
// approach (avoiding an import cycle — cash already imports bank for
// CashMovement.BankRef, so bank cannot import cash back) — counts every
// CashMovement/BankPledgeRecord still pointing at bankID, so Delete can
// refuse to remove a bank still referenced by history.
func (r *Repository) CountReferences(ctx context.Context, bankID uint) (int64, error) {
	var count int64
	for _, table := range []string{"cash_movements", "bank_pledge_records"} {
		var c int64
		if err := r.db.WithContext(ctx).Table(table).Where("bank_id = ?", bankID).Count(&c).Error; err != nil {
			return 0, err
		}
		count += c
	}
	return count, nil
}

// Delete hard-deletes a bank row — callers (Service.Delete, Service.Merge)
// are responsible for confirming via CountReferences first that nothing
// still points at it, since Bank has no soft-delete column.
func (r *Repository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&Bank{}, id).Error
}

// ReassignBankID moves every CashMovement/BankPledgeRecord reference from
// one bank to another — the data half of the "merge duplicate bank" action
// (Service.Merge); the near-duplicates it exists to clean up are expected
// from the historical free-text-bank backfill (see migrate.
// backfillCashMovementBankID), not solved by fuzzy name matching.
func (r *Repository) ReassignBankID(ctx context.Context, fromID, toID uint) error {
	for _, table := range []string{"cash_movements", "bank_pledge_records"} {
		if err := r.db.WithContext(ctx).Table(table).Where("bank_id = ?", fromID).Update("bank_id", toID).Error; err != nil {
			return err
		}
	}
	return nil
}

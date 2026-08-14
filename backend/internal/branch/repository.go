package branch

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for Branch records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(b *Branch) error {
	return r.db.Create(b).Error
}

// FindAll lists branches with a non-empty name, optionally scoped to a
// single branchID (nil = no scope, i.e. Administrator sees all).
func (r *Repository) FindAll(branchID *uint) ([]Branch, error) {
	var branches []Branch
	q := r.db.Where("name <> ''").Order("name asc")
	if branchID != nil {
		q = q.Where("id = ?", *branchID)
	}
	err := q.Find(&branches).Error
	return branches, err
}

func (r *Repository) FindByID(id uint) (*Branch, error) {
	var b Branch
	if err := r.db.First(&b, id).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func (r *Repository) FindByName(name string) (*Branch, error) {
	var b Branch
	if err := r.db.Where("name = ?", name).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func (r *Repository) Update(b *Branch) error {
	return r.db.Save(b).Error
}

func (r *Repository) Exists(id uint) (bool, error) {
	var count int64
	err := r.db.Model(&Branch{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

// FirstOrCreateByName is used by the one-time backfill (cmd/migrate) to turn
// legacy free-text branch names into real Branch rows idempotently.
func (r *Repository) FirstOrCreateByName(name string) (*Branch, error) {
	var b Branch
	err := r.db.Where("name = ?", name).Attrs(Branch{Address: "Unknown", IsActive: true}).FirstOrCreate(&b).Error
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// CountReferences guards against deactivating a branch that is still
// referenced by other domains. It queries the employees/expenses/
// cash_movements tables directly by name (rather than importing those
// packages) to avoid an import cycle — branch is a low-level domain other
// packages depend on, not the other way around.
func (r *Repository) CountReferences(branchID uint) (int64, error) {
	var count int64
	for _, table := range []string{"employees", "expenses", "cash_movements", "customers"} {
		var c int64
		if err := r.db.Table(table).Where("branch_id = ?", branchID).Count(&c).Error; err != nil {
			return 0, err
		}
		count += c
	}
	return count, nil
}

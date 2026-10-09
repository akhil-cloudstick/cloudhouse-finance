package branch

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Branch records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, b *Branch) error {
	return r.db.WithContext(ctx).Create(b).Error
}

// CreateTx is Create against an explicit transaction handle rather than this
// repository's own db — for the one caller (Service.Create) that must run
// the insert inside the SAME transaction as the tenant's branch-quota check,
// so a passing check and the row it approved can never be split by a
// concurrent request. See tenant.Repository.ReserveBranchSlot.
func (r *Repository) CreateTx(tx *gorm.DB, b *Branch) error {
	return tx.Create(b).Error
}

// UpdateTx is Update's counterpart for the same reason — Service.Update uses
// it only when a branch is being REACTIVATED (IsActive false -> true), the
// other path back over the tenant's quota.
func (r *Repository) UpdateTx(tx *gorm.DB, b *Branch) error {
	return tx.Save(b).Error
}

// FindAll lists branches with a non-empty name, optionally scoped to a
// single branchID (nil = no scope, i.e. Administrator sees all).
func (r *Repository) FindAll(ctx context.Context, branchID *uint) ([]Branch, error) {
	branches, _, err := r.Find(ctx, Filter{BranchID: branchID})
	return branches, err
}

// Filter narrows Find. Limit <= 0 means "no limit".
type Filter struct {
	// BranchID is the caller's branch-scope restriction (nil = every
	// branch, Administrator only).
	BranchID *uint
	// Query matches name or code (case-insensitive, partial).
	Query string
	// ActiveOnly drops deactivated branches (GET /branches?active=true) —
	// pickers that may only assign to a live branch.
	ActiveOnly bool
	Limit      int
	Offset     int
}

// Find is FindAll's filtered/paginated superset. Returns the TOTAL row
// count for f's filters (Limit/Offset ignored, 0 when f.Limit <= 0).
func (r *Repository) Find(ctx context.Context, f Filter) ([]Branch, int64, error) {
	var branches []Branch
	q := r.db.WithContext(ctx).Model(&Branch{}).Where("name <> ''").Order("name asc")
	if f.BranchID != nil {
		q = q.Where("id = ?", *f.BranchID)
	}
	if f.ActiveOnly {
		q = q.Where("is_active = ?", true)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Where("name ILIKE ? OR code ILIKE ?", like, like)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	err := q.Find(&branches).Error
	return branches, total, err
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Branch, error) {
	var b Branch
	if err := r.db.WithContext(ctx).First(&b, id).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func (r *Repository) FindByName(ctx context.Context, name string) (*Branch, error) {
	var b Branch
	if err := r.db.WithContext(ctx).Where("name = ?", name).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// FindByCode looks a non-blank code up the way uq_branches_tenant_code
// sees it — soft-deleted rows included, since the index has no deleted_at
// predicate and would still reject their code.
func (r *Repository) FindByCode(ctx context.Context, code string) (*Branch, error) {
	var b Branch
	if err := r.db.WithContext(ctx).Unscoped().Where("code = ?", code).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func (r *Repository) Update(ctx context.Context, b *Branch) error {
	return r.db.WithContext(ctx).Save(b).Error
}

func (r *Repository) Exists(ctx context.Context, id uint) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&Branch{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

// FirstOrCreateByName finds a branch with this exact name, or creates one.
// Used by the one-time backfill (cmd/migrate) to turn legacy free-text branch
// names into real Branch rows idempotently, and by employee.SeedAdmin and
// superadmin.Service.CreateBusiness to seed a first "Head Office" branch.
//
// Name is repeated inside Attrs() even though the Where() clause already
// names it — that repetition is load-bearing, not redundant. GORM's
// FirstOrCreate populates a new record's fields from the WHERE condition
// only when that condition is a struct or map; a raw SQL string condition
// (`"name = ?", name`, used here so callers pass a plain string) gives GORM
// nothing it can read a column value back out of. Attrs() alone (as this
// used to be written) then leaves Name unset on the freshly created row —
// every fresh install's first branch was created with an EMPTY name and
// silently vanished from every list, because branch.FindAll filters
// `WHERE name <> ”`. Found the hard way via the superadmin console
// (multi-tenancy plan, Step 7): a business created through the superadmin API
// got a "Head Office" branch its own new Administrator could not see at
// all. Name is included here explicitly so the bug cannot recur regardless
// of which condition style is used.
func (r *Repository) FirstOrCreateByName(ctx context.Context, name string) (*Branch, error) {
	var b Branch
	err := r.db.WithContext(ctx).Where("name = ?", name).
		// Code "HO": branch code is required, and a seeded branch must not be
		// the one code-less row (Head Office is the only name seeded here).
		Attrs(Branch{Name: name, Code: "HO", Address: "Unknown", IsActive: true}).
		FirstOrCreate(&b).Error
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// FindHeadOffice returns the business's Head Office branch: the active branch
// named "Head Office", or — for a business that renamed it — its oldest active
// branch. Bank-pledge cash is booked against it rather than the pledged loan's
// own branch, because a pledge is the company borrowing from a bank, not a
// branch-level transaction.
func (r *Repository) FindHeadOffice(ctx context.Context) (*Branch, error) {
	var b Branch
	err := r.db.WithContext(ctx).Where("name = ? AND is_active = ?", "Head Office", true).Order("id").First(&b).Error
	if err == nil {
		return &b, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Where("is_active = ? AND name <> ''", true).Order("id").First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// CountReferences guards against deactivating a branch that is still
// referenced by other domains. It queries the employees/expenses/
// cash_movements tables directly by name (rather than importing those
// packages) to avoid an import cycle — branch is a low-level domain other
// packages depend on, not the other way around.
func (r *Repository) CountReferences(ctx context.Context, branchID uint) (int64, error) {
	var count int64
	for _, table := range []string{"employees", "expenses", "cash_movements", "customers"} {
		var c int64
		if err := r.db.WithContext(ctx).Table(table).Where("branch_id = ?", branchID).Count(&c).Error; err != nil {
			return 0, err
		}
		count += c
	}
	return count, nil
}

// SingleBranchHeadOffice reports whether the business runs in single-branch
// mode and, if so, its Head Office (same rule as FindHeadOffice). Backs
// platform.PinSingleBranch; reads through the request's pinned, tenant-scoped
// connection.
func (r *Repository) SingleBranchHeadOffice(ctx context.Context, tenantID uint) (uint, bool, error) {
	var row struct {
		SingleBranch bool
		HeadOfficeID uint
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT t.single_branch,
		       COALESCE((SELECT b.id FROM branches b
		                  WHERE b.tenant_id = t.id AND b.is_active AND b.deleted_at IS NULL AND b.name <> ''
		                  ORDER BY (b.name = 'Head Office') DESC, b.id LIMIT 1), 0) AS head_office_id
		  FROM tenants t WHERE t.id = ?`, tenantID).Scan(&row).Error
	if err != nil {
		return 0, false, err
	}
	return row.HeadOfficeID, row.SingleBranch, nil
}

package customer

import (
	"context"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Customer records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, c *Customer) error {
	return r.db.WithContext(ctx).Create(c).Error
}

// CustomerFilter narrows FindAll's results beyond the plain text query;
// zero-value fields are ignored. PANStatus/AadhaarStatus back the
// Customers & KYC page's "PAN Verified"/"Aadhaar Verified" filters.
type CustomerFilter struct {
	Query         string
	BranchID      *uint
	PANStatus     string
	AadhaarStatus string
	// CustomerType narrows to Borrower or Investor (see model.go's
	// CustomerType field) — backs the investor-only SearchableSelect picker
	// in the New Investment flow (frontend/modules/investments).
	CustomerType string
	Limit        int
	Offset       int
}

// FindAll returns customers matching query, ordered by id. When limit > 0
// it applies Limit/Offset (used by the paginated SearchableSelect-backed
// search — see Service.List); limit == 0 returns every match, unpaged, for
// callers like the full Customers & KYC list page.
// FindAll returns matching customers plus the TOTAL row count for f's
// filters (Limit/Offset ignored for that count) — 0 when f.Limit <= 0.
func (r *Repository) FindAll(ctx context.Context, f CustomerFilter) ([]Customer, int64, error) {
	var customers []Customer
	q := r.db.WithContext(ctx).Preload("Branch").Order("id asc")
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Where("name ILIKE ? OR code ILIKE ? OR phone ILIKE ?", like, like, like)
	}
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	if f.PANStatus != "" {
		q = q.Where("pan_status = ?", f.PANStatus)
	}
	if f.AadhaarStatus != "" {
		q = q.Where("aadhaar_status = ?", f.AadhaarStatus)
	}
	if f.CustomerType != "" {
		q = q.Where("customer_type = ?", f.CustomerType)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Customer{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit).Offset(f.Offset)
	}
	err := q.Find(&customers).Error
	return customers, total, err
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Customer, error) {
	var c Customer
	if err := r.db.WithContext(ctx).Preload("Branch").First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByPhone looks up a customer by exact phone match — used by
// internal/customerauth to resolve an OTP request/verify to a customer
// record. Returns gorm.ErrRecordNotFound if no customer has that phone.
func (r *Repository) FindByPhone(ctx context.Context, phone string) (*Customer, error) {
	var c Customer
	if err := r.db.WithContext(ctx).Preload("Branch").Where("phone = ?", phone).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) Update(ctx context.Context, c *Customer) error {
	return r.db.WithContext(ctx).Save(c).Error
}

func (r *Repository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&Customer{}, id).Error
}

// DB exposes the underlying *gorm.DB — used only by HardDeleteCustomer
// (harddelete.go) to run its own final cascade (customer_device_tokens,
// customer_otp, notifications, standalone reminders, then the customer row
// itself) inside one transaction, mirroring how loan.Service.HardDeleteLoan
// uses its own db handle rather than adding a dedicated Repository method
// per table touched.
func (r *Repository) DB() platform.DB {
	return r.db
}

// CountAll returns the total number of customers ever created (including
// soft-deleted ones), used to generate sequential Code values.
func (r *Repository) CountAll(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Unscoped().Model(&Customer{}).Count(&count).Error
	return count, err
}

// MaxCodeSuffix returns the highest numeric suffix ever used in a
// "CUST-NN" customer code, including customers that have since been
// hard-deleted — the next code is always one past this max suffix,
// never derived from row count.
func (r *Repository) MaxCodeSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := r.db.WithContext(ctx).Model(&Customer{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'CUST-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

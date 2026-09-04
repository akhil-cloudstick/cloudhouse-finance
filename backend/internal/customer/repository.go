package customer

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for Customer records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(c *Customer) error {
	return r.db.Create(c).Error
}

// CustomerFilter narrows FindAll's results beyond the plain text query;
// zero-value fields are ignored. PANStatus/AadhaarStatus back the
// Customers & KYC page's "PAN Verified"/"Aadhaar Verified" filters.
type CustomerFilter struct {
	Query         string
	BranchID      *uint
	PANStatus     string
	AadhaarStatus string
	Limit         int
	Offset        int
}

// FindAll returns customers matching query, ordered by id. When limit > 0
// it applies Limit/Offset (used by the paginated SearchableSelect-backed
// search — see Service.List); limit == 0 returns every match, unpaged, for
// callers like the full Customers & KYC list page.
// FindAll returns matching customers plus the TOTAL row count for f's
// filters (Limit/Offset ignored for that count) — 0 when f.Limit <= 0.
func (r *Repository) FindAll(f CustomerFilter) ([]Customer, int64, error) {
	var customers []Customer
	q := r.db.Preload("Branch").Order("id asc")
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

func (r *Repository) FindByID(id uint) (*Customer, error) {
	var c Customer
	if err := r.db.Preload("Branch").First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByPhone looks up a customer by exact phone match — used by
// internal/customerauth to resolve an OTP request/verify to a customer
// record. Returns gorm.ErrRecordNotFound if no customer has that phone.
func (r *Repository) FindByPhone(phone string) (*Customer, error) {
	var c Customer
	if err := r.db.Preload("Branch").Where("phone = ?", phone).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) Update(c *Customer) error {
	return r.db.Save(c).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&Customer{}, id).Error
}

// CountAll returns the total number of customers ever created (including
// soft-deleted ones), used to generate sequential Code values.
func (r *Repository) CountAll() (int64, error) {
	var count int64
	err := r.db.Unscoped().Model(&Customer{}).Count(&count).Error
	return count, err
}

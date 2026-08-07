package cash

import "gorm.io/gorm"

// MovementRepository provides GORM-backed persistence for CashMovement records.
type MovementRepository struct {
	db *gorm.DB
}

func NewMovementRepository(db *gorm.DB) *MovementRepository {
	return &MovementRepository{db: db}
}

func (r *MovementRepository) Create(m *CashMovement) error {
	return r.db.Create(m).Error
}

func (r *MovementRepository) FindAll() ([]CashMovement, error) {
	var movements []CashMovement
	err := r.db.Order("occurred_on desc, id desc").Find(&movements).Error
	return movements, err
}

func (r *MovementRepository) FindByID(id uint) (*CashMovement, error) {
	var m CashMovement
	if err := r.db.First(&m, id).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *MovementRepository) Update(m *CashMovement) error {
	return r.db.Save(m).Error
}

// ExpenseRepository provides GORM-backed persistence for Expense records.
type ExpenseRepository struct {
	db *gorm.DB
}

func NewExpenseRepository(db *gorm.DB) *ExpenseRepository {
	return &ExpenseRepository{db: db}
}

func (r *ExpenseRepository) Create(e *Expense) error {
	return r.db.Create(e).Error
}

func (r *ExpenseRepository) FindAll() ([]Expense, error) {
	var expenses []Expense
	err := r.db.Order("occurred_on desc, id desc").Find(&expenses).Error
	return expenses, err
}

func (r *ExpenseRepository) FindByID(id uint) (*Expense, error) {
	var e Expense
	if err := r.db.First(&e, id).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

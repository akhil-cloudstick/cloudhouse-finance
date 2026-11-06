package models

import (
	"cloudhouse/backend/config"
	"time"
)

// DayBookEntry is one line of the Day Book, written by hand: nothing else creates or changes it.
type DayBookEntry struct {
	config.TenantScoped
	ID                  uint      `gorm:"primaryKey"`
	BranchID            *uint     `gorm:"index"`
	EntryDate           time.Time `gorm:"type:date;not null;index"`
	Particulars         string    `gorm:"not null;size:255"`
	Debit               float64   `gorm:"not null;type:numeric(16,2)"`
	Credit              float64   `gorm:"not null;type:numeric(16,2)"`
	Interest            float64   `gorm:"not null;type:numeric(16,2)"`
	CreatedByEmployeeID *uint
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// DayBookRow is an entry as the report shows it. Single-word keys, so the web client's field map
// needs no entries for them.
type DayBookRow struct {
	ID          uint    `json:"id"`
	Date        string  `json:"date"`
	Particulars string  `json:"particulars"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Interest    float64 `json:"interest"`
}

type DayBookTotals struct {
	Debit    float64 `json:"debit"`
	Credit   float64 `json:"credit"`
	Interest float64 `json:"interest"`
}

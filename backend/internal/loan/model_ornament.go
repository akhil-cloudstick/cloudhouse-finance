package loan

import "time"

// Ornament represents one pledged gold item declared at intake time
// (name/type, purity, weights, deductions, computed value). Purity-test
// results captured later by staff live separately in OrnamentPurityTest —
// this row is never overwritten by a later test.
type Ornament struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Name   string `json:"name" gorm:"not null;size:80"`   // e.g. "Chain", "Bangle", "Ring", "Necklace", "Earrings"
	Purity string `json:"purity" gorm:"not null;size:10"` // unit-suffixed, e.g. "22K" or "91.6%" — see loan/purity.go's ParsePurity

	GrossWeight     float64 `json:"grossWeight" gorm:"not null"`
	DeductionWeight float64 `json:"deductionWeight"`
	NetWeight       float64 `json:"netWeight"` // computed = GrossWeight - DeductionWeight
	Quantity        int     `json:"quantity" gorm:"not null;default:1"`

	GoldValue float64 `json:"goldValue" gorm:"type:numeric(16,2);default:0"` // computed = NetWeight × purity-matched gold rate
	Remarks   string  `json:"remarks" gorm:"size:255"`

	PurityTest *OrnamentPurityTest `json:"purityTest,omitempty" gorm:"foreignKey:OrnamentID"`
	Images     []OrnamentImage     `json:"images,omitempty" gorm:"foreignKey:OrnamentID"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Ornament) TableName() string { return "ornaments" }

// OrnamentPurityTest records the staff-verified re-test of an ornament,
// entered manually sometime after pledge. One-to-one with Ornament.
type OrnamentPurityTest struct {
	ID         uint `json:"id" gorm:"primaryKey"`
	OrnamentID uint `json:"ornamentId" gorm:"uniqueIndex;not null"`

	TestedPurity          string    `json:"testedPurity" gorm:"not null;size:10"` // unit-suffixed, e.g. "22K" or "91.6%" — see loan/purity.go's ParsePurity
	TestedGrossWeight     float64   `json:"testedGrossWeight" gorm:"not null"`
	TestedDeductionWeight float64   `json:"testedDeductionWeight"`
	TestedNetWeight       float64   `json:"testedNetWeight"`
	TestingRemarks        string    `json:"testingRemarks" gorm:"size:255"`
	TestedBy              string    `json:"testedBy" gorm:"not null;size:120"`
	TestedAt              time.Time `json:"testedAt" gorm:"not null"`

	CreatedAt time.Time `json:"createdAt"`
}

func (OrnamentPurityTest) TableName() string { return "ornament_purity_tests" }

// OrnamentImage is one photo of a pledged ornament. An ornament can have
// any number of these. ImageURL points at the shared upload endpoint
// (internal/upload) — files are stored on disk, not base64-in-DB.
type OrnamentImage struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	OrnamentID uint      `json:"ornamentId" gorm:"not null;index"`
	ImageURL   string    `json:"imageUrl" gorm:"not null;size:255"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (OrnamentImage) TableName() string { return "ornament_images" }

package loan

import (
	"time"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
)

// LoanDraft is an unsubmitted New Gold Loan form, saved by the "Save Draft"
// button on frontend/components/NewLoan.tsx so a half-entered loan survives
// leaving the page (a customer who has to come back with a document, a
// shift change, an accidental navigation). It is deliberately NOT a Loan:
// no loan number is assigned, nothing enters the sanction chain, no packet
// is created, and no gold rate is applied — a draft is scratch paper.
//
// That's why almost every field is nullable and none is validated: the
// point is to store the form EXACTLY as far as staff got, including
// contradictory or absent values, and to apply the real rules (verified
// customer, gold rate published today, principal within LTV, at least one
// ornament) only when the draft is finally submitted through the normal
// POST /loans path. Deleting a draft is not an audit event, and drafts
// carry no money — so unlike every other record here, they are hard
// deleted (see Service.DeleteDraft and Service.Create's cleanup).
//
// A draft belongs to the employee who saved it, not to the branch at
// large: an in-progress form is one person's unfinished work, so listing
// is scoped to CreatedByEmployeeID as well as the caller's branch scope.
type LoanDraft struct {
	platform.TenantScoped
	ID uint `json:"id" gorm:"primaryKey"`

	// CreatedByEmployeeID is the owner — set from the JWT, never the body.
	CreatedByEmployeeID uint `json:"createdByEmployeeId" gorm:"not null;index"`

	// BranchID is required (the form defaults it, and every staff member has
	// a branch), so branch-scoped listing behaves like it does for loans.
	BranchID uint          `json:"branchId" gorm:"not null;index"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`

	// Customer/Scheme/Locker are all still-unpicked-at-this-point choices,
	// hence pointers. Preloaded on read so the frontend can repopulate its
	// SearchableSelect labels without extra round trips.
	CustomerID *uint              `json:"customerId,omitempty"`
	Customer   *customer.Customer `json:"customer,omitempty" gorm:"foreignKey:CustomerID"`
	SchemeID   *uint              `json:"schemeId,omitempty"`
	Scheme     *scheme.Scheme     `json:"scheme,omitempty" gorm:"foreignKey:SchemeID"`
	LockerID   *uint              `json:"lockerId,omitempty"`

	// PrincipalOverride mirrors the form's optional manual loan amount —
	// nil means "use the scheme-LTV-computed eligible amount", which is
	// recomputed live from the ornaments and the current gold rate rather
	// than frozen here (a draft opened next week must not quote last week's
	// rate as if it were today's).
	PrincipalOverride *float64 `json:"principalOverride,omitempty" gorm:"type:numeric(16,2)"`

	Ornaments []LoanDraftOrnament `json:"ornaments" gorm:"foreignKey:DraftID"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (LoanDraft) TableName() string { return "loan_drafts" }

// LoanDraftOrnament is one row of the draft's ornament table. Separate from
// Ornament because it shares none of its guarantees: name/purity may be
// blank, weight and quantity may be zero, and no NetWeight/GoldValue is
// computed (those depend on a gold rate, applied at submission). ImageURL
// carries an already-uploaded photo (POST /uploads happens as soon as staff
// pick the file, before any loan exists), so a saved draft keeps its
// attachments.
type LoanDraftOrnament struct {
	platform.TenantScoped
	ID      uint `json:"id" gorm:"primaryKey"`
	DraftID uint `json:"draftId" gorm:"not null;index"`

	Name        string  `json:"name" gorm:"size:80"`
	Purity      string  `json:"purity" gorm:"size:10"`
	GrossWeight float64 `json:"grossWeight"`
	Quantity    int     `json:"quantity"`
	ImageURL    string  `json:"imageUrl" gorm:"size:512"`
	ImageName   string  `json:"imageName" gorm:"size:255"`

	// Position preserves the on-screen row order, which is meaningful to
	// staff reading a part-filled form back (id-ascending would reshuffle
	// rows edited across separate saves).
	Position int `json:"position" gorm:"not null;default:0"`
}

func (LoanDraftOrnament) TableName() string { return "loan_draft_ornaments" }

// Package customer implements the Customer Module — Stage 1
// (frontend/components/Customers.tsx, CustomerDetail.tsx,
// modals/RegisterCustomerModal.tsx): a consolidated, backend-persisted
// customer profile. KYC/PAN/Aadhaar verification is NOT live yet — every
// customer starts KYCStatus/PANStatus/AadhaarStatus "Pending" at creation
// (see service.Create) until a real Setu PAN-verify (internal/platform/
// setu.go) or DigiLocker Aadhaar call runs and updates it.
package customer

import (
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform"
)

// Customer is the GORM/DB-only model. It is never returned directly by any
// handler — AadhaarEncrypted must never reach the API response, so every
// handler method returns ToResponse() instead (see CustomerResponse below).
// This is stricter than Employee/Expense's existing "return the raw model"
// convention, deliberately: Customer is the first model here carrying an
// encrypted-at-rest field, and a future field addition should never be able
// to leak through the API by accident just because it forgot a json tag.
type Customer struct {
	platform.TenantScoped
	ID       uint          `json:"id" gorm:"primaryKey"`
	Code     string        `json:"code" gorm:"index;size:20"`
	Name     string        `json:"name" gorm:"not null;size:120"`
	Phone    string        `json:"phone" gorm:"size:20"`
	DOB      time.Time     `json:"dob"`
	Address  string        `json:"address" gorm:"size:255"`
	BranchID uint          `json:"branchId" gorm:"not null"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`

	PhotoURL         string `json:"photoUrl" gorm:"size:255"`
	IdentityProofURL string `json:"identityProofUrl" gorm:"size:255"`
	AddressProofURL  string `json:"addressProofUrl" gorm:"size:255"`
	KYCDocumentURL   string `json:"kycDocumentUrl" gorm:"size:255"`

	// PAN is kept in plaintext — it's what gets sent verbatim to Setu's
	// /api/verify/pan in a future stage; hashing/encrypting it would make
	// that call impossible without asking the customer again.
	PAN string `json:"pan" gorm:"size:10"`

	// Aadhaar is never stored in plaintext. AadhaarLast4 is kept in the
	// clear for display (mirrors the old UI's "last 4 digits" input);
	// AadhaarEncrypted is an AES-256-GCM ciphertext (platform.Cipher) that
	// CAN be decrypted server-side later for a real verification call —
	// unlike a password hash, this is deliberately reversible.
	AadhaarLast4     string `json:"-" gorm:"size:4"`
	AadhaarEncrypted string `json:"-" gorm:"type:text"`

	NomineeName     string `json:"nomineeName" gorm:"size:120"`
	NomineeRelation string `json:"nomineeRelation" gorm:"size:60"`
	NomineePhone    string `json:"nomineePhone" gorm:"size:20"`

	// The fields below are personal-loan specific / optional — collected
	// only by the inline "+ Add new customer" flow in the Personal Loan
	// creation picker (frontend/modules/personal-loans/components/
	// CreateCustomerModal.tsx). Gold-loan customer creation (Customers.tsx /
	// RegisterCustomerModal.tsx) never sends them, so they must stay
	// nullable/blank-default and never required by validate() in service.go.
	FatherName string `json:"fatherName,omitempty" gorm:"size:120"`
	District   string `json:"district,omitempty" gorm:"size:80"`
	Taluk      string `json:"taluk,omitempty" gorm:"size:80"`
	Village    string `json:"village,omitempty" gorm:"size:80"`
	Place      string `json:"place,omitempty" gorm:"size:80"`
	PinCode    string `json:"pinCode,omitempty" gorm:"size:10"`
	// Nullable (rather than plain int) so an omitted Age renders as SQL NULL,
	// not a misleading stored 0 — and so reflection-based table builders
	// (internal/reports/export.go) that walk this struct print blank instead
	// of "0" for every pre-existing gold-loan customer.
	Age *int `json:"age,omitempty" gorm:"type:int"`

	// CustomerType distinguishes an ordinary borrowing customer from an
	// investor (internal/investment) — a customer who deposits money into
	// the system rather than borrowing from it. Defaults to Borrower so
	// every pre-existing row (and every gold-loan/personal-loan customer
	// created going forward) keeps its current behavior untouched.
	CustomerType string `json:"customerType" gorm:"size:20;not null;default:'Borrower'"`

	// The fields below are investor-only / optional — collected only when
	// CustomerType is Investor, needed to pay interest/principal back to
	// them (internal/investment.Service's CashRecorder). Gold-loan/
	// personal-loan customer creation never sends them, so they must stay
	// nullable/blank-default and never required by validate() in
	// service.go unless CustomerType == CustomerTypeInvestor.
	BankAccountName   string `json:"bankAccountName,omitempty" gorm:"size:120"`
	BankAccountNumber string `json:"bankAccountNumber,omitempty" gorm:"size:30"`
	BankIFSC          string `json:"bankIfsc,omitempty" gorm:"size:15"`

	// KYCStatus/PANStatus/AadhaarStatus start "Pending" at creation in
	// service.Create — no real verification call happens until a live Setu
	// PAN-verify (internal/platform/setu.go) / DigiLocker Aadhaar call runs
	// and updates it.
	KYCStatus     string `json:"kycStatus" gorm:"size:20"`
	PANStatus     string `json:"panStatus" gorm:"size:20"`
	AadhaarStatus string `json:"aadhaarStatus" gorm:"size:20"`

	// DigilockerRequestID is Setu's request id for the customer's most
	// recent DigiLocker Aadhaar-verify attempt (see
	// internal/platform/setu_digilocker.go). Set by StartAadhaarVerify,
	// read back by CheckAadhaarVerify to poll status/fetch the result —
	// never exposed in the API response, it's purely an internal
	// correlation id.
	DigilockerRequestID string `json:"-" gorm:"size:64"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Customer) TableName() string {
	return "customers"
}

// CustomerType values for Customer.CustomerType / CustomerResponse.CustomerType.
const (
	CustomerTypeBorrower = "Borrower"
	CustomerTypeInvestor = "Investor"
)

// CustomerResponse is the only shape ever sent back over the API. It is a
// structurally separate type from Customer (not just json tags on the same
// struct) so AadhaarEncrypted has no path onto it at all, by construction.
type CustomerResponse struct {
	ID      uint      `json:"id"`
	Code    string    `json:"code"`
	Name    string    `json:"name"`
	Phone   string    `json:"phone"`
	DOB     time.Time `json:"dob"`
	Address string    `json:"address"`

	BranchID uint          `json:"branchId"`
	Branch   branch.Branch `json:"branch"`

	PhotoURL         string `json:"photoUrl"`
	IdentityProofURL string `json:"identityProofUrl"`
	AddressProofURL  string `json:"addressProofUrl"`
	KYCDocumentURL   string `json:"kycDocumentUrl"`

	PAN          string `json:"pan"`
	AadhaarLast4 string `json:"aadhaarLast4"`

	NomineeName     string `json:"nomineeName"`
	NomineeRelation string `json:"nomineeRelation"`
	NomineePhone    string `json:"nomineePhone"`

	KYCStatus     string `json:"kycStatus"`
	PANStatus     string `json:"panStatus"`
	AadhaarStatus string `json:"aadhaarStatus"`

	// Personal-loan specific / optional — see Customer's own field comments.
	// omitempty so a gold-loan customer with none of these set doesn't carry
	// a wall of blank fields in the API response.
	FatherName string `json:"fatherName,omitempty"`
	District   string `json:"district,omitempty"`
	Taluk      string `json:"taluk,omitempty"`
	Village    string `json:"village,omitempty"`
	Place      string `json:"place,omitempty"`
	PinCode    string `json:"pinCode,omitempty"`
	Age        *int   `json:"age,omitempty"`

	CustomerType string `json:"customerType"`

	// Investor-only / optional — see Customer's own field comments.
	BankAccountName   string `json:"bankAccountName,omitempty"`
	BankAccountNumber string `json:"bankAccountNumber,omitempty"`
	BankIFSC          string `json:"bankIfsc,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ToResponse builds the API-safe view, field-by-field — AadhaarEncrypted is
// simply never referenced here.
func (c *Customer) ToResponse() CustomerResponse {
	return CustomerResponse{
		ID:      c.ID,
		Code:    c.Code,
		Name:    c.Name,
		Phone:   c.Phone,
		DOB:     c.DOB,
		Address: c.Address,

		BranchID: c.BranchID,
		Branch:   c.Branch,

		PhotoURL:         c.PhotoURL,
		IdentityProofURL: c.IdentityProofURL,
		AddressProofURL:  c.AddressProofURL,
		KYCDocumentURL:   c.KYCDocumentURL,

		PAN:          c.PAN,
		AadhaarLast4: c.AadhaarLast4,

		NomineeName:     c.NomineeName,
		NomineeRelation: c.NomineeRelation,
		NomineePhone:    c.NomineePhone,

		KYCStatus:     c.KYCStatus,
		PANStatus:     c.PANStatus,
		AadhaarStatus: c.AadhaarStatus,

		FatherName: c.FatherName,
		District:   c.District,
		Taluk:      c.Taluk,
		Village:    c.Village,
		Place:      c.Place,
		PinCode:    c.PinCode,
		Age:        c.Age,

		CustomerType: c.CustomerType,

		BankAccountName:   c.BankAccountName,
		BankAccountNumber: c.BankAccountNumber,
		BankIFSC:          c.BankIFSC,

		CreatedAt: c.CreatedAt,
		UpdatedAt: c.UpdatedAt,
	}
}

func ToResponseList(customers []Customer) []CustomerResponse {
	out := make([]CustomerResponse, len(customers))
	for i := range customers {
		out[i] = customers[i].ToResponse()
	}
	return out
}

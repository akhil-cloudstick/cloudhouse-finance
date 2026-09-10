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

	"ambikagold/backend/internal/branch"
)

// Customer is the GORM/DB-only model. It is never returned directly by any
// handler — AadhaarEncrypted must never reach the API response, so every
// handler method returns ToResponse() instead (see CustomerResponse below).
// This is stricter than Employee/Expense's existing "return the raw model"
// convention, deliberately: Customer is the first model here carrying an
// encrypted-at-rest field, and a future field addition should never be able
// to leak through the API by accident just because it forgot a json tag.
type Customer struct {
	ID       uint          `json:"id" gorm:"primaryKey"`
	Code     string        `json:"code" gorm:"uniqueIndex;size:20"`
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

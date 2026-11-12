package models

import (
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

// Investor is someone who puts money into the business (investments.customer_id points here).
// It is its own table, separate from customers, so the same person can be both a borrower and an
// investor with the same phone, PAN and Aadhaar.
type Investor struct {
	config.TenantScoped
	ID                uint           `json:"id" gorm:"primaryKey"`
	Code              string         `json:"code" gorm:"index;size:20"`
	Name              string         `json:"name" gorm:"not null;size:120"`
	Phone             string         `json:"phone" gorm:"size:20"`
	DOB               time.Time      `json:"dob"`
	Address           string         `json:"address" gorm:"size:255"`
	BranchID          uint           `json:"branch_id" gorm:"not null"`
	Branch            Branch         `json:"branch" gorm:"foreignKey:BranchID"`
	PhotoURL          string         `json:"photo_url" gorm:"size:255"`
	IdentityProofURL  string         `json:"identity_proof_url" gorm:"size:255"`
	AddressProofURL   string         `json:"address_proof_url" gorm:"size:255"`
	KYCDocumentURL    string         `json:"kyc_document_url" gorm:"size:255"`
	PAN               string         `json:"pan" gorm:"size:10"`
	AadhaarLast4      string         `json:"-" gorm:"size:4"`
	AadhaarEncrypted  string         `json:"-" gorm:"type:text"`
	AadhaarHash       string         `json:"-" gorm:"size:64"`
	NomineeName       string         `json:"nominee_name" gorm:"size:120"`
	NomineeRelation   string         `json:"nominee_relation" gorm:"size:60"`
	NomineePhone      string         `json:"nominee_phone" gorm:"size:20"`
	FatherName        string         `json:"father_name,omitempty" gorm:"size:120"`
	District          string         `json:"district,omitempty" gorm:"size:80"`
	Taluk             string         `json:"taluk,omitempty" gorm:"size:80"`
	Village           string         `json:"village,omitempty" gorm:"size:80"`
	Place             string         `json:"place,omitempty" gorm:"size:80"`
	PinCode           string         `json:"pin_code,omitempty" gorm:"size:10"`
	Age               *int           `json:"age,omitempty" gorm:"type:int"`
	BankAccountName   string         `json:"bank_account_name,omitempty" gorm:"size:120"`
	BankAccountNumber string         `json:"bank_account_number,omitempty" gorm:"size:30"`
	BankIFSC          string         `json:"bank_ifsc,omitempty" gorm:"size:15"`
	KYCStatus         string         `json:"kyc_status" gorm:"size:20"`
	PANStatus         string         `json:"pan_status" gorm:"size:20"`
	AadhaarStatus     string         `json:"aadhaar_status" gorm:"size:20"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Investor) TableName() string { return "investors" }

package customer

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
)

var (
	ErrNotFound      = httpx.NewNotFound("customer not found")
	ErrNameRequired  = httpx.NewBadRequest("name is required")
	ErrPhoneRequired = httpx.NewBadRequest("phone is required")
	ErrBranchReq     = httpx.NewBadRequest("branch is required")
	ErrBranchInvalid = httpx.NewBadRequest("branch does not exist")

	ErrInvalidCustomerType = httpx.NewBadRequest("customer type must be Borrower or Investor")
	ErrBankDetailsRequired = httpx.NewBadRequest("bank account name, number and IFSC are required for an investor")
	ErrInvestorKYCRequired = httpx.NewBadRequest("PAN and Aadhaar are required for an investor")
)

// CreateInput / UpdateInput mirror the fields collected by
// RegisterCustomerModal.tsx. Aadhaar is accepted as plaintext here only —
// it is encrypted immediately in Create/Update and never persisted as-is.
type CreateInput struct {
	Name    string
	Phone   string
	DOB     time.Time
	Address string

	BranchID uint

	PhotoURL         string
	IdentityProofURL string
	AddressProofURL  string
	KYCDocumentURL   string

	PAN     string
	Aadhaar string // plaintext, in-memory only — encrypted before storage

	NomineeName     string
	NomineeRelation string
	NomineePhone    string

	// Personal-loan specific / optional — see Customer's own field comments
	// in model.go. Never required by validate(); gold-loan customer creation
	// (Customers.tsx / RegisterCustomerModal.tsx) never sends these.
	FatherName string
	District   string
	Taluk      string
	Village    string
	Place      string
	PinCode    string
	Age        *int

	// CustomerType selects Borrower (default, when left blank) vs Investor.
	// BankAccountName/BankAccountNumber/BankIFSC are investor-only /
	// optional — see Customer's own field comments in model.go — required
	// only when CustomerType is Investor (see validate).
	CustomerType      string
	BankAccountName   string
	BankAccountNumber string
	BankIFSC          string
}

type UpdateInput = CreateInput

// ErrPANRequired/ErrSetuNotConfigured are returned by VerifyPAN.
var (
	ErrPANRequired       = httpx.NewBadRequest("customer has no PAN number on file")
	ErrSetuNotConfigured = httpx.NewUnavailable("PAN verification is not configured")
)

// ErrDigilockerNotConfigured/ErrNoDigilockerRequest are returned by the
// DigiLocker Aadhaar-verify flow (StartAadhaarVerify/CheckAadhaarVerify).
var (
	ErrDigilockerNotConfigured = httpx.NewUnavailable("Aadhaar verification is not configured")
	ErrNoDigilockerRequest     = httpx.NewBadRequest("no Aadhaar verification has been started for this customer")
)

// Service implements customer business rules on top of the Repository.
type Service struct {
	db            *gorm.DB // usage-cap bookkeeping only (platform.CheckAndRecordUsage) — never queried directly here
	repo          *Repository
	branchRepo    *branch.Repository
	aadhaarCipher *platform.Cipher
	setu          *platform.SetuClient
	digilocker    *platform.DigilockerClient
}

func NewService(db *gorm.DB, repo *Repository, branchRepo *branch.Repository, aadhaarCipher *platform.Cipher, setu *platform.SetuClient, digilocker *platform.DigilockerClient) *Service {
	return &Service{db: db, repo: repo, branchRepo: branchRepo, aadhaarCipher: aadhaarCipher, setu: setu, digilocker: digilocker}
}

func validate(in CreateInput) error {
	if in.Name == "" {
		return ErrNameRequired
	}
	if in.Phone == "" {
		return ErrPhoneRequired
	}
	if in.BranchID == 0 {
		return ErrBranchReq
	}
	switch in.CustomerType {
	case "", CustomerTypeBorrower:
		// default / explicit Borrower — no extra requirements.
	case CustomerTypeInvestor:
		if in.BankAccountName == "" || in.BankAccountNumber == "" || in.BankIFSC == "" {
			return ErrBankDetailsRequired
		}
		if in.PAN == "" || in.Aadhaar == "" {
			return ErrInvestorKYCRequired
		}
	default:
		return ErrInvalidCustomerType
	}
	return nil
}

func (s *Service) checkBranch(ctx context.Context, id uint) error {
	ok, err := s.branchRepo.Exists(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return ErrBranchInvalid
	}
	return nil
}

// aadhaarLast4 returns the last 4 characters of the given Aadhaar number
// (or the whole string if shorter — defensive, shouldn't happen with real
// 12-digit Aadhaar numbers).
func aadhaarLast4(aadhaar string) string {
	if len(aadhaar) <= 4 {
		return aadhaar
	}
	return aadhaar[len(aadhaar)-4:]
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*Customer, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	if err := s.checkBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}

	count, err := s.repo.CountAll(ctx)
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("CUST-%02d", count+1)

	customerType := in.CustomerType
	if customerType == "" {
		customerType = CustomerTypeBorrower
	}

	var encryptedAadhaar, last4 string
	if in.Aadhaar != "" {
		encryptedAadhaar, err = s.aadhaarCipher.Encrypt(in.Aadhaar)
		if err != nil {
			return nil, err
		}
		last4 = aadhaarLast4(in.Aadhaar)
	}

	rec := &Customer{
		Code:    code,
		Name:    in.Name,
		Phone:   in.Phone,
		DOB:     in.DOB,
		Address: in.Address,

		BranchID: in.BranchID,

		PhotoURL:         in.PhotoURL,
		IdentityProofURL: in.IdentityProofURL,
		AddressProofURL:  in.AddressProofURL,
		KYCDocumentURL:   in.KYCDocumentURL,

		PAN:              in.PAN,
		AadhaarLast4:     last4,
		AadhaarEncrypted: encryptedAadhaar,

		NomineeName:     in.NomineeName,
		NomineeRelation: in.NomineeRelation,
		NomineePhone:    in.NomineePhone,

		FatherName: in.FatherName,
		District:   in.District,
		Taluk:      in.Taluk,
		Village:    in.Village,
		Place:      in.Place,
		PinCode:    in.PinCode,
		Age:        in.Age,

		CustomerType:      customerType,
		BankAccountName:   in.BankAccountName,
		BankAccountNumber: in.BankAccountNumber,
		BankIFSC:          in.BankIFSC,

		// No verification call is made at registration — status starts
		// Pending until a real PAN check (see internal/platform/setu.go)
		// or Aadhaar/DigiLocker check runs and updates it.
		KYCStatus:     "Pending",
		PANStatus:     "Pending",
		AadhaarStatus: "Pending",
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

func (s *Service) List(ctx context.Context, f CustomerFilter) ([]Customer, int64, error) {
	return s.repo.FindAll(ctx, f)
}

func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*Customer, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return rec, nil
}

// ErrNoAadhaarOnFile is returned by DecryptAadhaar when the customer has no
// Aadhaar number stored (AadhaarEncrypted empty — never collected, or the
// customer predates Aadhaar capture).
var ErrNoAadhaarOnFile = httpx.NewBadRequest("customer has no Aadhaar number on file")

// DecryptAadhaar returns the customer's full plaintext Aadhaar number,
// decrypted on demand from AadhaarEncrypted (platform.Cipher, AES-256-GCM)
// — the only path anywhere that turns the stored ciphertext back into a
// full number. Used solely to prefill the printable pledge agreement
// (web/mobile print, and the Aadhaar-eSign PDF via loan.Service's own
// decrypt using the same key) — every other read of a customer (List/Get/
// ToResponse) exposes only AadhaarLast4, by construction. Callers must
// gate this behind an authenticated, permissioned request; it does not
// audit-log on its own.
func (s *Service) DecryptAadhaar(ctx context.Context, id uint, branchID *uint) (string, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return "", ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return "", ErrNotFound
	}
	if rec.AadhaarEncrypted == "" {
		return "", ErrNoAadhaarOnFile
	}
	return s.aadhaarCipher.Decrypt(rec.AadhaarEncrypted)
}

func (s *Service) Update(ctx context.Context, id uint, in UpdateInput, branchID *uint) (*Customer, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	if err := s.checkBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}

	rec.Name = in.Name
	rec.Phone = in.Phone
	rec.DOB = in.DOB
	rec.Address = in.Address
	rec.BranchID = in.BranchID
	rec.PhotoURL = in.PhotoURL
	rec.IdentityProofURL = in.IdentityProofURL
	rec.AddressProofURL = in.AddressProofURL
	rec.KYCDocumentURL = in.KYCDocumentURL
	rec.PAN = in.PAN
	rec.NomineeName = in.NomineeName
	rec.NomineeRelation = in.NomineeRelation
	rec.NomineePhone = in.NomineePhone
	rec.FatherName = in.FatherName
	rec.District = in.District
	rec.Taluk = in.Taluk
	rec.Village = in.Village
	rec.Place = in.Place
	rec.PinCode = in.PinCode
	if in.Age != nil {
		rec.Age = in.Age
	}
	if in.CustomerType != "" {
		rec.CustomerType = in.CustomerType
	}
	rec.BankAccountName = in.BankAccountName
	rec.BankAccountNumber = in.BankAccountNumber
	rec.BankIFSC = in.BankIFSC

	if in.Aadhaar != "" {
		encrypted, err := s.aadhaarCipher.Encrypt(in.Aadhaar)
		if err != nil {
			return nil, err
		}
		rec.AadhaarEncrypted = encrypted
		rec.AadhaarLast4 = aadhaarLast4(in.Aadhaar)
	}

	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

func (s *Service) Delete(ctx context.Context, id uint, branchID *uint) error {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return ErrNotFound
	}
	return s.repo.Delete(ctx, id)
}

// deriveKYCStatus computes the overall KYC status from the two individual
// API verification results. It never promotes a customer to "Verified" on
// the strength of one check alone: both the Setu PAN check and the
// DigiLocker Aadhaar check must have actually passed. Precedence is
// Failed > Name Mismatch > Pending > Verified, so a bad result on one
// document is never masked by a good result on the other.
func deriveKYCStatus(panStatus, aadhaarStatus string) string {
	statuses := []string{panStatus, aadhaarStatus}
	for _, st := range statuses {
		if st == "Failed" {
			return "Failed"
		}
	}
	for _, st := range statuses {
		if st == "Name Mismatch" {
			return "Name Mismatch"
		}
	}
	for _, st := range statuses {
		if st != "Verified" {
			return "Pending"
		}
	}
	return "Verified"
}

// VerifyPAN calls Setu's PAN verification API (internal/platform/setu.go)
// for this customer's on-file PAN and persists the outcome. KYCStatus is
// never set directly here — it is derived from PANStatus + AadhaarStatus by
// deriveKYCStatus, so a customer only becomes "Verified" once both the PAN
// check and the DigiLocker Aadhaar check have passed. Returns the updated customer plus the raw Setu result (so the
// handler can surface the matched name/message to the UI).
func (s *Service) VerifyPAN(ctx context.Context, id uint, branchID *uint) (*Customer, *platform.PANVerificationResult, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, nil, ErrNotFound
	}
	if rec.PAN == "" {
		return nil, nil, ErrPANRequired
	}
	if s.setu == nil {
		return nil, nil, ErrSetuNotConfigured
	}
	if tenantID, ok := platform.TenantFromContext(ctx); ok {
		if err := platform.CheckAndRecordUsage(s.db, tenantID, platform.UsageSetuPAN); err != nil {
			return nil, nil, err
		}
	}

	result, err := s.setu.VerifyPAN(rec.PAN, fmt.Sprintf("Verifying PAN for gold loan customer %s onboarding KYC", rec.Code))
	if err != nil {
		return nil, nil, err
	}

	switch {
	case result.Verification != "SUCCESS":
		// PAN itself is invalid/nonexistent per Setu.
		rec.PANStatus = "Failed"
	case !s.setu.IsSandbox() && !namesMatch(rec.Name, result.FullName):
		// PAN is real, but registered to a different person than the name
		// on this customer's profile — do NOT mark this Verified. This is
		// the actual fraud check: a valid PAN alone proves nothing about
		// whose PAN it is. Skipped in sandbox (IsSandbox() above) since
		// Setu's sandbox always returns the same fixed dummy name for any
		// test PAN regardless of the real customer name on file — see
		// SetuClient.IsSandbox's doc comment. Re-enable/verify against
		// production before relying on this for real fraud detection.
		rec.PANStatus = "Name Mismatch"
	default:
		rec.PANStatus = "Verified"
	}
	// Overall KYC is derived, never auto-set from this single check.
	rec.KYCStatus = deriveKYCStatus(rec.PANStatus, rec.AadhaarStatus)
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, nil, err
	}

	updated, err := s.repo.FindByID(ctx, rec.ID)
	if err != nil {
		return nil, nil, err
	}
	return updated, result, nil
}

// StartAadhaarVerify begins a DigiLocker Aadhaar-verify request (see
// internal/platform/setu_digilocker.go) for this customer and stores the
// request id for the follow-up CheckAadhaarVerify call. redirectURL is
// where DigiLocker sends the customer back to after they complete login on
// their own device — the frontend supplies this (see handler.go) since it
// knows its own callback page's URL.
func (s *Service) StartAadhaarVerify(ctx context.Context, id uint, branchID *uint, redirectURL string) (*platform.DigilockerRequest, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrNotFound
	}
	if s.digilocker == nil {
		return nil, ErrDigilockerNotConfigured
	}
	if tenantID, ok := platform.TenantFromContext(ctx); ok {
		if err := platform.CheckAndRecordUsage(s.db, tenantID, platform.UsageSetuAadhaar); err != nil {
			return nil, err
		}
	}

	req, err := s.digilocker.CreateRequest(redirectURL)
	if err != nil {
		return nil, err
	}

	rec.DigilockerRequestID = req.ID
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return req, nil
}

// CheckAadhaarVerify polls the outstanding DigiLocker request started by
// StartAadhaarVerify. While the customer hasn't finished logging into
// DigiLocker yet, this returns status "unauthenticated" and leaves
// AadhaarStatus/KYCStatus untouched — callers should poll again later.
// Once authenticated, it fetches the e-Aadhaar data, updates AadhaarStatus/
// KYCStatus (and AadhaarLast4 for display), and returns the fetched data.
func (s *Service) CheckAadhaarVerify(ctx context.Context, id uint, branchID *uint) (*Customer, *platform.DigilockerStatus, *platform.AadhaarXML, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, nil, nil, ErrNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, nil, nil, ErrNotFound
	}
	if s.digilocker == nil {
		return nil, nil, nil, ErrDigilockerNotConfigured
	}
	if rec.DigilockerRequestID == "" {
		return nil, nil, nil, ErrNoDigilockerRequest
	}

	status, err := s.digilocker.GetStatus(rec.DigilockerRequestID)
	if err != nil {
		return nil, nil, nil, err
	}
	if status.Status != "authenticated" {
		return rec, status, nil, nil
	}

	aadhaar, err := s.digilocker.GetAadhaar(rec.DigilockerRequestID)
	if err != nil {
		return nil, nil, nil, err
	}

	// Aadhaar itself being fetchable proves the customer completed a real
	// DigiLocker login — that IS the verification (unlike PAN, there's no
	// separate "is this Aadhaar valid" check to fail here). Same name-match
	// posture as VerifyPAN: skip in sandbox, since sandbox always returns
	// the same fixed dummy identity regardless of the real customer name.
	if !s.digilocker.IsSandbox() && !namesMatch(rec.Name, aadhaar.Aadhaar.Name) {
		rec.AadhaarStatus = "Name Mismatch"
	} else {
		rec.AadhaarStatus = "Verified"
	}
	// Overall KYC is derived, never auto-set from this single check.
	rec.KYCStatus = deriveKYCStatus(rec.PANStatus, rec.AadhaarStatus)
	if len(aadhaar.Aadhaar.MaskedNumber) >= 4 {
		rec.AadhaarLast4 = aadhaar.Aadhaar.MaskedNumber[len(aadhaar.Aadhaar.MaskedNumber)-4:]
	}
	rec.DigilockerRequestID = "" // request consumed — a re-verify starts a fresh one

	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, nil, nil, err
	}
	updated, err := s.repo.FindByID(ctx, rec.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	return updated, status, aadhaar, nil
}

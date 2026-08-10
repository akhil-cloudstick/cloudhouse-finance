package customer

import (
	"errors"
	"fmt"
	"time"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/platform"
)

var (
	ErrNotFound      = errors.New("customer not found")
	ErrNameRequired  = errors.New("name is required")
	ErrPhoneRequired = errors.New("phone is required")
	ErrBranchReq     = errors.New("branch is required")
	ErrBranchInvalid = errors.New("branch does not exist")
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
}

type UpdateInput = CreateInput

// Service implements customer business rules on top of the Repository.
type Service struct {
	repo          *Repository
	branchRepo    *branch.Repository
	aadhaarCipher *platform.Cipher
}

func NewService(repo *Repository, branchRepo *branch.Repository, aadhaarCipher *platform.Cipher) *Service {
	return &Service{repo: repo, branchRepo: branchRepo, aadhaarCipher: aadhaarCipher}
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
	return nil
}

func (s *Service) checkBranch(id uint) error {
	ok, err := s.branchRepo.Exists(id)
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

func (s *Service) Create(in CreateInput) (*Customer, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	if err := s.checkBranch(in.BranchID); err != nil {
		return nil, err
	}

	count, err := s.repo.CountAll()
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("CUST-%02d", count+1)

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

		// Stage-1 stub: no real verification call is made yet. Replace with
		// a live Setu PAN-verify / DigiLocker Aadhaar call before this
		// becomes a production status.
		KYCStatus:     "Verified",
		PANStatus:     "Verified",
		AadhaarStatus: "Verified",
	}
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

func (s *Service) List(query string, limit, offset int) ([]Customer, error) {
	return s.repo.FindAll(query, limit, offset)
}

func (s *Service) Get(id uint) (*Customer, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) Update(id uint, in UpdateInput) (*Customer, error) {
	if err := validate(in); err != nil {
		return nil, err
	}
	if err := s.checkBranch(in.BranchID); err != nil {
		return nil, err
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
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

	if in.Aadhaar != "" {
		encrypted, err := s.aadhaarCipher.Encrypt(in.Aadhaar)
		if err != nil {
			return nil, err
		}
		rec.AadhaarEncrypted = encrypted
		rec.AadhaarLast4 = aadhaarLast4(in.Aadhaar)
	}

	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

func (s *Service) Delete(id uint) error {
	if _, err := s.repo.FindByID(id); err != nil {
		return ErrNotFound
	}
	return s.repo.Delete(id)
}

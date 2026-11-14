package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Investors are their own table (see migration 0081), not customers with a type. They take the
// same request body as a customer and answer with the same JSON shape (customer_type is always
// "Investor"), so the console can keep one form and one set of types for both.

// InvestorLine is one investment that still ties an investor down, as the delete dialog lists it.
type InvestorLine struct {
	ID     uint   `json:"id"`
	Number string `json:"number"`
	Status string `json:"status"`
}

// InvestmentsForInvestor is wired by the Investment module (it owns the investments table), so the
// common package can name what blocks a delete without importing it.
var InvestmentsForInvestor func(ctx context.Context, investorID uint) ([]InvestorLine, error)

func InvestorToResponse(i *commonModels.Investor) commonModels.CustomerResponse {
	age := i.Age
	if derived := AgeFromDOB(i.DOB, time.Now()); derived > 0 {
		age = &derived
	}
	return commonModels.CustomerResponse{
		ID: i.ID, Code: i.Code, Name: i.Name, Phone: i.Phone, DOB: i.DOB, Address: i.Address,
		BranchID: i.BranchID, Branch: i.Branch,
		PhotoURL: i.PhotoURL, IdentityProofURL: i.IdentityProofURL, AddressProofURL: i.AddressProofURL, KYCDocumentURL: i.KYCDocumentURL,
		PAN: i.PAN, AadhaarLast4: i.AadhaarLast4,
		NomineeName: i.NomineeName, NomineeRelation: i.NomineeRelation, NomineePhone: i.NomineePhone,
		KYCStatus: i.KYCStatus, PANStatus: i.PANStatus, AadhaarStatus: i.AadhaarStatus,
		FatherName: i.FatherName, District: i.District, Taluk: i.Taluk, Village: i.Village, Place: i.Place, PinCode: i.PinCode,
		Age: age, CustomerType: "Investor",
		BankAccountName: i.BankAccountName, BankAccountNumber: i.BankAccountNumber, BankIFSC: i.BankIFSC,
		CreatedAt: i.CreatedAt, UpdatedAt: i.UpdatedAt,
	}
}

func investorsToResponse(list []commonModels.Investor) []commonModels.CustomerResponse {
	out := make([]commonModels.CustomerResponse, len(list))
	for i := range list {
		out[i] = InvestorToResponse(&list[i])
	}
	return out
}

func investorValidate(in CustomerCreateInput) error { return partyValidate(in, true) }

func FindInvestorByID(ctx context.Context, id uint) (*commonModels.Investor, error) {
	var inv commonModels.Investor
	if err := config.DB.WithContext(ctx).Preload("Branch").First(&inv, id).Error; err != nil {
		return nil, err
	}
	return &inv, nil
}

func investorByUnique(ctx context.Context, column, value string) (*commonModels.Investor, error) {
	var inv commonModels.Investor
	if err := config.DB.WithContext(ctx).Where(column+" = ?", value).First(&inv).Error; err != nil {
		return nil, err
	}
	return &inv, nil
}

func checkInvestorUnique(ctx context.Context, column, value, msg string, excludeID uint) error {
	if value == "" {
		return nil
	}
	existing, err := investorByUnique(ctx, column, value)
	if err == nil && existing.ID != excludeID {
		return NewConflict(msg)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func investorConflict(err error) error {
	if err == nil {
		return nil
	}
	switch msg := err.Error(); {
	case strings.Contains(msg, "uq_investors_tenant_phone"):
		return NewConflict("phone number is already registered to another investor")
	case strings.Contains(msg, "uq_investors_tenant_pan"):
		return NewConflict("PAN is already registered to another investor")
	case strings.Contains(msg, "uq_investors_tenant_aadhaar"):
		return NewConflict("Aadhaar number is already registered to another investor")
	}
	return err
}

func investorMaxCodeSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := config.DB.WithContext(ctx).Model(&commonModels.Investor{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'INV-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

func SaveInvestor(ctx context.Context, in CustomerCreateInput) (*commonModels.Investor, error) {
	in.Phone = strings.TrimSpace(in.Phone)
	normalizeKYC(&in)
	if err := investorValidate(in); err != nil {
		return nil, err
	}
	if err := checkCustomerBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	if err := checkInvestorUnique(ctx, "phone", in.Phone, "phone number is already registered to another investor", 0); err != nil {
		return nil, err
	}
	if err := checkInvestorUnique(ctx, "pan", in.PAN, "PAN is already registered to another investor", 0); err != nil {
		return nil, err
	}
	aadhaarHash := config.AadhaarCipher.Fingerprint(in.Aadhaar)
	if err := checkInvestorUnique(ctx, "aadhaar_hash", aadhaarHash, "Aadhaar number is already registered to another investor", 0); err != nil {
		return nil, err
	}
	encrypted, err := config.AadhaarCipher.Encrypt(in.Aadhaar)
	if err != nil {
		return nil, err
	}
	maxSuffix, err := investorMaxCodeSuffix(ctx)
	if err != nil {
		return nil, err
	}
	rec := &commonModels.Investor{
		Code: fmt.Sprintf("INV-%02d", maxSuffix+1), Name: in.Name, Phone: in.Phone, DOB: in.DOB, Address: in.Address,
		BranchID: in.BranchID, PhotoURL: in.PhotoURL, IdentityProofURL: in.IdentityProofURL,
		AddressProofURL: in.AddressProofURL, KYCDocumentURL: in.KYCDocumentURL, PAN: in.PAN,
		AadhaarLast4: aadhaarLast4(in.Aadhaar), AadhaarEncrypted: encrypted, AadhaarHash: aadhaarHash,
		NomineeName: in.NomineeName, NomineeRelation: in.NomineeRelation, NomineePhone: in.NomineePhone,
		FatherName: in.FatherName, District: in.District, Taluk: in.Taluk, Village: in.Village, Place: in.Place,
		PinCode: in.PinCode, Age: in.Age,
		BankAccountName: in.BankAccountName, BankAccountNumber: in.BankAccountNumber, BankIFSC: in.BankIFSC,
		KYCStatus: "Pending", PANStatus: "Pending", AadhaarStatus: "Pending",
	}
	if err := config.DB.WithContext(ctx).Create(rec).Error; err != nil {
		return nil, investorConflict(err)
	}
	return FindInvestorByID(ctx, rec.ID)
}

func updateInvestor(ctx context.Context, id uint, in CustomerCreateInput, branchID *uint) (*commonModels.Investor, error) {
	in.Phone = strings.TrimSpace(in.Phone)
	normalizeKYC(&in)
	rec, err := FindInvestorByID(ctx, id)
	if err != nil || (branchID != nil && rec.BranchID != *branchID) {
		return nil, NewNotFound("investor not found")
	}
	// An edit that leaves Aadhaar blank keeps the number already on file (it is stored encrypted and
	// never sent back to the form), so only a first-time or changed number is required / checked.
	check := in
	if check.Aadhaar == "" && rec.AadhaarEncrypted != "" {
		check.Aadhaar = "000000000000"
	}
	if err := investorValidate(check); err != nil {
		return nil, err
	}
	if err := checkCustomerBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	if in.Phone != rec.Phone {
		if err := checkInvestorUnique(ctx, "phone", in.Phone, "phone number is already registered to another investor", rec.ID); err != nil {
			return nil, err
		}
	}
	if in.PAN != rec.PAN {
		if err := checkInvestorUnique(ctx, "pan", in.PAN, "PAN is already registered to another investor", rec.ID); err != nil {
			return nil, err
		}
	}
	if in.Aadhaar != "" {
		aadhaarHash := config.AadhaarCipher.Fingerprint(in.Aadhaar)
		if aadhaarHash != rec.AadhaarHash {
			if err := checkInvestorUnique(ctx, "aadhaar_hash", aadhaarHash, "Aadhaar number is already registered to another investor", rec.ID); err != nil {
				return nil, err
			}
			encrypted, err := config.AadhaarCipher.Encrypt(in.Aadhaar)
			if err != nil {
				return nil, err
			}
			rec.AadhaarEncrypted, rec.AadhaarLast4, rec.AadhaarHash = encrypted, aadhaarLast4(in.Aadhaar), aadhaarHash
		}
	}
	rec.Name, rec.Phone, rec.DOB, rec.Address, rec.BranchID = in.Name, in.Phone, in.DOB, in.Address, in.BranchID
	rec.PhotoURL, rec.IdentityProofURL, rec.AddressProofURL, rec.KYCDocumentURL = in.PhotoURL, in.IdentityProofURL, in.AddressProofURL, in.KYCDocumentURL
	rec.PAN = in.PAN
	rec.NomineeName, rec.NomineeRelation, rec.NomineePhone = in.NomineeName, in.NomineeRelation, in.NomineePhone
	rec.FatherName, rec.District, rec.Taluk, rec.Village, rec.Place, rec.PinCode = in.FatherName, in.District, in.Taluk, in.Village, in.Place, in.PinCode
	if in.Age != nil {
		rec.Age = in.Age
	}
	rec.BankAccountName, rec.BankAccountNumber, rec.BankIFSC = in.BankAccountName, in.BankAccountNumber, in.BankIFSC
	if err := config.DB.WithContext(ctx).Omit("Branch").Save(rec).Error; err != nil {
		return nil, investorConflict(err)
	}
	return FindInvestorByID(ctx, rec.ID)
}

// hardDeleteInvestor removes an investor for good. Any investment still on file blocks it —
// each one has to be closed and deleted first — and the message names them.
func hardDeleteInvestor(ctx context.Context, id uint, branchID *uint) error {
	rec, err := FindInvestorByID(ctx, id)
	if err != nil || (branchID != nil && rec.BranchID != *branchID) {
		return NewNotFound("investor not found")
	}
	if config.IsDemoRun(ctx) {
		return NewConflict("investor delete is not available in the demo")
	}
	if InvestmentsForInvestor == nil {
		return NewConflict("investor delete is not wired up")
	}
	lines, err := InvestmentsForInvestor(ctx, id)
	if err != nil {
		return err
	}
	if len(lines) > 0 {
		items := make([]string, len(lines))
		for i, l := range lines {
			items[i] = fmt.Sprintf("Investment %s (%s)", l.Number, l.Status)
		}
		return NewConflict(fmt.Sprintf("Cannot delete this investor — it still has: %s. Close or delete these first.", strings.Join(items, "; ")))
	}
	return config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Investments deleted earlier are soft-deleted rows that still point here.
		if err := tx.Exec("DELETE FROM investments WHERE customer_id = ? AND deleted_at IS NOT NULL", rec.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec("UPDATE cash_movements SET party_investor_id = NULL WHERE party_investor_id = ?", rec.ID).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&commonModels.Investor{}, rec.ID).Error
	})
}

func ListInvestors(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	q := config.DB.WithContext(ctx).Model(&commonModels.Investor{}).Preload("Branch")
	if s := strings.TrimSpace(c.QueryParam("search")); s != "" {
		if IsDigitQuery(s) {
			q = q.Order(clause.Expr{SQL: NumericExactFirstOrder("code"), Vars: []any{NumericExactFirstArg(s)}})
			q = q.Where("("+NumericPrefixSQL("code")+" OR phone LIKE ?)", NumericPrefixArg(s), "%"+s+"%")
		} else {
			q = q.Where("(name ILIKE ? OR code ILIKE ? OR phone ILIKE ?)", "%"+s+"%", "%"+s+"%", "%"+s+"%")
		}
	}
	if b := auth.GetBranchScope(c); b != nil {
		q = q.Where("branch_id = ?", *b)
	}
	if ids := parseUintCSV(c.QueryParam("branch_ids")); len(ids) > 0 {
		q = q.Where("branch_id IN ?", ids)
	}
	q = q.Order("id asc")
	var list []commonModels.Investor
	if limit == 0 {
		if err := q.Limit(unpagedCustomerCap).Find(&list).Error; err != nil {
			return FailErr(c, err)
		}
		return SuccessAll(c, investorsToResponse(list))
	}
	var total int64
	if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return FailErr(c, err)
	}
	if err := q.Limit(limit).Offset(offset).Find(&list).Error; err != nil {
		return FailErr(c, err)
	}
	return SuccessPage(c, page, limit, total, investorsToResponse(list))
}

func investorForCaller(c echo.Context, id uint) (*commonModels.Investor, error) {
	rec, err := FindInvestorByID(auth.RequestContext(c), id)
	if err != nil {
		return nil, NewNotFound("investor not found")
	}
	if b := auth.GetBranchScope(c); b != nil && rec.BranchID != *b {
		return nil, NewNotFound("investor not found")
	}
	return rec, nil
}

func GetInvestorById(c echo.Context) error {
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := investorForCaller(c, id)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, InvestorToResponse(rec))
}

// GetInvestorByCode backs the console's investor links (INV-01).
func GetInvestorByCode(c echo.Context) error {
	var rec commonModels.Investor
	if err := config.DB.WithContext(auth.RequestContext(c)).Preload("Branch").Where("code = ?", c.Param("code")).First(&rec).Error; err != nil {
		return FailErr(c, NewNotFound("investor not found"))
	}
	if b := auth.GetBranchScope(c); b != nil && rec.BranchID != *b {
		return FailErr(c, NewNotFound("investor not found"))
	}
	return Success(c, http.StatusOK, InvestorToResponse(&rec))
}

func GetInvestorAadhaar(c echo.Context) error {
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := investorForCaller(c, id)
	if err != nil {
		return FailErr(c, err)
	}
	if rec.AadhaarEncrypted == "" {
		return FailErr(c, NewBadRequest("investor has no Aadhaar number on file"))
	}
	aadhaar, err := config.AadhaarCipher.Decrypt(rec.AadhaarEncrypted)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{"aadhaar": aadhaar})
}

func bindInvestorInput(c echo.Context) (CustomerCreateInput, error) {
	var req customerRequest
	if err := BindJSON(c, &req); err != nil {
		return CustomerCreateInput{}, NewBadRequest("Invalid input")
	}
	in, err := req.toInput()
	if err != nil {
		return in, err
	}
	in.BranchID = auth.EnforceBranchOnWrite(c, in.BranchID)
	return in, nil
}

func CreateInvestor(c echo.Context) error {
	in, err := bindInvestorInput(c)
	if err != nil {
		return FailErr(c, err)
	}
	ctx := auth.RequestContext(c)
	// An existing customer can be made an investor (?from_customer_id=). The Aadhaar number is stored
	// encrypted and never sent to the console, so it is carried over from the customer record here.
	// The phone / PAN / Aadhaar uniqueness checks only look at other investors, so the customer's own
	// number never blocks this; a number that already belongs to an investor still does.
	if id := parseUintCSV(c.QueryParam("from_customer_id")); len(id) == 1 {
		cust, err := FindCustomerByID(ctx, id[0])
		if err != nil || (auth.GetBranchScope(c) != nil && cust.BranchID != *auth.GetBranchScope(c)) {
			return FailErr(c, NewNotFound("customer not found"))
		}
		if in.Aadhaar == "" && cust.AadhaarEncrypted != "" {
			aadhaar, err := config.AadhaarCipher.Decrypt(cust.AadhaarEncrypted)
			if err != nil {
				return FailErr(c, err)
			}
			in.Aadhaar = aadhaar
		}
		if in.PAN == "" {
			in.PAN = cust.PAN
		}
	}
	rec, err := SaveInvestor(ctx, in)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, InvestorToResponse(rec))
}

func UpdateInvestor(c echo.Context) error {
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	in, err := bindInvestorInput(c)
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := updateInvestor(auth.RequestContext(c), id, in, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, InvestorToResponse(rec))
}

func HardDeleteInvestor(c echo.Context) error {
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	if err := hardDeleteInvestor(auth.RequestContext(c), id, auth.GetBranchScope(c)); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Investor deleted permanently")
}

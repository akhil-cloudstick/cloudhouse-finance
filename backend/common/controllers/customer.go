package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

var customerPhoneRe = regexp.MustCompile(`^\d{10}$`)

type customerRequest struct {
	Name              string `json:"name" binding:"required"`
	Phone             string `json:"phone"`
	DOB               string `json:"dob"`
	Address           string `json:"address"`
	BranchID          uint   `json:"branch_id" binding:"required"`
	PhotoURL          string `json:"photo_url"`
	IdentityProofURL  string `json:"identity_proof_url"`
	AddressProofURL   string `json:"address_proof_url"`
	KYCDocumentURL    string `json:"kyc_document_url"`
	PAN               string `json:"pan"`
	Aadhaar           string `json:"aadhaar"`
	NomineeName       string `json:"nominee_name"`
	NomineeRelation   string `json:"nominee_relation"`
	NomineePhone      string `json:"nominee_phone"`
	FatherName        string `json:"father_name"`
	District          string `json:"district"`
	Taluk             string `json:"taluk"`
	Village           string `json:"village"`
	Place             string `json:"place"`
	PinCode           string `json:"pin_code"`
	Age               *int   `json:"age"`
	CustomerType      string `json:"customer_type"`
	BankAccountName   string `json:"bank_account_name"`
	BankAccountNumber string `json:"bank_account_number"`
	BankIFSC          string `json:"bank_ifsc"`
}

type startAadhaarVerifyRequest struct {
	RedirectURL string `json:"redirect_url" binding:"required"`
}

type CustomerFilter struct {
	Query         string
	BranchID      *uint
	BranchIDs     []uint
	PANStatus     string
	AadhaarStatus string
	CustomerType  string
	Limit         int
	Offset        int
}

type CustomerCreateInput struct {
	Name              string
	Phone             string
	DOB               time.Time
	Address           string
	BranchID          uint
	PhotoURL          string
	IdentityProofURL  string
	AddressProofURL   string
	KYCDocumentURL    string
	PAN               string
	Aadhaar           string
	NomineeName       string
	NomineeRelation   string
	NomineePhone      string
	FatherName        string
	District          string
	Taluk             string
	Village           string
	Place             string
	PinCode           string
	Age               *int
	CustomerType      string
	BankAccountName   string
	BankAccountNumber string
	BankIFSC          string
}

type CustomerUpdateInput = CustomerCreateInput

func splitStringCSV(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func parseUintCSV(s string) []uint {
	if s == "" {
		return nil
	}
	var out []uint
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		v, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			continue
		}
		out = append(out, uint(v))
	}
	return out
}

func parseDOB(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	return time.Parse("2006-01-02", s)
}

func (req customerRequest) toInput() (CustomerCreateInput, error) {
	dob, err := parseDOB(req.DOB)
	if err != nil {
		return CustomerCreateInput{}, NewBadRequest("invalid dob: expected YYYY-MM-DD")
	}
	return CustomerCreateInput{
		Name:              req.Name,
		Phone:             req.Phone,
		DOB:               dob,
		Address:           req.Address,
		BranchID:          req.BranchID,
		PhotoURL:          req.PhotoURL,
		IdentityProofURL:  req.IdentityProofURL,
		AddressProofURL:   req.AddressProofURL,
		KYCDocumentURL:    req.KYCDocumentURL,
		PAN:               req.PAN,
		Aadhaar:           req.Aadhaar,
		NomineeName:       req.NomineeName,
		NomineeRelation:   req.NomineeRelation,
		NomineePhone:      req.NomineePhone,
		FatherName:        req.FatherName,
		District:          req.District,
		Taluk:             req.Taluk,
		Village:           req.Village,
		Place:             req.Place,
		PinCode:           req.PinCode,
		Age:               req.Age,
		CustomerType:      req.CustomerType,
		BankAccountName:   req.BankAccountName,
		BankAccountNumber: req.BankAccountNumber,
		BankIFSC:          req.BankIFSC,
	}, nil
}

func ToResponseList(customers []commonModels.Customer) []commonModels.CustomerResponse {
	out := make([]commonModels.CustomerResponse, len(customers))
	for i := range customers {
		out[i] = CustomerToResponse(&customers[i])
	}
	return out
}

func insertCustomer(ctx context.Context, c *commonModels.Customer) error {
	return config.DB.
		WithContext(ctx).Create(c).Error
}

func findCustomers(ctx context.Context, f CustomerFilter) ([]commonModels.Customer, int64, error) {
	var customers []commonModels.Customer
	q := config.DB.
		WithContext(ctx).Preload("Branch").Order("id asc")
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Where("name ILIKE ? OR code ILIKE ? OR phone ILIKE ?", like, like, like)
	}
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	if len(f.BranchIDs) > 0 {
		q = q.Where("branch_id IN ?", f.BranchIDs)
	}
	// pan_status / aadhaar_status accept a single value or a comma-separated list.
	if vals := splitStringCSV(f.PANStatus); len(vals) > 0 {
		q = q.Where("pan_status IN ?", vals)
	}
	if vals := splitStringCSV(f.AadhaarStatus); len(vals) > 0 {
		q = q.Where("aadhaar_status IN ?", vals)
	}
	if f.CustomerType != "" {
		q = q.Where("customer_type = ?", f.CustomerType)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&commonModels.Customer{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit).Offset(f.Offset)
	}
	err := q.Find(&customers).Error
	return customers, total, err
}

func FindCustomerByID(ctx context.Context, id uint) (*commonModels.Customer, error) {
	var c commonModels.Customer
	if err := config.DB.
		WithContext(ctx).Preload("Branch").First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func FindByPhone(ctx context.Context, phone string) (*commonModels.Customer, error) {
	var c commonModels.Customer
	if err := config.DB.
		WithContext(ctx).Preload("Branch").Where("phone = ?", phone).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func findByPAN(ctx context.Context, pan string) (*commonModels.Customer, error) {
	var c commonModels.Customer
	if err := config.DB.
		WithContext(ctx).Where("pan = ?", pan).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func findByAadhaarHash(ctx context.Context, hash string) (*commonModels.Customer, error) {
	var c commonModels.Customer
	if err := config.DB.
		WithContext(ctx).Where("aadhaar_hash = ?", hash).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func persistCustomer(ctx context.Context, c *commonModels.Customer) error {
	return config.DB.
		WithContext(ctx).Omit("Branch").Save(c).Error
}

func removeCustomer(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Delete(&commonModels.Customer{}, id).Error
}

func customerDB() config.Conn {
	return config.DB
}

func countCustomerAll(ctx context.Context) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Unscoped().Model(&commonModels.Customer{}).Count(&count).Error
	return count, err
}

func customerMaxCodeSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := config.DB.
		WithContext(ctx).Model(&commonModels.Customer{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'CUST-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

func customerValidate(in CustomerCreateInput) error {
	if in.Name == "" {
		return NewBadRequest("name is required")
	}
	if in.Phone == "" {
		return NewBadRequest("phone is required")
	}
	if !customerPhoneRe.MatchString(in.Phone) {
		return NewBadRequest("phone must be a 10-digit number")
	}
	if in.BranchID == 0 {
		return NewBadRequest("branch is required")
	}
	switch in.CustomerType {
	case "", "Borrower":
	case "Investor":
		if in.BankAccountName == "" || in.BankAccountNumber == "" || in.BankIFSC == "" {
			return NewBadRequest("bank account name, number and IFSC are required for an investor")
		}
		if in.PAN == "" || in.Aadhaar == "" {
			return NewBadRequest("PAN and Aadhaar are required for an investor")
		}
	default:
		return NewBadRequest("customer type must be Borrower or Investor")
	}
	return nil
}

func checkCustomerBranch(ctx context.Context, id uint) error {
	ok, err := BranchExists(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return NewBadRequest("branch does not exist")
	}
	return nil
}

func checkCustomerPhoneUnique(ctx context.Context, phone string, excludeID uint) error {
	if phone == "" {
		return nil
	}
	existing, err := FindByPhone(ctx, phone)
	if err == nil && existing.ID != excludeID {
		return NewConflict("phone number is already registered to another customer")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func customerPhoneConflict(err error) error {
	if err != nil && strings.Contains(err.Error(), "uq_customers_tenant_phone") {
		return NewConflict("phone number is already registered to another customer")
	}
	return err
}

func normalizeKYC(in *CustomerCreateInput) {
	in.PAN = strings.ToUpper(strings.TrimSpace(in.PAN))
	in.Aadhaar = strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(in.Aadhaar))
}

func checkPANUnique(ctx context.Context, pan string, excludeID uint) error {
	if pan == "" {
		return nil
	}
	existing, err := findByPAN(ctx, pan)
	if err == nil && existing.ID != excludeID {
		return NewConflict("PAN is already registered to another customer")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func checkAadhaarUnique(ctx context.Context, hash string, excludeID uint) error {
	if hash == "" {
		return nil
	}
	existing, err := findByAadhaarHash(ctx, hash)
	if err == nil && existing.ID != excludeID {
		return NewConflict("Aadhaar number is already registered to another customer")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func kycConflict(err error) error {
	if err == nil {
		return nil
	}
	switch msg := err.Error(); {
	case strings.Contains(msg, "uq_customers_tenant_pan"):
		return NewConflict("PAN is already registered to another customer")
	case strings.Contains(msg, "uq_customers_tenant_aadhaar"):
		return NewConflict("Aadhaar number is already registered to another customer")
	}
	return err
}

func aadhaarLast4(aadhaar string) string {
	if len(aadhaar) <= 4 {
		return aadhaar
	}
	return aadhaar[len(aadhaar)-4:]
}

func SaveCustomer(ctx context.Context, in CustomerCreateInput) (*commonModels.Customer, error) {
	in.Phone = strings.TrimSpace(in.Phone)
	normalizeKYC(&in)
	if err := customerValidate(in); err != nil {
		return nil, err
	}
	if err := checkCustomerBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	if err := checkCustomerPhoneUnique(ctx, in.Phone, 0); err != nil {
		return nil, err
	}
	if err := checkPANUnique(ctx, in.PAN, 0); err != nil {
		return nil, err
	}
	var aadhaarHash string
	if in.Aadhaar != "" {
		aadhaarHash = config.AadhaarCipher.
			Fingerprint(in.Aadhaar)
	}
	if err := checkAadhaarUnique(ctx, aadhaarHash, 0); err != nil {
		return nil, err
	}
	maxSuffix, err := customerMaxCodeSuffix(ctx)
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("CUST-%02d", maxSuffix+1)
	customerType := in.CustomerType
	if customerType == "" {
		customerType = "Borrower"
	}
	var encryptedAadhaar, last4 string
	if in.Aadhaar != "" {
		encryptedAadhaar, err = config.AadhaarCipher.
			Encrypt(in.Aadhaar)
		if err != nil {
			return nil, err
		}
		last4 = aadhaarLast4(in.Aadhaar)
	}
	rec := &commonModels.Customer{
		Code:              code,
		Name:              in.Name,
		Phone:             in.Phone,
		DOB:               in.DOB,
		Address:           in.Address,
		BranchID:          in.BranchID,
		PhotoURL:          in.PhotoURL,
		IdentityProofURL:  in.IdentityProofURL,
		AddressProofURL:   in.AddressProofURL,
		KYCDocumentURL:    in.KYCDocumentURL,
		PAN:               in.PAN,
		AadhaarLast4:      last4,
		AadhaarEncrypted:  encryptedAadhaar,
		AadhaarHash:       aadhaarHash,
		NomineeName:       in.NomineeName,
		NomineeRelation:   in.NomineeRelation,
		NomineePhone:      in.NomineePhone,
		FatherName:        in.FatherName,
		District:          in.District,
		Taluk:             in.Taluk,
		Village:           in.Village,
		Place:             in.Place,
		PinCode:           in.PinCode,
		Age:               in.Age,
		CustomerType:      customerType,
		BankAccountName:   in.BankAccountName,
		BankAccountNumber: in.BankAccountNumber,
		BankIFSC:          in.BankIFSC,
		KYCStatus:         "Pending",
		PANStatus:         "Pending",
		AadhaarStatus:     "Pending",
	}
	if err := insertCustomer(ctx, rec); err != nil {
		return nil, kycConflict(customerPhoneConflict(err))
	}
	return FindCustomerByID(ctx, rec.ID)
}

func listCustomers(ctx context.Context, f CustomerFilter) ([]commonModels.Customer, int64, error) {
	return findCustomers(ctx, f)
}

func getCustomer(ctx context.Context, id uint, branchID *uint) (*commonModels.Customer, error) {
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("customer not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, NewNotFound("customer not found")
	}
	return rec, nil
}

func decryptAadhaar(ctx context.Context, id uint, branchID *uint) (string, error) {
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return "", NewNotFound("customer not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return "", NewNotFound("customer not found")
	}
	if rec.AadhaarEncrypted == "" {
		return "", NewBadRequest("customer has no Aadhaar number on file")
	}
	return config.AadhaarCipher.
		Decrypt(rec.AadhaarEncrypted)
}

func updateCustomer(ctx context.Context, id uint, in CustomerUpdateInput, branchID *uint) (*commonModels.Customer, error) {
	in.Phone = strings.TrimSpace(in.Phone)
	normalizeKYC(&in)
	if err := customerValidate(in); err != nil {
		return nil, err
	}
	if err := checkCustomerBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("customer not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, NewNotFound("customer not found")
	}
	if in.Phone != rec.Phone {
		if err := checkCustomerPhoneUnique(ctx, in.Phone, rec.ID); err != nil {
			return nil, err
		}
	}
	if in.PAN != rec.PAN {
		if err := checkPANUnique(ctx, in.PAN, rec.ID); err != nil {
			return nil, err
		}
	}
	var newAadhaarHash string
	if in.Aadhaar != "" {
		newAadhaarHash = config.AadhaarCipher.
			Fingerprint(in.Aadhaar)
		if newAadhaarHash != rec.AadhaarHash {
			if err := checkAadhaarUnique(ctx, newAadhaarHash, rec.ID); err != nil {
				return nil, err
			}
		}
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
		encrypted, err := config.AadhaarCipher.
			Encrypt(in.Aadhaar)
		if err != nil {
			return nil, err
		}
		rec.AadhaarEncrypted = encrypted
		rec.AadhaarLast4 = aadhaarLast4(in.Aadhaar)
		rec.AadhaarHash = newAadhaarHash
	}
	if err := persistCustomer(ctx, rec); err != nil {
		return nil, kycConflict(customerPhoneConflict(err))
	}
	return FindCustomerByID(ctx, rec.ID)
}

func deleteCustomer(ctx context.Context, id uint, branchID *uint) error {
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return NewNotFound("customer not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return NewNotFound("customer not found")
	}
	return removeCustomer(ctx, id)
}

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

func verifyPAN(ctx context.Context, id uint, branchID *uint) (*commonModels.Customer, *config.PANVerificationResult, error) {
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return nil, nil, NewNotFound("customer not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, nil, NewNotFound("customer not found")
	}
	if rec.PAN == "" {
		return nil, nil, NewBadRequest("customer has no PAN number on file")
	}
	if config.PAN == nil || config.IsDemoRun(ctx) {
		return nil, nil, NewUnavailable("PAN verification is not configured")
	}
	if tenantID, ok := config.TenantFromContext(ctx); ok {
		if err := CheckAndRecordUsage(config.BaseDB,
			tenantID, "setu_pan"); err != nil {
			return nil, nil, err
		}
	}
	result, err := config.PAN.
		VerifyPAN(rec.PAN)
	if err != nil {
		return nil, nil, err
	}
	switch {
	case result.Verification != "SUCCESS":
		rec.PANStatus = "Failed"
	case !config.PAN.
		IsSandbox() && !namesMatch(rec.Name, result.FullName):
		rec.PANStatus = "Name Mismatch"
	default:
		rec.PANStatus = "Verified"
	}
	// Overall KYC is derived, never auto-set from this single check.
	rec.KYCStatus = deriveKYCStatus(rec.PANStatus, rec.AadhaarStatus)
	if err := persistCustomer(ctx, rec); err != nil {
		return nil, nil, err
	}
	updated, err := FindCustomerByID(ctx, rec.ID)
	if err != nil {
		return nil, nil, err
	}
	return updated, result, nil
}

func startAadhaarVerify(ctx context.Context, id uint, branchID *uint, redirectURL string) (*config.DigilockerRequest, error) {
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("customer not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, NewNotFound("customer not found")
	}
	if config.Digilocker == nil || config.IsDemoRun(ctx) {
		return nil, NewUnavailable("Aadhaar verification is not configured")
	}
	if rec.AadhaarLast4 == "" {
		return nil, NewBadRequest("add the customer's Aadhaar number before verifying via DigiLocker")
	}
	if tenantID, ok := config.TenantFromContext(ctx); ok {
		if err := CheckAndRecordUsage(config.BaseDB,
			tenantID, "setu_aadhaar"); err != nil {
			return nil, err
		}
	}
	req, err := config.Digilocker.
		CreateRequest(redirectURL)
	if err != nil {
		return nil, err
	}
	rec.DigilockerRequestID = req.ID
	if err := persistCustomer(ctx, rec); err != nil {
		return nil, err
	}
	return req, nil
}

func checkAadhaarVerify(ctx context.Context, id uint, branchID *uint) (*commonModels.Customer, *config.DigilockerStatus, *config.AadhaarXML, []string, error) {
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return nil, nil, nil, nil, NewNotFound("customer not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, nil, nil, nil, NewNotFound("customer not found")
	}
	if config.Digilocker == nil || config.IsDemoRun(ctx) {
		return nil, nil, nil, nil, NewUnavailable("Aadhaar verification is not configured")
	}
	if rec.DigilockerRequestID == "" {
		return nil, nil, nil, nil, NewBadRequest("no Aadhaar verification has been started for this customer")
	}
	status, err := config.Digilocker.
		GetStatus(rec.DigilockerRequestID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if status.Status != "authenticated" {
		return rec, status, nil, nil, nil
	}
	aadhaar, err := config.Digilocker.
		GetAadhaar(rec.DigilockerRequestID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	reasons := aadhaarMismatches(rec, aadhaar)
	if len(reasons) > 0 {
		rec.AadhaarStatus = "Failed"
	} else {
		rec.AadhaarStatus = "Verified"
	}
	// Overall KYC is derived, never auto-set from this single check.
	rec.KYCStatus = deriveKYCStatus(rec.PANStatus, rec.AadhaarStatus)
	if len(reasons) == 0 && len(aadhaar.Aadhaar.MaskedNumber) >= 4 {
		rec.AadhaarLast4 = aadhaar.Aadhaar.MaskedNumber[len(aadhaar.Aadhaar.MaskedNumber)-4:]
	}
	rec.DigilockerRequestID = ""
	if err := persistCustomer(ctx, rec); err != nil {
		return nil, nil, nil, nil, err
	}
	updated, err := FindCustomerByID(ctx, rec.ID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	return updated, status, aadhaar, reasons, nil
}

func CreateCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req customerRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input, err := req.toInput()
	if err != nil {
		return FailErr(c, err)
	}
	branchID := auth.EnforceBranchOnWrite(c, input.BranchID)
	input.BranchID = branchID
	rec, err := SaveCustomer(ctx, input)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, CustomerToResponse(rec))
}

func ListCustomers(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	f := CustomerFilter{
		Query:         c.QueryParam("search"),
		BranchID:      auth.GetBranchScope(c),
		BranchIDs:     parseUintCSV(c.QueryParam("branch_ids")),
		PANStatus:     c.QueryParam("pan_status"),
		AadhaarStatus: c.QueryParam("aadhaar_status"),
		CustomerType:  c.QueryParam("customer_type"),
	}
	if limit == 0 {
		rec, _, err := listCustomers(ctx, f)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessAll(c, ToResponseList(rec))
	}
	f.Limit, f.Offset = limit, offset
	rec, total, err := listCustomers(ctx, f)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessPage(c, page, limit, total, ToResponseList(rec))
}

func GetCustomerById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := getCustomer(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, CustomerToResponse(rec))
}

func GetCustomerAadhaar(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	aadhaar, err := decryptAadhaar(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{"aadhaar": aadhaar})
}

func UpdateCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req customerRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input, err := req.toInput()
	if err != nil {
		return FailErr(c, err)
	}
	branchID := auth.EnforceBranchOnWrite(c, input.BranchID)
	input.BranchID = branchID
	rec, err := updateCustomer(ctx, id, input, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, CustomerToResponse(rec))
}

func VerifyPAN(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, result, err := verifyPAN(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{
		"customer":     CustomerToResponse(rec),
		"message":      result.Message,
		"matched_name": result.FullName,
		"trace_id":     result.TraceID,
	})
}

func StartAadhaarVerify(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req startAadhaarVerifyRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	digReq, err := startAadhaarVerify(ctx, id, auth.GetBranchScope(c), req.RedirectURL)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{
		"id":         digReq.ID,
		"url":        digReq.URL,
		"status":     digReq.Status,
		"valid_upto": digReq.ValidUpto,
	})
}

func CheckAadhaarVerify(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, status, aadhaar, reasons, err := checkAadhaarVerify(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	if aadhaar == nil {
		return Success(c, http.StatusOK, echo.Map{"status": status.Status})
	}
	return Success(c, http.StatusOK, echo.Map{
		"customer":        CustomerToResponse(rec),
		"status":          status.Status,
		"matched_name":    aadhaar.Aadhaar.Name,
		"dob":             aadhaar.Aadhaar.DateOfBirth,
		"failure_reasons": reasons,
	})
}

func HardDeleteCustomer(c echo.Context) error {
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	if err := hardDeleteCustomer(auth.RequestContext(c), id); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Customer deleted permanently")
}

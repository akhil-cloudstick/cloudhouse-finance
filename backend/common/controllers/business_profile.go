package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

var (
	panPattern          = regexp.MustCompile(`^[A-Z]{5}[0-9]{4}[A-Z]$`)
	aadhaarPattern      = regexp.MustCompile(`^[0-9]{12}$`)
	contactPhonePattern = regexp.MustCompile(`^\+?[0-9][0-9 ()\-]{5,18}$`)
)

type BusinessProfile struct {
	Policy        string `json:"policy"`
	KMLRegNo      string `json:"kml_reg_no"`
	ContactPhone  string `json:"contact_phone"`
	AddressLine   string `json:"address_line"`
	LenderAge     string `json:"lender_age"`
	LenderPAN     string `json:"lender_pan"`
	LenderAadhaar string `json:"lender_aadhaar"`
}

type BusinessProfileInput struct {
	KMLRegNo      string
	ContactPhone  string
	AddressLine   string
	LenderAge     string
	LenderPAN     string
	LenderAadhaar string
}

type updateBusinessProfileRequest struct {
	KMLRegNo      string `json:"kml_reg_no"`
	ContactPhone  string `json:"contact_phone"`
	AddressLine   string `json:"address_line"`
	LenderAge     string `json:"lender_age"`
	LenderPAN     string `json:"lender_pan"`
	LenderAadhaar string `json:"lender_aadhaar"`
}

func businessProfileOf(t *commonModels.Tenant) *BusinessProfile {
	return &BusinessProfile{
		Policy:        commonModels.PolicyOrDefault(t.Policy),
		KMLRegNo:      t.KMLRegNo,
		ContactPhone:  t.ContactPhone,
		AddressLine:   t.AddressLine,
		LenderAge:     t.LenderAge,
		LenderPAN:     t.LenderPAN,
		LenderAadhaar: t.LenderAadhaar,
	}
}

func sessionTenant(ctx context.Context) (*commonModels.Tenant, error) {
	id, ok := config.TenantFromContext(ctx)
	if !ok || id == 0 {
		return nil, NewUnauthorized("no business in session")
	}
	return FindTenantByID(config.AllowCrossTenant(ctx), id)
}

func LenderIdentity(policy, age, pan, aadhaar string) (string, string, string, error) {
	if policy != commonModels.PolicyGML {
		return "", "", "", nil
	}
	age = strings.TrimSpace(age)
	pan = strings.ToUpper(strings.TrimSpace(pan))
	aadhaar = strings.Join(strings.Fields(aadhaar), "")
	n, err := strconv.Atoi(age)
	if err != nil || n < 18 || n > 120 {
		return "", "", "", NewBadRequest("lender age is required for a GML business (18–120)")
	}
	if !panPattern.MatchString(pan) {
		return "", "", "", NewBadRequest("lender PAN is required for a GML business, e.g. ABCDE1234F")
	}
	if !aadhaarPattern.MatchString(aadhaar) {
		return "", "", "", NewBadRequest("lender Aadhaar is required for a GML business (12 digits)")
	}
	return strconv.Itoa(n), pan, aadhaar, nil
}

func NormalizeContactPhone(raw string, required bool) (string, error) {
	var out []string
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if !contactPhonePattern.MatchString(p) {
			return "", NewBadRequest("contact phone must be one or more valid numbers separated by commas, e.g. +91 9000012345")
		}
		out = append(out, p)
	}
	if len(out) == 0 && required {
		return "", NewBadRequest("contact phone number is required")
	}
	return strings.Join(out, ", "), nil
}

func updateBusinessProfile(ctx context.Context, in BusinessProfileInput, by actor) (*BusinessProfile, error) {
	t, err := sessionTenant(ctx)
	if err != nil {
		return nil, err
	}
	contactPhone, err := NormalizeContactPhone(in.ContactPhone, false)
	if err != nil {
		return nil, err
	}
	policy := commonModels.PolicyOrDefault(t.Policy)
	before := fmt.Sprintf("regNo=%q phone=%q address=%q", t.KMLRegNo, t.ContactPhone, t.AddressLine)
	t.KMLRegNo = strings.TrimSpace(in.KMLRegNo)
	t.ContactPhone = contactPhone
	t.AddressLine = strings.TrimSpace(in.AddressLine)
	if policy == commonModels.PolicyGML {
		age, pan, aadhaar, lerr := LenderIdentity(policy, in.LenderAge, in.LenderPAN, in.LenderAadhaar)
		if lerr != nil {
			return nil, lerr
		}
		t.LenderAge, t.LenderPAN, t.LenderAadhaar = age, pan, aadhaar
	}
	if err := PersistTenant(config.AllowCrossTenant(ctx), t); err != nil {
		return nil, err
	}
	if by.employeeID != 0 {
		after := fmt.Sprintf("regNo=%q phone=%q address=%q", t.KMLRegNo, t.ContactPhone, t.AddressLine)
		if policy == commonModels.PolicyGML {
			after += " lenderIdentity=updated"
		}
		name := by.label
		if name == "" {
			name = "unknown"
		}
		writeAuditLog(ctx, by.employeeID, name, "business_profile_updated", "business", t.ID, t.Name, before+" -> "+after)
	}
	return businessProfileOf(t), nil
}

func GetBusinessProfile(c echo.Context) error {
	t, err := sessionTenant(auth.RequestContext(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, businessProfileOf(t))
}

func UpdateBusinessProfile(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req updateBusinessProfileRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	empID, role, _ := auth.ActorFromContext(c)
	rec, err := updateBusinessProfile(ctx, BusinessProfileInput{
		KMLRegNo:      req.KMLRegNo,
		ContactPhone:  req.ContactPhone,
		AddressLine:   req.AddressLine,
		LenderAge:     req.LenderAge,
		LenderPAN:     req.LenderPAN,
		LenderAadhaar: req.LenderAadhaar,
	}, actor{empID, role})
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

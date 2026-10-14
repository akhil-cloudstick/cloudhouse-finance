package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var pledgeSlipTemplate = mustLoadTemplate("pledge_slip", "pledge_slip.html", template.FuncMap{"inc": func(i int) int { return i + 1 }})

var slipHexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type pledgeSlipOrnament struct {
	Name, Purity, NetWeight, Value string
	Quantity                       int
	Photo                          template.URL
}

type pledgeSlipTemplateData struct {
	Brand                                                                     template.CSS
	LegalName, Descriptor, RegLabel, Phones, AddressLine                      string
	LoanNumber, Today, CustomerName, CustomerCode, Phone, Address, BranchName string
	SchemeName, SchemeRate, SchemeLTV, Opened                                 string
	Ornaments                                                                 []pledgeSlipOrnament
	TotalNetWeight, TotalGoldValue                                            string
	Principal, Eligible                                                       string
	Distribution                                                              []bondDistRow
	// Esign marks the customer's signature box so the eSign provider can stamp it there.
	Esign bool
	// LenderSignature is the business's uploaded signature, shown in the Manager box.
	LenderSignature template.HTML
}

func slipRupees(n float64) string {
	cents := int64(math.Round(math.Abs(n) * 100))
	s := fmt.Sprintf("%s.%02d", platformFormatEnIN(float64(cents/100)), cents%100)
	if n < 0 && cents != 0 {
		return "₹-" + s
	}
	return "₹" + s
}

func slipDate(t time.Time) string {
	if t.IsZero() || t.Year() <= 1 {
		return "—"
	}
	return t.Format("02-01-2006")
}

func dash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

// brandColor is the tenant's brand colour when it is a valid #rrggbb value, else the default.
func brandColor(brand string) template.CSS {
	if slipHexColor.MatchString(brand) {
		return template.CSS(brand)
	}
	return "#423591"
}

func slipPhoto(tenantID uint, images []models.OrnamentImage) template.URL {
	if config.Env.UploadsDir ==
		"" || len(images) == 0 {
		return ""
	}
	return uploadDataURL(tenantID, images[0].ImageURL)
}

func pledgeSlipData(ctx context.Context, l *models.Loan) pledgeSlipTemplateData {
	var t *commonModels.Tenant
	if id, ok := config.TenantFromContext(ctx); ok {
		if rec, err := common.FindTenantByID(ctx, id); err == nil {
			t = rec
		}
	}
	legalName, regLabel, phones, address, brand, tenantID := "", "", "", "", "", uint(0)
	if t != nil {
		legalName = firstNonEmpty(t.LegalName, t.Name)
		if t.KMLRegNo != "" {
			regLabel = strings.ToUpper(commonModels.PolicyOrDefault(t.Policy)) + " Reg. No: " + t.KMLRegNo
		}
		phones, address, brand, tenantID = t.ContactPhone, common.NormalizeLineBreaks(t.AddressLine), t.BrandColor, t.ID
	}
	custCode := l.Customer.Code
	if custCode == "" {
		custCode = fmt.Sprintf("%d", l.Customer.ID)
	}
	rows := make([]pledgeSlipOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		rows = append(rows, pledgeSlipOrnament{
			Name: o.Name, Purity: o.Purity, NetWeight: fmt.Sprintf("%.1f", o.NetWeight),
			Quantity: o.Quantity, Value: slipRupees(o.GoldValue), Photo: slipPhoto(tenantID, o.Images),
		})
	}
	var dist []bondDistRow
	for _, d := range bondDisbursements(ctx, l) {
		dist = append(dist, bondDistRow{Date: slipDate(d.Date), Amount: slipRupees(d.Amount), Initial: d.Initial})
	}
	return pledgeSlipTemplateData{
		Brand:      brandColor(brand),
		LegalName:  strings.ToUpper(firstNonEmpty(legalName, "CloudHouse Finance")),
		Descriptor: "Gold Loans & Finance",
		RegLabel:   regLabel, Phones: phones, AddressLine: address,
		LoanNumber: l.LoanNumber, Today: slipDate(time.Now()),
		CustomerName: l.Customer.Name, CustomerCode: custCode,
		Phone: dash(l.Customer.Phone), Address: dash(l.Customer.Address), BranchName: documentBranchName(ctx, l.Branch.Name),
		SchemeName: l.Scheme.Name, SchemeRate: fmt.Sprintf("%v", l.SchemeInterestRate), SchemeLTV: fmt.Sprintf("%v", l.SchemeLTVPercent),
		Opened:         slipDate(l.OpenedDate),
		Ornaments:      rows,
		TotalNetWeight: fmt.Sprintf("%.1f", l.TotalNetWeight), TotalGoldValue: slipRupees(l.TotalGoldValue),
		Principal: slipRupees(l.PrincipalAmount), Eligible: slipRupees(l.EligibleLoanAmount),
		Distribution:    dist,
		LenderSignature: lenderSignature(ctx),
	}
}

func renderPledgeSlipHTML(data pledgeSlipTemplateData) (string, error) {
	var sb strings.Builder
	if err := pledgeSlipTemplate.Execute(&sb, data); err != nil {
		return "", fmt.Errorf("pledge slip: render template: %w", err)
	}
	return sb.String(), nil
}

// pledgeSlipHTML renders the tenant's slip; esign adds the customer's signature box.
func pledgeSlipHTML(ctx context.Context, l *models.Loan, esign bool) (string, error) {
	if t := tenantForContext(ctx); t != nil && commonModels.PolicyOrDefault(t.Policy) == commonModels.PolicyTML {
		return renderTMLSlipHTML(tmlSlipData(ctx, l))
	}
	data := pledgeSlipData(ctx, l)
	data.Esign = esign
	return renderPledgeSlipHTML(data)
}

func renderPledgeSlip(ctx context.Context, loanID uint, branchID *uint, format string) ([]byte, string, string, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, "", "", common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, "", "", common.NewNotFound("loan not found")
	}
	htmlStr, err := pledgeSlipHTML(ctx, l, false)
	if err != nil {
		return nil, "", "", err
	}
	if format == "html" {
		return []byte(htmlStr), "text/html; charset=utf-8", "", nil
	}
	pdfBytes, err := renderA4PDF(htmlStr, "pledge slip")
	if err != nil {
		return nil, "", "", err
	}
	return pdfBytes, "application/pdf", "Pledge-Slip-" + l.LoanNumber + ".pdf", nil
}

func DownloadPledgeSlip(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	body, contentType, filename, err := renderPledgeSlip(auth.RequestContext(c), id, auth.GetBranchScope(c), c.QueryParam("format"))
	if err != nil {
		return common.FailErr(c, err)
	}
	if filename != "" {
		c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	}
	return c.Blob(http.StatusOK, contentType, body)
}

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
	Style                                                                     template.CSS
	LegalName, Descriptor, RegLabel, Phones, AddressLine                      string
	LoanNumber, Today, CustomerName, CustomerCode, Phone, Address, BranchName string
	SchemeName, SchemeRate, SchemeLTV, Opened                                 string
	Ornaments                                                                 []pledgeSlipOrnament
	TotalNetWeight, TotalGoldValue                                            string
	Principal, Eligible                                                       string
	Distribution                                                              []bondDistRow
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

func slipStyle(brand string) string {
	deep, accent, tint := "#423591", "#c9a227", "#efedfb"
	if slipHexColor.MatchString(brand) {
		deep = brand
	}
	return `
body{font-family:'Inter','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;line-height:1.55;font-size:14px;padding:0}
h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:#62626f}
.brandhead{text-align:center;margin:0 0 20px}
.brandhead .bh-name{font-family:'Montserrat','Segoe UI',sans-serif;font-size:17px;font-weight:800;letter-spacing:.06em;color:` + deep + `}
.brandhead .bh-desc{font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:` + deep + `;margin-top:3px}
.brandhead .bh-meta{font-size:10.5px;color:#62626f;margin-top:5px}
.brandhead .bh-rule{height:2px;background:` + accent + `;width:96px;margin:12px auto 14px}
.brandhead h2{margin:0}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #d9d8df;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:` + tint + `;color:` + deep + `;font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}
.orn-photo{width:56px;height:56px;object-fit:cover}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px;break-inside:avoid}
.sig div{flex:1;text-align:center;position:relative}
.sig span{display:block;border-top:1px solid #1a1a1a;padding-top:6px;margin-top:44px;font-size:12.5px}
.muted{color:#62626f;font-size:12.5px}
`
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
		phones, address, brand, tenantID = t.ContactPhone, t.AddressLine, t.BrandColor, t.ID
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
		Style:      template.CSS(slipStyle(brand)),
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
		Distribution: dist,
	}
}

func renderPledgeSlipHTML(data pledgeSlipTemplateData) (string, error) {
	var sb strings.Builder
	if err := pledgeSlipTemplate.Execute(&sb, data); err != nil {
		return "", fmt.Errorf("pledge slip: render template: %w", err)
	}
	return sb.String(), nil
}

func renderPledgeSlip(ctx context.Context, loanID uint, branchID *uint, format string) ([]byte, string, string, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, "", "", common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, "", "", common.NewNotFound("loan not found")
	}
	var htmlStr string
	if t := tenantForContext(ctx); t != nil && commonModels.PolicyOrDefault(t.Policy) == commonModels.PolicyTML {
		htmlStr, err = renderTMLSlipHTML(tmlSlipData(ctx, l))
	} else {
		htmlStr, err = renderPledgeSlipHTML(pledgeSlipData(ctx, l))
	}
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

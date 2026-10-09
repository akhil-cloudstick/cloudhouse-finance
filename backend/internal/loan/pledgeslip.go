package loan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"
)

// The Gold Loan Pledge Slip: the one-page record staff print for a freshly
// pledged loan. Rendered from backend/templates/pledge-slip.html — the same
// design the client-side LoanDetail.tsx builder used to produce inline — so
// the slip is one template, branded per business from the tenant profile.

var pledgeSlipTemplate = mustLoadTemplate("pledge_slip", "pledge-slip.html", template.FuncMap{"inc": func(i int) int { return i + 1 }})

// maxSlipPhotoBytes keeps one oversized ornament photo from bloating the PDF.
const maxSlipPhotoBytes = 3 << 20

var slipHexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type pledgeSlipOrnament struct {
	Name, Purity, NetWeight, Value string
	Quantity                       int
	Photo                          template.URL
}

type pledgeSlipTemplateData struct {
	Style template.CSS

	LegalName, Descriptor, RegLabel, Phones, AddressLine string

	LoanNumber, Today, CustomerName, CustomerCode, Phone, Address, BranchName string
	SchemeName, SchemeRate, SchemeLTV, Opened                                string

	Ornaments                      []pledgeSlipOrnament
	TotalNetWeight, TotalGoldValue string
	Principal, Eligible            string
	Distribution                   []bondDistRow
}

// slipRupees formats like the frontend's fmt(): ₹ with en-IN grouping and
// exactly two decimals.
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

// slipStyle is the page CSS, coloured from the business's brand colour.
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

// slipPhoto inlines an ornament's first photo as a data: URI (headless Chrome
// renders from a data: URL with no session, so it cannot fetch an
// authenticated upload). Empty when there is none or it cannot be read.
func (s *Service) slipPhoto(tenantID uint, images []OrnamentImage) template.URL {
	if s.uploadsDir == "" || len(images) == 0 {
		return ""
	}
	key := strings.TrimPrefix(images[0].ImageURL, "/uploads/")
	b, err := os.ReadFile(upload.ResolvePath(s.uploadsDir, tenantID, key))
	if err != nil || len(b) == 0 || len(b) > maxSlipPhotoBytes {
		return ""
	}
	ct := http.DetectContentType(b)
	if !strings.HasPrefix(ct, "image/") {
		return ""
	}
	return template.URL("data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(b)) //nolint:gosec // sniffed image MIME + base64 only
}

func (s *Service) pledgeSlipData(ctx context.Context, l *Loan) pledgeSlipTemplateData {
	var t *tenant.Tenant
	if s.tenantRepo != nil {
		if id, ok := platform.TenantFromContext(ctx); ok {
			if rec, err := s.tenantRepo.FindByID(ctx, id); err == nil {
				t = rec
			}
		}
	}
	legalName, regLabel, phones, address, brand, tenantID := "", "", "", "", "", uint(0)
	if t != nil {
		legalName = firstNonEmpty(t.LegalName, t.Name)
		if t.KMLRegNo != "" {
			regLabel = strings.ToUpper(t.PolicyOrDefault()) + " Reg. No: " + t.KMLRegNo
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
			Quantity: o.Quantity, Value: slipRupees(o.GoldValue), Photo: s.slipPhoto(tenantID, o.Images),
		})
	}
	var dist []bondDistRow
	for _, d := range s.bondDisbursements(ctx, l) {
		dist = append(dist, bondDistRow{Date: slipDate(d.Date), Amount: slipRupees(d.Amount), Initial: d.Initial})
	}

	return pledgeSlipTemplateData{
		Style:      template.CSS(slipStyle(brand)),
		LegalName:  strings.ToUpper(firstNonEmpty(legalName, "CloudHouse Finance")),
		Descriptor: "Gold Loans & Finance",
		RegLabel:   regLabel, Phones: phones, AddressLine: address,

		LoanNumber: l.LoanNumber, Today: slipDate(time.Now()),
		CustomerName: l.Customer.Name, CustomerCode: custCode,
		Phone: dash(l.Customer.Phone), Address: dash(l.Customer.Address), BranchName: dash(l.Branch.Name),
		SchemeName: l.Scheme.Name, SchemeRate: fmt.Sprintf("%v", l.SchemeInterestRate), SchemeLTV: fmt.Sprintf("%v", l.SchemeLTVPercent),
		Opened: slipDate(l.OpenedDate),

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

// RenderPledgeSlip renders loanID's pledge slip. format "html" returns the
// full HTML document (the combined slip+label print embeds it); anything else
// returns the A4 PDF. Returns the body, its content type and a download
// filename (empty for HTML).
func (s *Service) RenderPledgeSlip(ctx context.Context, loanID uint, branchID *uint, format string) ([]byte, string, string, error) {
	l, err := s.repo.FindByID(ctx, loanID)
	if err != nil {
		return nil, "", "", ErrNotFound
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, "", "", ErrNotFound
	}
	htmlStr, err := renderPledgeSlipHTML(s.pledgeSlipData(ctx, l))
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

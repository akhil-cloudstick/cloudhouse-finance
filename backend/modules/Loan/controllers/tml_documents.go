package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	qrcode "github.com/skip2/go-qrcode"
)

// TML (Tamil Nadu Money Lenders) documents: the pledge-book bond (tml_bond_*.html,
// registered in bondDocs), the gold deposit receipt slip and the payment receipt.

var tmlSlipTemplate = mustLoadTemplate("tml_pledge_slip", "tml_pledge_slip.html", nil)

var tmlStatementTemplate = mustLoadTemplate("tml_statement", "tml_statement.html", nil)

const bondPageStyleTML = `
@page{size:A4;margin:.2in .3in .2in .3in}
*{box-sizing:border-box}
body{margin:0;padding:0;width:100%;font-family:Arial,'Noto Sans Tamil','Nirmala UI',sans-serif;font-size:13px;color:#000;line-height:1.3}
table{border-collapse:collapse}
td,th{overflow-wrap:anywhere}
.serif{font-family:'Times New Roman',Times,serif}
.hdr{position:relative;height:140px;border:3px solid #000;text-align:center;padding:5px 190px 0;overflow:hidden}
.hdr .logo{position:absolute;left:20px;top:22px;width:110px;height:90px;object-fit:contain}
.hdr h1{margin:0;color:var(--brand,#423591);font-family:'Times New Roman',Georgia,serif;font-size:34px;line-height:40px;letter-spacing:2px;text-transform:uppercase}
.hdr b{display:block;font-size:13px;line-height:16px}
.hdr b.ad{font-family:'Times New Roman',serif;font-size:19px;line-height:22px}
.hdr .tag{display:inline-block;width:162px;height:26px;line-height:24px;border:1px solid #000;margin-top:3px;font-family:'Times New Roman',serif;font-size:19px}
.hdr .by{position:absolute;right:12px;top:62px;width:168px}
.hdr .by span{display:block;text-align:center;font-family:'Times New Roman',serif;font-size:15px;margin-bottom:5px}
.hdr .by div{height:41px;line-height:39px;border:1px solid #000;padding:0 9px;font-size:15px;white-space:nowrap}
.top{display:flex;margin-top:10px;min-height:142px;align-items:flex-start}
.cust{width:213px;height:142px;table-layout:fixed}
.cust td{border:2px solid #000;padding:2px 7px;font-weight:700;font-size:13px;vertical-align:top}
.cust tr:first-child td,.cust tr:last-child td{height:25px;vertical-align:middle}
.cust td:first-child{width:84px;white-space:nowrap;font-size:12.5px}
.pbox{margin-left:9px;width:281px;height:142px;position:relative}
.pbox .lbl{position:absolute;top:0;width:134px;text-align:center;font-family:'Times New Roman',serif;font-weight:700;font-size:14px;text-decoration:underline}
.pbox .frame{position:absolute;left:0;right:0;bottom:0;height:120px;border:1px solid #000}
.photo{position:absolute;top:3px;width:134px;height:112px;display:flex;align-items:center;justify-content:center;text-align:center;color:#888;font-size:11px;overflow:hidden}
.photo img{width:100%;height:100%;object-fit:cover}
.p1{left:3px}
.p2{left:144px}
.loan{margin-left:13px;width:210px;height:116px;table-layout:fixed}
.loan td{border:1px solid #000;padding:2px 6px;font-family:'Times New Roman',serif;font-size:13px;line-height:14px}
.loan td:first-child{width:66px}
.loan td:last-child{font-family:Arial,sans-serif;font-weight:700;font-size:13px}
/* The declaration, amount in words and signature box stack in flow (the box sits
 * right under the words, leaving the rest of the block free for signing), so a
 * long name or a two-line amount moves the box down instead of running under
 * it. Left-aligned: justifying long Tamil words in this column left wide gaps
 * between them. */
.mid{display:flex;margin-top:12px;min-height:262px;align-items:stretch}
.decl{display:flex;flex-direction:column;width:418px;line-height:21px;font-size:12.5px;text-align:left;overflow-wrap:anywhere}
.decl .tx{margin:0;word-spacing:4px}
.decl .words{margin:6px 0 4px;font-family:'Times New Roman',serif;font-size:14px;line-height:18px}
.sig{margin-top:4px;width:229px;height:38px;flex-shrink:0;border:1px solid #000;padding:0 8px;display:flex;align-items:center;font-family:'Times New Roman',serif;font-size:15px;line-height:17px}
.esign-slot{display:inline-block;width:150px}
.right{margin-left:16px;width:302px}
.items{width:100%;table-layout:fixed;font-size:13px}
.items th,.items td{border:1px solid #000;padding:3px 6px;text-align:left}
.items th{font-family:'Times New Roman',serif;font-size:14px;line-height:15px}
.items.main{border:2px solid #000;border-bottom:0}
.items.main tr.pad td{height:28px;border-top:0;border-bottom:0}
.items.main td:last-child,.items.main th:last-child,.items.tot td,.items.tot th{text-align:center}
.items.tot{border:2px solid #000;margin-top:0}
.items.tot th{font-size:13px;height:19px;padding:1px 6px}
.items.tot td{font-family:Arial,sans-serif;font-weight:700;font-size:14px;height:33px}
.pay{display:grid;grid-template-columns:213px 230px 1fr auto;border-bottom:1.5px solid #000;margin-top:30px;padding:0 40px 3px 4px;font-family:'Times New Roman',serif;font-size:14px;line-height:16px}
.pay span:last-child{text-align:right}
.recv{margin:6px 0 0;font-size:12.5px;line-height:21px;word-spacing:2px;overflow-wrap:anywhere}
.foot{display:flex;margin-top:12px;padding-left:28px;font-size:14px;line-height:18px}
.foot span:nth-child(1){width:264px}
.foot span:nth-child(2){width:219px}
.cut{border-top:1.5px dashed #000;margin:4px 0 6px}
.rcpt{display:flex;height:352px;break-inside:avoid;page-break-inside:avoid}
.rcpt .l{position:relative;margin-left:16px;width:454px;height:352px;border:1px solid #000;overflow:hidden}
.rcpt .l .lg{position:absolute;left:12px;top:24px;width:80px;height:60px;object-fit:contain}
.rcpt .l .hd{position:absolute;left:0;right:0;top:4px;text-align:center;line-height:15px}
.rcpt h2{margin:0;color:var(--brand,#423591);font-family:'Times New Roman',Georgia,serif;font-size:27px;line-height:29px;letter-spacing:1px;text-transform:uppercase}
.rcpt .hd .ad{font-family:'Times New Roman',serif;font-size:15px;font-weight:700;line-height:16px}
.rcpt .hd .ct{font-size:11.5px;font-weight:700;line-height:14px}
.rcpt .hd .gl{font-family:'Times New Roman',serif;font-size:14px;font-weight:700;line-height:17px}
.rcpt .l .rule{position:absolute;left:6px;right:6px;top:100px;border-top:1px solid #000}
/* Body band between the header rule and the terms (106px–278px): the table's
 * fixed height spreads its six rows evenly over it. Labels hold one line in a
 * fixed column; a long value (the customer name) wraps under itself, after the
 * colon, and takes its extra line from the spare row height. */
.rg{position:absolute;left:5px;top:106px;width:206px;height:172px;font-size:13px;table-layout:fixed}
.rg td{padding:0 4px 0 0;font-family:'Times New Roman',serif;font-size:13px;line-height:15px;vertical-align:middle}
.rg td:first-child{width:68px;white-space:nowrap}
.rg td+td{font-weight:700;padding-left:18px;text-indent:-8px;overflow-wrap:anywhere}
.rg tr:first-child td+td{white-space:nowrap}
.orn{position:absolute;left:214px;top:106px;width:124px;font-family:'Times New Roman',serif;font-size:14px;line-height:19px}
.orn u{font-weight:700;white-space:nowrap}
.orn .oi{display:block;white-space:nowrap}
/* Jewel photo at the top of the band, the authorised signature at its foot. */
.jw{position:absolute;left:335px;top:106px;width:112px;height:172px;display:flex;flex-direction:column;align-items:center;text-align:center;font-family:'Times New Roman',serif;font-size:14px;line-height:17px}
.jw u{font-weight:700}
.sm{width:92px;height:64px;margin:4px auto 0;border:1px solid #000;font-size:10px;color:#888;display:flex;align-items:center;justify-content:center;overflow:hidden}
.sm img{width:100%;height:100%;object-fit:cover}
.jw .ls{margin-top:auto;height:24px;display:flex;align-items:flex-end;justify-content:center}
.jw .ls .sig-img{max-height:20px;max-width:90px;display:block}
.jw small{display:block;font-size:11px;line-height:13px;white-space:nowrap}
.terms{position:absolute;left:6px;right:6px;bottom:4px;text-align:center;font-family:'Times New Roman','Noto Sans Tamil',serif;font-size:10.5px;line-height:14px;border-top:1px solid #000;padding-top:3px}
.terms div{white-space:nowrap;overflow:hidden}
html[lang=ta] .terms{font-size:9.4px}
.rcpt .r{margin-left:24px;border-left:1.5px dashed #999;padding:30px 0 0 16px;flex:1;font-size:14px;line-height:22px;overflow:hidden}
.rcpt .r h3{margin:0 0 4px;font-size:17px;line-height:22px}
/* Package Details: same label / value columns as the receipt, so a wrapped
 * name continues under itself instead of under the labels. */
.pk td{padding:0;font-size:14px;line-height:22px;vertical-align:top}
.pk td:first-child{width:76px;font-weight:700;white-space:nowrap}
.pk td+td{padding-left:8px;text-indent:-8px;overflow-wrap:anywhere}
.pk tr:last-child td{font-weight:700}
.pqr{margin-top:8px;text-align:center;font-size:11px;line-height:13px;width:130px}
.pqr img{display:block;width:118px;height:118px;margin:0 auto 2px}
`

const tmlSlipStyle = `
@page{size:A4}
body{margin:0;padding:0;font-family:Arial,Helvetica,'Noto Sans Tamil','Nirmala UI',sans-serif;font-size:11px;color:#111}
*{box-sizing:border-box}
.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.brandbox{display:flex;align-items:center;gap:10px}
.blogo{width:56px;height:56px;object-fit:contain}
.brand{font-size:24px;font-weight:900;letter-spacing:1px;text-transform:uppercase}
.branch{font-weight:700;text-align:right;font-size:12px}
.doc{border:1.5px solid #000}
.doc .t{border-bottom:1px solid #000;padding:4px 8px;font-weight:700;display:flex;justify-content:space-between}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #000;padding:4px 6px;vertical-align:top;text-align:left}
.lbl{font-weight:700;width:18%}
.big{font-weight:700;font-size:12px}
.ph{width:110px;height:110px;border:1px solid #000;color:#888;display:flex;align-items:center;justify-content:center;font-size:10px;text-align:center;overflow:hidden}
.ph img{width:100%;height:100%;object-fit:cover}
.part{display:flex;border:1px solid #000;border-top:1px solid #000}
.part>div{padding:6px 8px}
.sigs{display:flex;justify-content:space-between;align-items:flex-end;margin-top:34px;font-weight:700}
.sigs .mgr{text-align:center}
.sigs .mgr .sig-img{max-height:40px;max-width:150px;display:block;margin:0 auto 2px}
`

const tmlStatementStyle = `
@page{size:A4}
body{margin:0;padding:0;font-family:"Courier New",Courier,monospace;font-size:13px}
.c{text-align:center}
.rule{border-top:1px solid #000;margin:6px 0}
.two{display:flex;justify-content:space-between;margin:10px 0 0}
.two .r{width:48%}
.two .r div{display:flex;gap:6px}
.two .r div span:first-child{width:62px}
.cl{text-align:center;margin:2px 0 0;padding-left:34%}
table{width:100%;border-collapse:collapse;margin-top:2px}
th{text-align:left;border-top:1px solid #000;border-bottom:1px solid #000;padding:3px 4px}
th:last-child,td:last-child{text-align:right;border-left:1px solid #000;width:36%;padding-right:4px}
td{padding:1px 4px;vertical-align:top;height:18px}
tr.t td{border-top:1px solid #000;border-bottom:1px solid #000;font-weight:700;height:22px}
.words{font-size:10.5px;margin-top:3px}
.fr{text-align:right;font-weight:700;margin-top:14px}
.ft{display:flex;justify-content:space-between;margin-top:30px}
`

const maxTMLPhotoBytes = 3 << 20

// uploadDataURL inlines a stored upload ("/uploads/<key>") as a data: URL so the
// headless-Chrome render needs no network or auth. Empty when missing or too big.
func uploadDataURL(tenantID uint, url string) template.URL {
	if config.Env.UploadsDir == "" || strings.TrimSpace(url) == "" {
		return ""
	}
	key := strings.TrimPrefix(url, "/uploads/")
	b, err := os.ReadFile(common.ResolvePath(config.Env.UploadsDir, tenantID, key))
	if err != nil || len(b) == 0 || len(b) > maxTMLPhotoBytes {
		return ""
	}
	ct := http.DetectContentType(b)
	if !strings.HasPrefix(ct, "image/") {
		return ""
	}
	return template.URL("data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(b)) //nolint:gosec // sniffed image MIME + base64 only
}

func tenantForContext(ctx context.Context) *commonModels.Tenant {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return nil
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil
	}
	return t
}

// tmlBondExtras returns the lender phones and the customer/overall photos used only by
// the TML pledge-book sheet. Photos are skipped for other policies to avoid the file reads.
func tmlBondExtras(ctx context.Context, l *models.Loan, policy string) (phones string, customerPhoto, overallPhoto, logo template.URL) {
	if commonModels.PolicyOrDefault(policy) != commonModels.PolicyTML {
		return "", "", "", ""
	}
	t := tenantForContext(ctx)
	if t == nil {
		return "", "", "", ""
	}
	return t.ContactPhone, uploadDataURL(t.ID, l.Customer.PhotoURL), uploadDataURL(t.ID, l.OverallPhotoURL), uploadDataURL(t.ID, t.LogoStorageKey)
}

type tmlSlipSlab struct{ Within, Rebate, Rate string }

type tmlSlipTemplateData struct {
	Style                                            template.CSS
	LegalName, Place, Phones, RegLabel, RegNo        string
	PrintTime                                        string
	LoanNumber, LoanDate, CustomerName, CustomerCode string
	Address, SchemeName, Amount, Tenure, DueDate     string
	InterestRate, MinimumDaysNote                    string
	Slabs                                            []tmlSlipSlab
	CustomerPhoto, OverallPhoto                      template.URL
	Particulars, TotalWeight, StoneWeight, NetWeight string
	Logo, QR                                         template.URL
	InterestDue, InterestDueNote                     string
	LenderSignature                                  template.HTML
}

func tmlSlabs(tiers []commonModels.RateTier, baseRate float64) []tmlSlipSlab {
	if len(tiers) == 0 {
		return []tmlSlipSlab{{Within: "Throughout the loan", Rebate: "0.00%", Rate: fmt.Sprintf("%v%% per annum", baseRate)}}
	}
	out := make([]tmlSlipSlab, 0, len(tiers))
	prev := 0
	for _, t := range tiers {
		var within string
		switch {
		case t.Days <= 0:
			within = fmt.Sprintf("Above %d Days", prev)
		case prev == 0:
			within = fmt.Sprintf("Upto %d Days", t.Days)
		default:
			within = fmt.Sprintf("%d - %d Days", prev+1, t.Days)
		}
		out = append(out, tmlSlipSlab{Within: within, Rebate: fmt.Sprintf("%.2f%%", math.Max(baseRate-t.Rate, 0)), Rate: fmt.Sprintf("%v%% per annum", t.Rate)})
		if t.Days > 0 {
			prev = t.Days
		}
	}
	return out
}

func tmlSlipData(ctx context.Context, l *models.Loan) tmlSlipTemplateData {
	t := tenantForContext(ctx)
	var tenantID uint
	legalName, phones, regNo := "", "", ""
	if t != nil {
		tenantID = t.ID
		legalName, phones, regNo = firstNonEmpty(t.LegalName, t.Name), t.ContactPhone, t.KMLRegNo
	}
	logo := template.URL("")
	if t != nil {
		logo = uploadDataURL(t.ID, t.LogoStorageKey)
	}
	interestDue := tmlInterestDue(l)
	custCode := l.Customer.Code
	if custCode == "" {
		custCode = fmt.Sprintf("%d", l.Customer.ID)
	}
	parts := make([]string, 0, len(l.Ornaments))
	var gross, stone, net float64
	for _, o := range l.Ornaments {
		if o.ReleasedAt != nil {
			continue
		}
		parts = append(parts, fmt.Sprintf("%d %s - Net wt=%sgm (Approx.)", max(o.Quantity, 1), o.Name, fmtWeight(o.NetWeight)))
		gross += o.GrossWeight
		net += o.NetWeight
		stone += o.DeductionWeight
	}
	note := ""
	if l.SchemeMinimumDays > 0 {
		note = fmt.Sprintf("Interest will be charged for a minimum of %d days, even if the loan is repaid earlier.", l.SchemeMinimumDays)
	}
	return tmlSlipTemplateData{
		Style:     template.CSS(tmlSlipStyle),
		LegalName: legalName, Place: documentBranchName(ctx, l.Branch.Name), Phones: phones, RegNo: regNo,
		PrintTime:  time.Now().Format("02/01/2006 15:04:05"),
		LoanNumber: l.LoanNumber, LoanDate: l.OpenedDate.Format("02/01/2006"),
		CustomerName: l.Customer.Name, CustomerCode: custCode, Address: dash(l.Customer.Address),
		SchemeName: l.Scheme.Name, Amount: fmt.Sprintf("%.0f", l.PrincipalAmount),
		Tenure:       fmt.Sprintf("%d months", l.SchemeDurationMonths),
		DueDate:      l.DueDate.Format("02/01/2006"),
		InterestRate: fmt.Sprintf("%v", l.SchemeInterestRate), MinimumDaysNote: note,
		Slabs: tmlSlabs(l.SchemeRateTiers, l.SchemeInterestRate),
		Logo:  logo, QR: qrDataURL(l.LoanNumber),
		InterestDue: interestDue.Format("02/01/2006"), InterestDueNote: fmt.Sprintf("every 90 days from pledge date or last interest paid date, whichever is later but not exceeding Principal Due Date %s", l.DueDate.Format("02/01/2006")),
		CustomerPhoto: uploadDataURL(tenantID, l.Customer.PhotoURL), OverallPhoto: uploadDataURL(tenantID, l.OverallPhotoURL),
		Particulars: strings.Join(parts, ", "),
		TotalWeight: fmtWeight(gross), StoneWeight: fmtWeight(stone), NetWeight: fmtWeight(net),
		LenderSignature: lenderSignature(ctx),
	}
}

func renderTMLSlipHTML(data tmlSlipTemplateData) (string, error) {
	var sb strings.Builder
	if err := tmlSlipTemplate.Execute(&sb, data); err != nil {
		return "", fmt.Errorf("tml slip: render template: %w", err)
	}
	return sb.String(), nil
}

type tmlStatementTemplateData struct {
	Style                                      template.CSS
	LegalName, Place, Contact                  string
	CustomerName                               string
	AddressLines                               []string
	AccountNo, ReceiptNo, Date, Status         string
	Principal, Interest, Charges, Total, Words string
	HasInterestRange                           bool
	From, To                                   string
	Days                                       int
	PrintTime                                  string
}

func addressLines(addr string) []string {
	var out []string
	for _, line := range strings.FieldsFunc(addr, func(r rune) bool { return r == '\n' || r == ',' }) {
		if s := strings.TrimSpace(line); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func tmlStatementData(ctx context.Context, l *models.Loan, paymentID uint) (tmlStatementTemplateData, error) {
	pays := append([]models.LoanPayment(nil), l.Payments...)
	sort.SliceStable(pays, func(i, j int) bool {
		if pays[i].PaidOn.Equal(pays[j].PaidOn) {
			return pays[i].ID < pays[j].ID
		}
		return pays[i].PaidOn.Before(pays[j].PaidOn)
	})
	if paymentID == 0 && len(pays) == 0 {
		// No payment yet: print the opening receipt — the loan principal on the loan date.
		pays = []models.LoanPayment{{PaidOn: l.OpenedDate, Amount: l.PrincipalAmount, PrincipalApplied: l.PrincipalAmount}}
	}
	idx := len(pays) - 1
	if paymentID != 0 {
		idx = -1
		for i, p := range pays {
			if p.ID == paymentID {
				idx = i
			}
		}
	}
	if idx < 0 {
		return tmlStatementTemplateData{}, common.NewNotFound("payment not found for this loan")
	}
	p := pays[idx]
	from := l.OpenedDate
	if idx > 0 {
		from = pays[idx-1].PaidOn
	}
	days := int(p.PaidOn.Sub(from).Hours() / 24)
	if days < 0 {
		days = 0
	}
	status := ""
	if l.Status == models.StatusClosed {
		status = "A/c Closed"
	}
	t := tenantForContext(ctx)
	legalName, contact := "", ""
	if t != nil {
		legalName, contact = firstNonEmpty(t.LegalName, t.Name), t.ContactPhone
	}
	return tmlStatementTemplateData{
		Style: template.CSS(tmlStatementStyle), LegalName: legalName, Place: documentBranchName(ctx, l.Branch.Name), Contact: contact,
		CustomerName: l.Customer.Name, AddressLines: addressLines(l.Customer.Address),
		AccountNo: l.LoanNumber, ReceiptNo: strconv.FormatUint(uint64(p.ID), 10), Date: p.PaidOn.Format("02/01/2006"), Status: status,
		Principal: money(p.PrincipalApplied), Interest: money(p.InterestApplied),
		Charges: money(p.PenalInterestApplied + p.ProcessingFeeApplied), Total: money(p.Amount),
		Words:            "(Rupees " + amountInWords(p.Amount) + " Only)",
		HasInterestRange: p.InterestApplied > 0, From: from.Format("02/01/06"), To: p.PaidOn.Format("02/01/06"), Days: days,
		PrintTime: time.Now().Format("03:04 PM"),
	}, nil
}

func renderTMLStatement(ctx context.Context, loanID uint, branchID *uint, paymentID uint, format string) ([]byte, string, string, error) {
	l, err := GetLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, "", "", err
	}
	if t := tenantForContext(ctx); t == nil || commonModels.PolicyOrDefault(t.Policy) != commonModels.PolicyTML {
		return nil, "", "", common.NewBadRequest("the payment receipt is only available for TML businesses")
	}
	data, err := tmlStatementData(ctx, l, paymentID)
	if err != nil {
		return nil, "", "", err
	}
	var sb strings.Builder
	if err := tmlStatementTemplate.Execute(&sb, data); err != nil {
		return nil, "", "", fmt.Errorf("tml statement: render template: %w", err)
	}
	if format == "html" {
		return []byte(sb.String()), "text/html; charset=utf-8", "", nil
	}
	pdfBytes, err := renderA4PDF(sb.String(), "tml statement")
	if err != nil {
		return nil, "", "", err
	}
	return pdfBytes, "application/pdf", "Receipt-" + l.LoanNumber + ".pdf", nil
}

// DownloadTMLStatementReceipt serves the TML payment receipt for a loan's latest
// payment, or the one named by ?payment_id=. ?format=html returns the raw HTML.
func DownloadTMLStatementReceipt(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var paymentID uint
	if raw := c.QueryParam("payment_id"); raw != "" {
		n, perr := strconv.ParseUint(raw, 10, 64)
		if perr != nil {
			return common.FailErr(c, common.NewBadRequest("payment_id must be a number"))
		}
		paymentID = uint(n)
	}
	body, contentType, filename, err := renderTMLStatement(auth.RequestContext(c), id, auth.GetBranchScope(c), paymentID, c.QueryParam("format"))
	if err != nil {
		return common.FailErr(c, err)
	}
	if filename != "" {
		c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	}
	return c.Blob(http.StatusOK, contentType, body)
}

// tmlInterestDue is 90 days after the later of the loan date and the last interest
// payment, never past the principal due date.
func tmlInterestDue(l *models.Loan) time.Time {
	from := l.OpenedDate
	for _, p := range l.Payments {
		if p.InterestApplied > 0 && p.PaidOn.After(from) {
			from = p.PaidOn
		}
	}
	due := from.AddDate(0, 0, 90)
	if !l.DueDate.IsZero() && due.After(l.DueDate) {
		return l.DueDate
	}
	return due
}

// qrDataURL encodes text as a QR code PNG data: URL; empty on failure.
func qrDataURL(text string) template.URL {
	png, err := qrcode.Encode(text, qrcode.Medium, 256)
	if err != nil {
		return ""
	}
	return template.URL("data:image/png;base64," + base64.StdEncoding.EncodeToString(png)) //nolint:gosec // generated PNG + base64 only
}

// tenantBrand is the tenant's brand colour ("" when unset), used for headings on the TML bond.
func tenantBrand(ctx context.Context) string {
	if t := tenantForContext(ctx); t != nil {
		return t.BrandColor
	}
	return ""
}

// tmlZoomCSS adapts the TML sheet to many items without shrinking its width:
// table rows and the gaps between blocks tighten as items are added, the
// receipt's ornament list gets smaller (two columns past 12) so it never runs
// into the terms box, and only a very long list also scales the sheet down.
func tmlZoomCSS(items int, policy string) string {
	if commonModels.PolicyOrDefault(policy) != commonModels.PolicyTML {
		return ""
	}
	css := ""
	if items > 5 {
		css += "\n.items.main td,.items.main th{padding-top:1px;padding-bottom:1px}.items.main td{font-size:12.5px;line-height:16px}.mid{margin-top:12px}.pay{margin-top:18px}.recv{margin-top:6px}.foot{margin-top:10px}.cut{margin:4px 0 5px}"
	}
	switch {
	case items <= 7:
	case items <= 10:
		css += "\n.orn{font-size:11.5px;line-height:14px}.orn u{font-size:13px}"
	case items <= 12:
		css += "\n.orn{left:210px;width:124px;font-size:10px;line-height:12.5px}.orn u{font-size:12px}"
	default:
		css += "\n.orn{left:210px;width:122px;font-size:9px;line-height:11.5px;column-count:2;column-gap:4px}.orn u{font-size:11px;display:block;column-span:all}.orn .oi{break-inside:avoid}"
	}
	if items >= tmlZoomFrom {
		z := max(0.85, 1-0.02*float64(items-tmlZoomFrom+1))
		css += fmt.Sprintf("\nbody{zoom:%.2f}", z)
	}
	return css
}

// tmlZoomFrom is the item count from which the whole sheet is scaled down.
const tmlZoomFrom = 11

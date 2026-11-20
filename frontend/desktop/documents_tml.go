package main

// Offline Tamil Nadu (TML) documents: the pledge slip (gold deposit receipt) and the payment receipt. Port of
// backend/modules/Loan/controllers/tml_documents.go (tmlSlipData, tmlStatementData): keep in step with it.
// Left blank offline: the business logo, the customer / ornaments photos and the branch manager's signature
// (the page does not hold those images). The QR code is made here.

import (
	"fmt"
	"html/template"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

type docRateTier struct {
	Days int     `json:"days"`
	Rate float64 `json:"rate"`
}

const docTmlSlipStyle = `
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

const docTmlStatementStyle = `
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

type docTmlSlab struct{ Within, Rebate, Rate string }

type docTmlSlipData struct {
	Style                                            template.CSS
	LegalName, Place, Phones, RegLabel, RegNo        string
	PrintTime                                        string
	LoanNumber, LoanDate, CustomerName, CustomerCode string
	Address, SchemeName, Amount, Tenure, DueDate     string
	InterestRate, MinimumDaysNote                    string
	Slabs                                            []docTmlSlab
	CustomerPhoto, OverallPhoto                      template.URL
	Particulars, TotalWeight, StoneWeight, NetWeight string
	Logo, QR                                         template.URL
	InterestDue, InterestDueNote                     string
	LenderSignature                                  template.HTML
}

func docTmlSlabs(tiers []docRateTier, baseRate float64) []docTmlSlab {
	if len(tiers) == 0 {
		return []docTmlSlab{{Within: "Throughout the loan", Rebate: "0.00%", Rate: fmt.Sprintf("%v%% per annum", baseRate)}}
	}
	out := make([]docTmlSlab, 0, len(tiers))
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
		out = append(out, docTmlSlab{Within: within, Rebate: fmt.Sprintf("%.2f%%", math.Max(baseRate-t.Rate, 0)), Rate: fmt.Sprintf("%v%% per annum", t.Rate)})
		if t.Days > 0 {
			prev = t.Days
		}
	}
	return out
}

// docTmlInterestDue: 90 days after the later of the loan date and the last interest payment, never past the due date.
func docTmlInterestDue(l docLoan) time.Time {
	from := docTime(l.OpenedDate)
	for _, p := range l.Payments {
		if t := docTime(p.PaidOn); p.InterestApplied > 0 && t.After(from) {
			from = t
		}
	}
	due := from.AddDate(0, 0, 90)
	if d := docTime(l.DueDate); !d.IsZero() && due.After(d) {
		return d
	}
	return due
}

func docTmlDate(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("02/01/2006")
}

func docTMLSlip(in docInput) (string, error) {
	tmpl, err := docTemplate("tml_pledge_slip.html")
	if err != nil {
		return "", err
	}
	l, p := in.Loan, in.Profile
	custCode := l.Customer.Code
	if custCode == "" {
		custCode = fmt.Sprintf("%d", l.Customer.ID)
	}
	var parts []string
	var gross, stone, net float64
	for _, o := range l.Ornaments {
		if o.ReleasedAt != nil && *o.ReleasedAt != "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("%d %s - Net wt=%sgm", max(o.Quantity, 1), o.Name, docWeight(o.NetWeight)))
		gross += o.GrossWeight
		net += o.NetWeight
		stone += o.DeductionWeight
	}
	note := ""
	if l.SchemeMinimumDays > 0 {
		note = fmt.Sprintf("Interest will be charged for a minimum of %d days, even if the loan is repaid earlier.", l.SchemeMinimumDays)
	}
	due := docTime(l.DueDate)
	place := ""
	if !in.SingleBranch {
		place = l.Branch.Name
	}
	d := docTmlSlipData{
		Style:     template.CSS(docTmlSlipStyle),
		LegalName: docFirst(p.LegalName, p.Name), Place: place, Phones: p.ContactPhone, RegNo: p.KMLRegNo,
		PrintTime:  time.Now().Format("02/01/2006 15:04:05"),
		LoanNumber: l.LoanNumber, LoanDate: docTmlDate(docTime(l.OpenedDate)),
		CustomerName: l.Customer.Name, CustomerCode: custCode, Address: docDash(l.Customer.Address),
		SchemeName: l.Scheme.Name, Amount: fmt.Sprintf("%.0f", l.PrincipalAmount),
		Tenure: fmt.Sprintf("%d months", l.SchemeDurationMonths), DueDate: docTmlDate(due),
		InterestRate: fmt.Sprintf("%v", l.SchemeInterestRate), MinimumDaysNote: note,
		Slabs:           docTmlSlabs(l.SchemeRateTiers, l.SchemeInterestRate),
		QR:              docQR(l.LoanNumber),
		InterestDue:     docTmlDate(docTmlInterestDue(l)),
		InterestDueNote: fmt.Sprintf("every 90 days from pledge date or last interest paid date, whichever is later but not exceeding Principal Due Date %s", docTmlDate(due)),
		Particulars:     strings.Join(parts, ", "),
		TotalWeight:     docWeight(gross), StoneWeight: docWeight(stone), NetWeight: docWeight(net),
	}
	return docRun(tmpl, d, "tml slip")
}

type docTmlStmtData struct {
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

func docAddressLines(addr string) []string {
	var out []string
	for _, line := range strings.FieldsFunc(addr, func(r rune) bool { return r == '\n' || r == ',' }) {
		if s := strings.TrimSpace(line); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func docTMLStatement(in docInput) (string, error) {
	tmpl, err := docTemplate("tml_statement.html")
	if err != nil {
		return "", err
	}
	l, p := in.Loan, in.Profile
	pays := append([]docPayment(nil), l.Payments...)
	sort.SliceStable(pays, func(i, j int) bool {
		ti, tj := docTime(pays[i].PaidOn), docTime(pays[j].PaidOn)
		if ti.Equal(tj) {
			return pays[i].ID < pays[j].ID
		}
		return ti.Before(tj)
	})
	if len(pays) == 0 {
		pays = []docPayment{{PaidOn: l.OpenedDate, Amount: l.PrincipalAmount, PrincipalApplied: l.PrincipalAmount}}
	}
	idx := len(pays) - 1
	pay := pays[idx]
	paidOn := docTime(pay.PaidOn)
	from := docTime(l.OpenedDate)
	if idx > 0 {
		from = docTime(pays[idx-1].PaidOn)
	}
	days := int(paidOn.Sub(from).Hours() / 24)
	if days < 0 {
		days = 0
	}
	status := ""
	if strings.EqualFold(l.Status, "Closed") {
		status = "A/c Closed"
	}
	place := ""
	if !in.SingleBranch {
		place = l.Branch.Name
	}
	receiptNo := ""
	if pay.ID != 0 {
		receiptNo = strconv.Itoa(pay.ID)
	}
	d := docTmlStmtData{
		Style: template.CSS(docTmlStatementStyle), LegalName: docFirst(p.LegalName, p.Name), Place: place, Contact: p.ContactPhone,
		CustomerName: l.Customer.Name, AddressLines: docAddressLines(l.Customer.Address),
		AccountNo: l.LoanNumber, ReceiptNo: receiptNo, Date: docTmlDate(paidOn), Status: status,
		Principal: docMoney(pay.PrincipalApplied), Interest: docMoney(pay.InterestApplied),
		Charges: docMoney(pay.PenalInterestApplied + pay.ProcessingFeeApplied), Total: docMoney(pay.Amount),
		Words:            "(Rupees " + docWords(pay.Amount) + " Only)",
		HasInterestRange: pay.InterestApplied > 0, From: from.Format("02/01/06"), To: paidOn.Format("02/01/06"), Days: days,
		PrintTime: time.Now().Format("03:04 PM"),
	}
	return docRun(tmpl, d, "tml statement")
}

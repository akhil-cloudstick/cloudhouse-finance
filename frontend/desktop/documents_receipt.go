package main

// Offline partial release receipt. Follows backend/modules/Loan/controllers/partial_release_receipt.go.

import (
	"fmt"
	"html/template"
	"time"
)

// docReceipt is what the page knows about the release request: the ornaments it released, what was settled and when.
type docReceipt struct {
	SettlementAmount float64 `json:"settlementAmount"`
	OrnamentIDs      []int   `json:"ornamentIds"`
	ReleaseDate      string  `json:"releaseDate"`
}

type docReceiptData struct {
	LoanNumber, BranchName, CustomerName, CustomerAddress string
	LenderSignature                                       template.HTML
	Style                                                 template.CSS
	LenderName, LenderAddress                             string
	ReleaseDate, SettlementAmount                         string
	RevisedPrincipalBalance, RevisedTotalGoldValue        string
	RevisedLTVRatio                                       string
	ReleasedOrnaments, StillPledgedOrnaments              []docRelOrnament
}

func docReceiptRows(list []docOrnament) []docRelOrnament {
	rows := make([]docRelOrnament, 0, len(list))
	for _, o := range list {
		rows = append(rows, docRelOrnament{Name: o.Name, Quantity: o.Quantity, GrossWeight: o.GrossWeight, NetWeight: o.NetWeight, FineWeight: docFineWeight(o.NetWeight, o.Purity), Value: docRelAmount(o.GoldValue)})
	}
	return rows
}

func docPartialReceipt(in docInput, lang string) (string, error) {
	file := "partial_release_receipt.html"
	if lang == "ml" {
		file = "partial_release_receipt_malayalam.html"
	} else {
		lang = "en"
	}
	tmpl, err := docTemplate(file)
	if err != nil {
		return "", err
	}
	l, p, r := in.Loan, in.Profile, in.Receipt
	selected := map[int]bool{}
	for _, id := range r.OrnamentIDs {
		selected[id] = true
	}
	var released, still []docOrnament
	for _, o := range l.Ornaments {
		switch {
		case selected[o.ID] && o.ReleasedAt != nil && *o.ReleasedAt != "":
			released = append(released, o)
		case o.ReleasedAt == nil || *o.ReleasedAt == "":
			still = append(still, o)
		}
	}
	ltv := 0.0
	if l.EligibleLoanAmount > 0 && l.SchemeLtvPercent > 0 && l.TotalGoldValue > 0 {
		ltv = (l.PrincipalAmount / l.TotalGoldValue) * 100
	}
	releaseDate := docTime(r.ReleaseDate)
	if releaseDate.IsZero() {
		releaseDate = time.Now()
	}
	branch := ""
	if !in.SingleBranch {
		branch = docDash(l.Branch.Name)
	}
	addr := docNormalizeBreaks(p.AddressLine)
	if addr == "" {
		addr = docBlank
	}
	d := docReceiptData{
		LoanNumber: l.LoanNumber, BranchName: branch, CustomerName: l.Customer.Name, CustomerAddress: l.Customer.Address,
		Style:      template.CSS(docReleaseStyle(lang)),
		LenderName: docFirst(p.LegalName, "CHITTILAPILLY THOMMANA FINANCIERS AND INVESTMENTS"), LenderAddress: addr,
		ReleaseDate: docRelDate(releaseDate, lang), SettlementAmount: docRelAmount(r.SettlementAmount),
		RevisedPrincipalBalance: docRelAmount(l.PrincipalAmount), RevisedTotalGoldValue: docRelAmount(l.TotalGoldValue),
		RevisedLTVRatio: fmt.Sprintf("%.2f%%", ltv), ReleasedOrnaments: docReceiptRows(released), StillPledgedOrnaments: docReceiptRows(still),
	}
	return docRun(tmpl, d, "partial release receipt")
}

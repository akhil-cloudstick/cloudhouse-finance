package loan

import (
	"context"
	"fmt"
	"html/template"
	"strings"
	"time"

)

// PartialReleaseReceiptOrnament is one row of the receipt's ornament tables
// (both "released this transaction" and "still pledged" reuse this same
// shape).
type PartialReleaseReceiptOrnament struct {
	Name        string
	Purity      string
	Quantity    int
	GrossWeight float64
	NetWeight   float64
	Value       float64
}

// PartialReleaseReceiptData carries everything the Partial Release Receipt
// template needs. Deliberately a SEPARATE type from ReleaseAgreementData
// (rather than reusing it with extra optional fields) — this is a new,
// parallel document, not a conditional branch bolted onto FORM 7; the full
// release agreement stays completely unchanged for full releases (see
// releaseAgreementDataForLoan's own doc comment on why it reads full
// ornament history, which this document deliberately does NOT).
type PartialReleaseReceiptData struct {
	LoanNumber      string
	BranchName      string
	CustomerName    string
	CustomerAddress string

	ReleaseDate      time.Time
	SettlementAmount float64

	// ReleasedOrnaments is ONLY the ornaments released in THIS transaction
	// (ReleasedAt set by this CompleteRelease call) — not every ornament
	// ever released on this loan across multiple partial releases.
	ReleasedOrnaments []PartialReleaseReceiptOrnament
	// StillPledgedOrnaments is every ornament still in custody after this
	// release (ReleasedAt == nil).
	StillPledgedOrnaments []PartialReleaseReceiptOrnament

	RevisedPrincipalBalance float64
	RevisedTotalGoldValue   float64
	RevisedLTVRatio         float64 // percent, e.g. 62.5

	LegalName   string
	AddressLine string
	// LenderSignature — see ReleaseAgreementData.LenderSignature.
	LenderSignature template.HTML
}

// partialReleaseReceiptTemplates is the receipt keyed by language. Unlike
// FORM 7 it is not policy-specific (it is not a statutory form), so there is
// no policy axis here.
var partialReleaseReceiptTemplates = map[string]*template.Template{
	BondLangEnglish:   mustLoadTemplate("partial_release_receipt_en", "partial-release-receipt.html", nil),
	BondLangMalayalam: mustLoadTemplate("partial_release_receipt_ml", "partial-release-receipt-malayalam.html", nil),
}

// partialReleaseReceiptTemplateData wraps PartialReleaseReceiptData with
// pre-formatted display fields, same convention as
// releaseAgreementTemplateData.
type partialReleaseReceiptTemplateData struct {
	PartialReleaseReceiptData
	Style                   template.CSS
	LenderName              string
	LenderAddress           string
	ReleaseDate             string
	SettlementAmount        string
	RevisedPrincipalBalance string
	RevisedTotalGoldValue   string
	RevisedLTVRatio         string
	ReleasedOrnaments       []releaseOrnamentTemplateData
	StillPledgedOrnaments   []releaseOrnamentTemplateData
}

func partialReleaseOrnamentRows(ornaments []PartialReleaseReceiptOrnament) []releaseOrnamentTemplateData {
	rows := make([]releaseOrnamentTemplateData, 0, len(ornaments))
	for _, o := range ornaments {
		rows = append(rows, releaseOrnamentTemplateData{
			Name:        o.Name,
			Quantity:    o.Quantity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			FineWeight:  releaseFineWeight(o.NetWeight, o.Purity),
			Value:       releaseFmtAmount(o.Value),
		})
	}
	return rows
}

// renderPartialReleaseReceiptHTML executes the receipt template for lang
// (BondLangEnglish or BondLangMalayalam) against data, mirroring
// renderReleaseAgreementHTML's structure.
func renderPartialReleaseReceiptHTML(data PartialReleaseReceiptData, lang string) (string, error) {
	tmpl, ok := partialReleaseReceiptTemplates[lang]
	if !ok {
		return "", ErrUnsupportedIndemnityBondLang
	}
	td := partialReleaseReceiptTemplateData{
		PartialReleaseReceiptData: data,
		Style:                     template.CSS(releaseAgreementStyle(lang)),
		LenderName:                firstNonEmpty(data.LegalName, releaseFallbackLenderName),
		LenderAddress:             firstNonEmpty(data.AddressLine, releaseFallbackLenderAddress),
		ReleaseDate:               releaseFmtDate(data.ReleaseDate, lang),
		SettlementAmount:          releaseFmtAmount(data.SettlementAmount),
		RevisedPrincipalBalance:   releaseFmtAmount(data.RevisedPrincipalBalance),
		RevisedTotalGoldValue:     releaseFmtAmount(data.RevisedTotalGoldValue),
		RevisedLTVRatio:           fmt.Sprintf("%.2f%%", data.RevisedLTVRatio),
		ReleasedOrnaments:         partialReleaseOrnamentRows(data.ReleasedOrnaments),
		StillPledgedOrnaments:     partialReleaseOrnamentRows(data.StillPledgedOrnaments),
	}

	var sb strings.Builder
	if err := tmpl.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("partial release receipt: render template: %w", err)
	}
	return sb.String(), nil
}

// RenderPartialReleaseReceiptPDF renders the Partial Release Receipt into an
// A4 PDF — same page geometry as RenderReleaseAgreementPDF (see renderA4PDF).
func RenderPartialReleaseReceiptPDF(data PartialReleaseReceiptData, lang string) ([]byte, error) {
	htmlStr, err := renderPartialReleaseReceiptHTML(data, lang)
	if err != nil {
		return nil, err
	}
	return renderA4PDF(htmlStr, "partial release receipt")
}

// partialReleaseReceiptDataForRequest builds RenderPartialReleaseReceiptPDF's
// input from an Approved, IsPartial LoanRequest and its loan's CURRENT
// ornament rows. Requires the request to already be Approved (the release
// having actually completed) — ReleasedOrnaments below reads ReleasedAt IS
// NOT NULL among the SELECTED set, which is only populated once
// CompleteRelease's partial branch has actually run.
func (s *Service) partialReleaseReceiptDataForRequest(ctx context.Context, req *LoanRequest) (PartialReleaseReceiptData, error) {
	l, err := s.Get(ctx, req.LoanID, nil)
	if err != nil {
		return PartialReleaseReceiptData{}, err
	}

	all, err := s.ornamentRepo.FindAllByLoanID(ctx, req.LoanID)
	if err != nil {
		return PartialReleaseReceiptData{}, err
	}

	selected := make(map[uint]bool, len(req.OrnamentSelections))
	for _, sel := range req.OrnamentSelections {
		selected[sel.OrnamentID] = true
	}

	var released, stillPledged []PartialReleaseReceiptOrnament
	for _, o := range all {
		row := PartialReleaseReceiptOrnament{
			Name: o.Name, Purity: o.Purity, Quantity: o.Quantity,
			GrossWeight: o.GrossWeight, NetWeight: o.NetWeight, Value: o.GoldValue,
		}
		switch {
		case selected[o.ID] && o.ReleasedAt != nil:
			// Released as part of THIS request's transaction — not every
			// ornament this loan has ever released, only this selection.
			released = append(released, row)
		case o.ReleasedAt == nil:
			stillPledged = append(stillPledged, row)
		}
	}

	ltv := 0.0
	if l.EligibleLoanAmount > 0 && l.SchemeLTVPercent > 0 && l.TotalGoldValue > 0 {
		ltv = (l.PrincipalAmount / l.TotalGoldValue) * 100
	}

	legalName, addressLine, _, _ := s.lenderProfile(ctx)
	releaseDate := time.Now()
	if req.DecidedAt != nil {
		releaseDate = *req.DecidedAt
	}

	return PartialReleaseReceiptData{
		LoanNumber:              l.LoanNumber,
		BranchName:              s.documentBranchName(ctx, l.Branch.Name),
		CustomerName:            l.Customer.Name,
		CustomerAddress:         l.Customer.Address,
		ReleaseDate:             releaseDate,
		SettlementAmount:        req.SettlementAmount,
		ReleasedOrnaments:       released,
		StillPledgedOrnaments:   stillPledged,
		RevisedPrincipalBalance: l.PrincipalAmount,
		RevisedTotalGoldValue:   l.TotalGoldValue,
		RevisedLTVRatio:         ltv,
		LegalName:               legalName,
		AddressLine:             addressLine,
		LenderSignature:         s.lenderSignature(ctx),
	}, nil
}

// RenderPartialReleaseReceiptPDFForRequest renders the Partial Release
// Receipt PDF for a given (Approved, IsPartial) release request — the
// server-side handler for GET
// /loans/requests/:requestId/partial-release-receipt/pdf.
func (s *Service) RenderPartialReleaseReceiptPDFForRequest(ctx context.Context, requestID uint, branchID *uint, lang string) ([]byte, string, error) {
	if lang != BondLangEnglish && lang != BondLangMalayalam {
		return nil, "", ErrUnsupportedIndemnityBondLang
	}
	req, err := s.requestRepo.FindByID(ctx, requestID)
	if err != nil {
		return nil, "", ErrRequestNotFound
	}
	if err := s.checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, "", err
	}
	if req.Type != RequestTypeRelease || !req.IsPartial {
		return nil, "", ErrNotReleaseRequest
	}

	data, err := s.partialReleaseReceiptDataForRequest(ctx, req)
	if err != nil {
		return nil, "", err
	}

	pdfBytes, err := RenderPartialReleaseReceiptPDF(data, lang)
	if err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("Partial-Release-Receipt-%s-%d.pdf", data.LoanNumber, requestID)
	if lang == BondLangMalayalam {
		filename = fmt.Sprintf("Partial-Release-Receipt-Malayalam-%s-%d.pdf", data.LoanNumber, requestID)
	}
	return pdfBytes, filename, nil
}

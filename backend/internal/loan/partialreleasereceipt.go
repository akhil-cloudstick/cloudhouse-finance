package loan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
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
}

var partialReleaseReceiptTemplate = mustLoadTemplate("partial_release_receipt_en", "partial-release-receipt.html", nil)

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

// renderPartialReleaseReceiptHTML executes the receipt template against
// data, mirroring renderReleaseAgreementHTML's structure but with no
// language variants — the receipt is an internal/customer-facing summary
// document, not a statutory form, so it only ever renders in English.
func renderPartialReleaseReceiptHTML(data PartialReleaseReceiptData) (string, error) {
	td := partialReleaseReceiptTemplateData{
		PartialReleaseReceiptData: data,
		Style:                     template.CSS(releaseAgreementStyle(BondLangEnglish)),
		LenderName:                firstNonEmpty(data.LegalName, releaseFallbackLenderName),
		LenderAddress:             firstNonEmpty(data.AddressLine, releaseFallbackLenderAddress),
		ReleaseDate:               releaseFmtDate(data.ReleaseDate, BondLangEnglish),
		SettlementAmount:          releaseFmtAmount(data.SettlementAmount),
		RevisedPrincipalBalance:   releaseFmtAmount(data.RevisedPrincipalBalance),
		RevisedTotalGoldValue:     releaseFmtAmount(data.RevisedTotalGoldValue),
		RevisedLTVRatio:           fmt.Sprintf("%.2f%%", data.RevisedLTVRatio),
		ReleasedOrnaments:         partialReleaseOrnamentRows(data.ReleasedOrnaments),
		StillPledgedOrnaments:     partialReleaseOrnamentRows(data.StillPledgedOrnaments),
	}

	var sb strings.Builder
	if err := partialReleaseReceiptTemplate.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("partial release receipt: render template: %w", err)
	}
	return sb.String(), nil
}

// RenderPartialReleaseReceiptPDF renders the Partial Release Receipt into a
// PDF via headless Chromium — same chromedp invocation pattern as
// RenderReleaseAgreementPDF.
func RenderPartialReleaseReceiptPDF(data PartialReleaseReceiptData) ([]byte, error) {
	htmlStr, err := renderPartialReleaseReceiptHTML(data)
	if err != nil {
		return nil, err
	}

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	encoded := base64.StdEncoding.EncodeToString([]byte(htmlStr))
	var pdfBytes []byte
	err = chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+encoded),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(true).
				WithMarginTop(0.7).
				WithMarginBottom(0.7).
				WithMarginLeft(0.6).
				WithMarginRight(0.6).
				WithDisplayHeaderFooter(true).
				WithHeaderTemplate(bondHeaderTemplate).
				WithFooterTemplate(bondFooterTemplate).
				Do(ctx)
			if err != nil {
				return err
			}
			pdfBytes = buf
			return nil
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("partial release receipt: render PDF (is Chrome/Chromium installed and on PATH?): %w", err)
	}
	return pdfBytes, nil
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

	legalName, addressLine, _ := s.lenderProfile(ctx)
	releaseDate := time.Now()
	if req.DecidedAt != nil {
		releaseDate = *req.DecidedAt
	}

	return PartialReleaseReceiptData{
		LoanNumber:              l.LoanNumber,
		BranchName:              l.Branch.Name,
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
	}, nil
}

// RenderPartialReleaseReceiptPDFForRequest renders the Partial Release
// Receipt PDF for a given (Approved, IsPartial) release request — the
// server-side handler for GET
// /loans/requests/:requestId/partial-release-receipt/pdf.
func (s *Service) RenderPartialReleaseReceiptPDFForRequest(ctx context.Context, requestID uint, branchID *uint, _ string) ([]byte, string, error) {
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

	pdfBytes, err := RenderPartialReleaseReceiptPDF(data)
	if err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("Partial-Release-Receipt-%s-%d.pdf", data.LoanNumber, requestID)
	return pdfBytes, filename, nil
}

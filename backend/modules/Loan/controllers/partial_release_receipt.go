package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"html/template"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var partialReleaseReceiptTemplates = map[string]*template.Template{
	BondLangEnglish:   mustLoadTemplate("partial_release_receipt_en", "partial_release_receipt.html", nil),
	BondLangMalayalam: mustLoadTemplate("partial_release_receipt_ml", "partial_release_receipt_malayalam.html", nil),
}

type PartialReleaseReceiptOrnament struct {
	Name        string
	Purity      string
	Quantity    int
	GrossWeight float64
	NetWeight   float64
	Value       float64
}

type PartialReleaseReceiptData struct {
	LoanNumber              string
	BranchName              string
	CustomerName            string
	CustomerAddress         string
	ReleaseDate             time.Time
	SettlementAmount        float64
	ReleasedOrnaments       []PartialReleaseReceiptOrnament
	StillPledgedOrnaments   []PartialReleaseReceiptOrnament
	RevisedPrincipalBalance float64
	RevisedTotalGoldValue   float64
	RevisedLTVRatio         float64
	LegalName               string
	AddressLine             string
	LenderSignature         template.HTML
}

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

func renderPartialReleaseReceiptHTML(data PartialReleaseReceiptData, lang string) (string, error) {
	tmpl, ok := partialReleaseReceiptTemplates[lang]
	if !ok {
		return "", common.NewBadRequest("lang must be \"en\", \"ml\" or \"gu\"")
	}
	td := partialReleaseReceiptTemplateData{
		PartialReleaseReceiptData: data,
		Style:                     template.CSS(releaseAgreementStyle(lang)),
		LenderName:                firstNonEmpty(data.LegalName, "CHITTILAPILLY THOMMANA FINANCIERS AND INVESTMENTS"),
		LenderAddress:             firstNonEmpty(data.AddressLine, "XXI/118 - BLOCK JUNCTION, VELLANGALLUR, 680662"),
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

func RenderPartialReleaseReceiptPDF(data PartialReleaseReceiptData, lang string) ([]byte, error) {
	htmlStr, err := renderPartialReleaseReceiptHTML(data, lang)
	if err != nil {
		return nil, err
	}
	return renderA4PDF(htmlStr, "partial release receipt")
}

func partialReleaseReceiptDataForRequest(ctx context.Context, req *models.LoanRequest) (PartialReleaseReceiptData, error) {
	l, err := GetLoan(ctx, req.LoanID, nil)
	if err != nil {
		return PartialReleaseReceiptData{}, err
	}
	all, err := findAllByLoanID(ctx, req.LoanID)
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
			released = append(released, row)
		case o.ReleasedAt == nil:
			stillPledged = append(stillPledged, row)
		}
	}
	ltv := 0.0
	if l.EligibleLoanAmount > 0 && l.SchemeLTVPercent > 0 && l.TotalGoldValue > 0 {
		ltv = (l.PrincipalAmount / l.TotalGoldValue) * 100
	}
	legalName, addressLine, _, _ := lenderProfile(ctx)
	releaseDate := time.Now()
	if req.DecidedAt != nil {
		releaseDate = *req.DecidedAt
	}
	return PartialReleaseReceiptData{
		LoanNumber:              l.LoanNumber,
		BranchName:              documentBranchName(ctx, l.Branch.Name),
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
		LenderSignature:         lenderSignature(ctx),
	}, nil
}

func renderPartialReleaseReceiptPDFForRequest(ctx context.Context, requestID uint, branchID *uint, lang string) ([]byte, string, error) {
	if lang != BondLangEnglish && lang != BondLangMalayalam {
		return nil, "", common.NewBadRequest("lang must be \"en\", \"ml\" or \"gu\"")
	}
	req, err := findLoanRequestByID(ctx, requestID)
	if err != nil {
		return nil, "", common.NewNotFound("loan request not found")
	}
	if err := checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, "", err
	}
	if req.Type != models.RequestTypeRelease || !req.IsPartial {
		return nil, "", common.NewBadRequest("this request is not a Release request")
	}
	data, err := partialReleaseReceiptDataForRequest(ctx, req)
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

func DownloadPartialReleaseReceiptPDF(c echo.Context) error {
	ctx := auth.RequestContext(c)
	requestID, err := common.IDParam(c, "request_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	lang := common.DefaultQuery(c, "lang", BondLangEnglish)
	pdfBytes, filename, err := renderPartialReleaseReceiptPDFForRequest(ctx, requestID, auth.GetBranchScope(c), lang)
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

// RoleSlipEsignCustomer is the signer role stamped on the pledge slip's customer box (data-esign-role in pledge_slip.html).
const RoleSlipEsignCustomer = "slip_esign_customer"

// startPledgeSlipSign sends the GML pledge slip to the customer for Aadhaar eSign. The customer is
// the only signer; the manager's box is left for the branch.
func startPledgeSlipSign(ctx context.Context, loanID uint, branchID *uint, redirectURL, deliverBy string) (*config.SignatureRequest, error) {
	if config.Esign == nil || config.IsDemoRun(ctx) {
		return nil, common.NewUnavailable("pledge slip eSign is not configured")
	}
	if t := tenantForContext(ctx); t == nil || commonModels.PolicyOrDefault(t.Policy) != commonModels.PolicyGML {
		return nil, common.NewBadRequest("the pledge slip eSign is only available for GML businesses")
	}
	if deliverBy == "" {
		deliverBy = "open"
	}
	if deliverBy != "open" && deliverBy != "whatsapp" && deliverBy != "dashboard" {
		return nil, common.NewBadRequest("deliver_by must be \"open\", \"whatsapp\" or \"dashboard\"")
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	if l.PledgeSlipSignStatus == "sign_complete" {
		return nil, common.NewConflict("this loan's pledge slip has already been signed")
	}
	if tenantID, ok := config.TenantFromContext(ctx); ok {
		if err := common.CheckAndRecordUsage(config.DB, tenantID, common.UsageSetuEsign); err != nil {
			return nil, err
		}
	}
	htmlStr, err := pledgeSlipHTML(ctx, l, true)
	if err != nil {
		return nil, err
	}
	pdfBytes, slots, err := renderA4PDFWithSlots(htmlStr, "pledge slip")
	if err != nil {
		return nil, err
	}
	lastPage := strconv.Itoa(max(CountPDFPages(pdfBytes), 1))
	// No measurable box (slip spilled onto several pages): use the SUREPASS_ESIGN_SLIP_X/Y position.
	if len(slots) == 0 {
		slots = []config.SignatureSlot{{Page: lastPage, X: config.Env.SurepassEsignSlipX, Y: config.Env.SurepassEsignSlipY, Role: RoleSlipEsignCustomer}}
	}
	doc, err := config.Esign.UploadDocument(pdfBytes, "Pledge Slip - "+l.LoanNumber)
	if err != nil {
		return nil, err
	}
	phone := digitsOnly(l.Customer.Phone)
	if len(phone) > 10 {
		phone = phone[len(phone)-10:]
	}
	if len(phone) < 10 {
		phone = "9876543210"
	}
	name := strings.TrimSpace(l.Customer.Name)
	if len(name) < 3 {
		name = "Customer " + l.LoanNumber
	}
	signer := config.Signer{
		Identifier:  phone,
		DisplayName: name,
		Signature:   &config.SignatureConfig{OnPages: []string{lastPage}, Position: "bottom-right", Slots: slots},
	}
	if !l.Customer.DOB.IsZero() {
		signer.BirthYear = strconv.Itoa(l.Customer.DOB.Year())
	}
	req, err := config.Esign.CreateSignatureRequestMulti(doc.ID, []config.Signer{signer}, redirectURL)
	if err != nil {
		return nil, err
	}
	l.PledgeSlipSignRequestID = req.ID
	l.PledgeSlipSignStatus = req.Status
	if err := persistLoan(ctx, l); err != nil {
		return nil, err
	}
	if req.URL != "" {
		deliverEsignNotice(ctx, l, "Sign Your Pledge Slip", fmt.Sprintf(
			"CloudHouse Finance: your pledge slip for loan %s is ready to sign with Aadhaar. Open this link on your own phone to complete it: %s",
			l.LoanNumber, req.URL), deliverBy, phone)
	}
	return req, nil
}

// checkPledgeSlipSign polls the slip's eSign request and, once complete, stores the signed PDF on the loan.
func checkPledgeSlipSign(ctx context.Context, loanID uint, branchID *uint) (*models.Loan, *config.SignatureStatus, error) {
	if config.Esign == nil || config.IsDemoRun(ctx) {
		return nil, nil, common.NewUnavailable("pledge slip eSign is not configured")
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, nil, common.NewNotFound("loan not found")
	}
	if l.PledgeSlipSignRequestID == "" {
		return nil, nil, common.NewBadRequest("no pledge slip eSign has been started for this loan")
	}
	status, err := config.Esign.GetSignatureStatus(l.PledgeSlipSignRequestID)
	if err != nil {
		return nil, nil, err
	}
	if status.Status != "sign_complete" {
		l.PledgeSlipSignStatus = status.Status
		if updErr := persistLoan(ctx, l); updErr != nil {
			log.Printf("pledge slip sign status update failed for loan %d: %v", l.ID, updErr)
		}
		return l, status, nil
	}
	pdfBytes, err := downloadSignedPDF(l.PledgeSlipSignRequestID)
	if err != nil {
		return nil, nil, err
	}
	url, err := common.SaveBytesRecorded(ctx, config.Env.UploadsDir, "pledge-slip-"+l.LoanNumber+".pdf", pdfBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("pledge slip: store signed document: %w", err)
	}
	now := time.Now()
	l.PledgeSlipSignStatus = "sign_complete"
	l.PledgeSlipSignedURL = url
	l.PledgeSlipSignedAt = &now
	if err := persistLoan(ctx, l); err != nil {
		return nil, nil, err
	}
	updated, err := findLoanByID(ctx, l.ID)
	if err != nil {
		return nil, nil, err
	}
	return updated, status, nil
}

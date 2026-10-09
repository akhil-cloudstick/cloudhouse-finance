package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// EsignClient calls Surepass's Suresign eSign API (https://docs.esign.surepass.app).
// Signing a document is a multi-step flow: upload the PDF, initialize a signing
// session against it, the CUSTOMER completes Aadhaar+OTP signing from the
// signer's invite link (in their own browser — same shape as DigilockerClient),
// then the caller polls status and downloads the signed PDF once complete.
//
// Suresign is a separate product from the KYC APIs: its own host
// (Config.SurepassEsignBaseURL) and its own bearer token.
type EsignClient struct {
	surepassHTTP
	// SignX/SignY are the fallback stamp position (top-left corner, PDF points from the
	// sheet's top-left) for a document that supplies no measured Slots.
	SignX int
	SignY int
	// YFromBottom: Suresign reads y from the bottom of the page — see
	// Config.SurepassEsignYFromBottom.
	YFromBottom bool
}

// Stamp box sent for every signature element. Sized to fit the blank gap above
// a signature line on the bond templates (see the .sig / .esign-slot rules in
// internal/loan/indemnitybond.go).
const (
	esignStampWidth  = 120
	esignStampHeight = 36
	// a4HeightPt is the A4 sheet height in PDF points, for converting a
	// top-measured y into the bottom-measured y Suresign expects.
	a4HeightPt = 842
	// esignExpirySeconds is how long a signing link stays valid (the API
	// accepts 1 hour to 30 days).
	esignExpirySeconds = 7 * 24 * 3600
)

// NewEsignClient builds an EsignClient from the app Config.
func NewEsignClient(cfg Config) *EsignClient {
	return &EsignClient{
		surepassHTTP: surepassHTTP{
			Token:   cfg.SurepassEsignToken,
			BaseURL: strings.TrimRight(cfg.SurepassEsignBaseURL, "/"),
			// Document upload can be slower than a plain JSON call.
			HTTPClient: &http.Client{Timeout: 30 * time.Second},
		},
		SignX: cfg.SurepassEsignSignX,
		SignY: cfg.SurepassEsignSignY,
		YFromBottom: cfg.SurepassEsignYFromBottom,
	}
}

// UploadedDocument is the result of uploading a document to sign.
type UploadedDocument struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// UploadDocument uploads a PDF (as raw bytes, e.g. from
// loan.RenderIndemnityBondPDF) ahead of initializing a signing session. name
// is a display label, not a filesystem path.
func (c *EsignClient) UploadDocument(pdfBytes []byte, name string) (*UploadedDocument, error) {
	if name == "" {
		name = "document"
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", name+".pdf")
	if err != nil {
		return nil, fmt.Errorf("esign: build upload form: %w", err)
	}
	if _, err := part.Write(pdfBytes); err != nil {
		return nil, fmt.Errorf("esign: build upload form: %w", err)
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("esign: build upload form: %w", err)
	}

	var data struct {
		ClientID string `json:"client_id"`
	}
	if err := c.do(http.MethodPost, "/api/v1/files/upload-pdf", w.FormDataContentType(), &buf, &data); err != nil {
		return nil, err
	}
	if data.ClientID == "" {
		return nil, fmt.Errorf("esign: upload returned no file id")
	}
	return &UploadedDocument{ID: data.ClientID, Name: name}, nil
}

// SignatureConfig says where on the document the signature stamp goes.
type SignatureConfig struct {
	// OnPages are 1-based page numbers, used with the client's SignX/SignY
	// when Slots is empty. Position is kept for callers' readability only.
	OnPages  []string `json:"onPages"`
	Position string   `json:"position"`
	// Slots are exact stamp positions measured from the rendered document
	// (PDF points from the sheet's top-left, 1-based page). When present they
	// replace the OnPages + SignX/SignY default, so a document can be stamped
	// on each of its own signature lines.
	Slots []SignatureSlot `json:"slots,omitempty"`
}

// SignatureSlot is one stamp position: a 1-based page number and x/y in PDF
// points from the top-left of that page.
type SignatureSlot struct {
	Page string `json:"page"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
}

// Signer identifies who is expected to Aadhaar-eSign the document. Identifier
// is the signer's mobile number and DisplayName their name.
type Signer struct {
	Identifier  string           `json:"identifier"`
	DisplayName string           `json:"displayName"`
	BirthYear   string           `json:"birthYear,omitempty"` // unused by Suresign
	Email       string           `json:"email,omitempty"`
	Signature   *SignatureConfig `json:"signature,omitempty"`
}

// SignatureRequest is the result of creating (or polling) a signing request.
type SignatureRequest struct {
	ID         string `json:"id"`
	DocumentID string `json:"documentId"`
	// Status is "sign_initiated" until the signer completes Aadhaar+OTP
	// signing, then "sign_complete" (or "failed").
	Status string `json:"status"`
	// URL is the signer's invite link — the page the SIGNER must open (in
	// their own browser/device) to complete Aadhaar+OTP eSign.
	URL string `json:"url"`
}

type esignElement struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Page   int    `json:"page"` // zero-indexed
	Type   string `json:"type"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// elementsFor turns the caller's stamp positions into Suresign elements.
func (c *EsignClient) elementsFor(sig *SignatureConfig) []esignElement {
	zeroBased := func(page string) int {
		n, err := strconv.Atoi(page)
		if err != nil || n < 1 {
			return 0
		}
		return n - 1
	}
	// Callers give the stamp's TOP-left corner. Suresign anchors an element's
	// y at its BOTTOM edge — sent as-is, the box lands one stamp-height above
	// the intended spot (confirmed on the signing page preview) — so the height
	// is added here.
	element := func(x, y int, page string) esignElement {
		bottom := y + esignStampHeight // stamp's bottom edge, measured from the page top
		if c.YFromBottom {
			bottom = a4HeightPt - bottom
		}
		return esignElement{X: x, Y: bottom, Page: zeroBased(page), Type: "signature", Width: esignStampWidth, Height: esignStampHeight}
	}

	var els []esignElement
	if sig != nil {
		if len(sig.Slots) > 0 {
			for _, s := range sig.Slots {
				els = append(els, element(s.X, s.Y, s.Page))
			}
			return els
		}
		for _, p := range sig.OnPages {
			els = append(els, element(c.SignX, c.SignY, p))
		}
	}
	if len(els) == 0 {
		els = append(els, element(c.SignX, c.SignY, "1"))
	}
	return els
}

// CreateSignatureRequest starts a new Aadhaar eSign session against an
// already-uploaded document. Suresign has no redirect URL on initialize, so
// redirectURL is accepted for interface compatibility and not sent: after
// signing the customer is not sent back to the app, and the caller's status
// polling picks up completion.
func (c *EsignClient) CreateSignatureRequest(documentID string, signer Signer, redirectURL string) (*SignatureRequest, error) {
	sg := map[string]any{
		"full_name":    signer.DisplayName,
		"mobile":       signer.Identifier,
		"country_code": "+91",
		"reason":       "Pledge agreement signing",
		// The invite link is delivered by the app itself (WhatsApp/dashboard/
		// opened on the spot — see loan.Service.deliverEsignLink), so
		// Suresign's own email/WhatsApp messages stay off.
		"notification": map[string]bool{"invite": false, "completion": false, "whatsapp": false},
		"elements":     c.elementsFor(signer.Signature),
	}
	if signer.Email != "" {
		sg["email"] = signer.Email
	}

	body, err := json.Marshal(map[string]any{
		"sign_type":      "aadhaar",
		"auth_mode":      1,
		"file_id":        documentID,
		"expiry_seconds": esignExpirySeconds,
		"signers":        []any{sg},
	})
	if err != nil {
		return nil, fmt.Errorf("esign: encode request: %w", err)
	}

	var data struct {
		ClientID string `json:"client_id"`
		Signers  []struct {
			InviteURL string `json:"invite_url"`
		} `json:"signers"`
	}
	if err := c.do(http.MethodPost, "/api/v1/esign/initialize-esign", "application/json", bytes.NewReader(body), &data); err != nil {
		return nil, err
	}
	if data.ClientID == "" || len(data.Signers) == 0 || data.Signers[0].InviteURL == "" {
		return nil, fmt.Errorf("esign: initialize returned no signing link")
	}
	return &SignatureRequest{
		ID:         data.ClientID,
		DocumentID: documentID,
		Status:     "sign_initiated",
		URL:        data.Signers[0].InviteURL,
	}, nil
}

// SignatureStatus is the result of polling a signature request's progress.
type SignatureStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"` // "sign_initiated" | "sign_complete" | "failed"
	// RawStatus is Suresign's own value (pending, completed, failed, expired).
	RawStatus string `json:"rawStatus,omitempty"`
}

// GetSignatureStatus polls whether the signer has completed Aadhaar eSign yet.
// Suresign's states are mapped onto the sign_initiated / sign_complete /
// failed vocabulary stored on the loan.
func (c *EsignClient) GetSignatureStatus(requestID string) (*SignatureStatus, error) {
	var data struct {
		Status string `json:"status"`
	}
	if err := c.do(http.MethodGet, "/api/v1/esign/details?client_id="+url.QueryEscape(requestID), "", nil, &data); err != nil {
		return nil, err
	}

	status := "sign_initiated"
	switch data.Status {
	case "completed":
		status = "sign_complete"
	case "failed", "expired":
		status = "failed"
	}
	return &SignatureStatus{ID: requestID, Status: status, RawStatus: data.Status}, nil
}

// SignedDocumentDownload is the result of fetching a completed signature
// request's signed document. DownloadURL is time-limited — callers should
// fetch and re-host it promptly (see loan.Service.CheckIndemnityBondSign)
// rather than storing the link itself.
type SignedDocumentDownload struct {
	ID          string `json:"id"`
	DownloadURL string `json:"downloadUrl"`
	ValidUpto   string `json:"validUpto"`
}

// GetSignedDocument fetches the download link for a completed signature
// request. Calling this before GetSignatureStatus reports "sign_complete"
// returns a 404 from Suresign.
func (c *EsignClient) GetSignedDocument(requestID string) (*SignedDocumentDownload, error) {
	var data struct {
		URL string `json:"url"`
	}
	if err := c.do(http.MethodGet, "/api/v1/esign/download-pdf?client_id="+url.QueryEscape(requestID), "", nil, &data); err != nil {
		return nil, err
	}
	if data.URL == "" {
		return nil, fmt.Errorf("esign: no signed document URL returned for %s", strconv.Quote(requestID))
	}
	return &SignedDocumentDownload{ID: requestID, DownloadURL: data.URL}, nil
}

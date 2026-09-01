package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

// EsignClient calls Setu's Aadhaar eSign API
// (https://docs.setu.co/data/esign). Unlike SetuClient's PAN verify (a
// single request/response server-to-server call), signing a document is a
// multi-step flow: upload the document to sign, create a signature request
// against it, the CUSTOMER completes Aadhaar+OTP signing on Setu's hosted
// page (in their own browser — same redirect shape as DigilockerClient),
// then the caller polls status and downloads the signed document once
// complete.
type EsignClient struct {
	ClientID        string
	ClientSecret    string
	ProductInstance string
	BaseURL         string
	HTTPClient      *http.Client
}

// NewEsignClient builds an EsignClient from the app Config.
func NewEsignClient(cfg Config) *EsignClient {
	return &EsignClient{
		ClientID:        cfg.SetuEsignClientID,
		ClientSecret:    cfg.SetuEsignClientSecret,
		ProductInstance: cfg.SetuEsignProductInstance,
		BaseURL:         cfg.SetuEsignBaseURL,
		// Document upload/render can be slower than a plain JSON call —
		// same generous timeout DigilockerClient uses.
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// IsSandbox reports whether BaseURL points at Setu's sandbox host — see
// SetuClient.IsSandbox's doc comment for why callers care about this.
func (c *EsignClient) IsSandbox() bool {
	return strings.Contains(c.BaseURL, "sandbox")
}

func (c *EsignClient) configured() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.ProductInstance != ""
}

func (c *EsignClient) setHeaders(req *http.Request) {
	req.Header.Set("x-client-id", c.ClientID)
	req.Header.Set("x-client-secret", c.ClientSecret)
	req.Header.Set("x-product-instance-id", c.ProductInstance)
}

// esignErrorResponse mirrors Setu's error envelope — matches
// digilockerErrorResponse's shape, kept separate (rather than shared)
// because the two products' actual error bodies are not confirmed
// identical, and each client already has its own decode helper.
type esignErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Detail  string `json:"detail"`
		TraceID string `json:"traceId"`
	} `json:"error"`
	// The sandbox has also been observed returning a flatter
	// {"message":"...","status":"error","traceId":"..."} envelope (no
	// nested "error" object) for plain validation failures — checked as a
	// fallback below so those errors surface with a real message too.
	Message string `json:"message"`
	TraceID string `json:"traceId"`
}

func decodeEsignResponse(resp *http.Response, out any) error {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("esign: read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		var errResp esignErrorResponse
		if jsonErr := json.Unmarshal(body, &errResp); jsonErr == nil {
			if errResp.Error.Code != "" {
				return fmt.Errorf("esign: %s (%s) [trace=%s] raw=%s", errResp.Error.Detail, errResp.Error.Code, errResp.Error.TraceID, string(body))
			}
			if errResp.Message != "" {
				return fmt.Errorf("esign: %s [trace=%s] raw=%s", errResp.Message, errResp.TraceID, string(body))
			}
		}
		return fmt.Errorf("esign: http %d: %s", resp.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("esign: decode response: %w (body=%s)", err, string(body))
	}
	return nil
}

// UploadedDocument is the result of uploading a document to sign.
type UploadedDocument struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// UploadDocument uploads a PDF (as raw bytes, e.g. from
// loan.RenderIndemnityBondPDF) to Setu ahead of creating a signature
// request. name is a display label, not a filesystem path.
func (c *EsignClient) UploadDocument(pdfBytes []byte, name string) (*UploadedDocument, error) {
	if !c.configured() {
		return nil, fmt.Errorf("esign: SETU_ESIGN_CLIENT_ID, SETU_ESIGN_CLIENT_SECRET and SETU_ESIGN_PRODUCT_INSTANCE_ID must be set")
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if name == "" {
		name = "document"
	}
	if err := w.WriteField("name", name); err != nil {
		return nil, fmt.Errorf("esign: build upload form: %w", err)
	}

	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="document"; filename="%s.pdf"`, name))
	h.Set("Content-Type", "application/pdf")
	part, err := w.CreatePart(h)
	if err != nil {
		return nil, fmt.Errorf("esign: build upload form: %w", err)
	}
	if _, err := part.Write(pdfBytes); err != nil {
		return nil, fmt.Errorf("esign: build upload form: %w", err)
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("esign: build upload form: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/documents", &buf)
	if err != nil {
		return nil, fmt.Errorf("esign: build request: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("esign: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out UploadedDocument
	if err := decodeEsignResponse(resp, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Signer identifies who is expected to Aadhaar-eSign the document.
// BirthYear comes from the signer's date of birth already on file — Setu
// uses it as part of matching the Aadhaar OTP session to the expected
// signer, not as a full identity check on its own.
type SignatureConfig struct {
	OnPages  []string `json:"onPages"`
	Position string   `json:"position"`
	Height   int      `json:"height,omitempty"`
	Width    int      `json:"width,omitempty"`
}

type Signer struct {
	Identifier  string           `json:"identifier"`
	DisplayName string           `json:"displayName"`
	BirthYear   string           `json:"birthYear,omitempty"`
	Signature   *SignatureConfig `json:"signature,omitempty"`
}

// SignatureRequest is the result of creating (or polling) a signing request.
type SignatureRequest struct {
	ID         string `json:"id"`
	DocumentID string `json:"documentId"`
	// Status is "sign_initiated" until the signer completes Aadhaar+OTP
	// signing on Setu's hosted page, then "sign_complete" (or "failed").
	Status string `json:"status"`
	// URL is the signing page the SIGNER must open (in their own browser/
	// device) to complete Aadhar+OTP eSign — mirrors
	// DigilockerRequest.URL's role in that flow. Populated from
	// signatureRequestResponse.resolveURL below: Setu's actual response
	// carries this per-signer (signers[0].url), not as a bare top-level
	// field — a request that decoded fine but left this empty (200 OK,
	// nothing to open) was the tell.
	URL string `json:"url"`
}

// signatureRequestResponse is the raw decode target for
// CreateSignatureRequest — wider than SignatureRequest because Setu nests
// the actual signing link under each entry of "signers" rather than at the
// top level.
type signatureRequestResponse struct {
	SignatureRequest
	Signers []struct {
		URL string `json:"url"`
	} `json:"signers"`
}

// resolveURL prefers the top-level url if Setu ever does send one, and
// otherwise falls back to the first signer's — this integration only ever
// creates a single signer per request (see CreateSignatureRequest), so
// there is never an ambiguity about which signer's link to use.
func (r signatureRequestResponse) resolveURL() string {
	if r.URL != "" {
		return r.URL
	}
	if len(r.Signers) > 0 {
		return r.Signers[0].URL
	}
	return ""
}

// CreateSignatureRequest starts a new Aadhaar eSign request against an
// already-uploaded document. redirectURL is where Setu sends the signer
// back to after signing (success or failure) — typically a small "you're
// done, close this tab" page your frontend serves.
func (c *EsignClient) CreateSignatureRequest(documentID string, signer Signer, redirectURL string) (*SignatureRequest, error) {
	if !c.configured() {
		return nil, fmt.Errorf("esign: SETU_ESIGN_CLIENT_ID, SETU_ESIGN_CLIENT_SECRET and SETU_ESIGN_PRODUCT_INSTANCE_ID must be set")
	}
	body, err := json.Marshal(map[string]any{
		"documentId":  documentID,
		"signers":     []Signer{signer},
		"redirectUrl": redirectURL,
	})
	if err != nil {
		return nil, fmt.Errorf("esign: encode request: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/signature", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("esign: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("esign: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out signatureRequestResponse
	if err := decodeEsignResponse(resp, &out); err != nil {
		return nil, err
	}
	out.URL = out.resolveURL()
	return &out.SignatureRequest, nil
}

// SignatureStatus is the result of polling a signature request's progress
// (GET /api/signature/{id}).
type SignatureStatus struct {
	ID      string `json:"id"`
	Status  string `json:"status"` // "sign_initiated" | "sign_complete" | "failed"
	Signers []struct {
		Status string `json:"status"`
	} `json:"signers"`
}

// GetSignatureStatus polls whether the signer has completed Aadhaar eSign
// yet. The caller's UI should poll this after sending the signer the
// CreateSignatureRequest URL, since signing happens on the signer's own
// device — same "poll after redirect" pattern as
// DigilockerClient.GetStatus.
func (c *EsignClient) GetSignatureStatus(requestID string) (*SignatureStatus, error) {
	if !c.configured() {
		return nil, fmt.Errorf("esign: SETU_ESIGN_CLIENT_ID, SETU_ESIGN_CLIENT_SECRET and SETU_ESIGN_PRODUCT_INSTANCE_ID must be set")
	}
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+"/api/signature/"+requestID, nil)
	if err != nil {
		return nil, fmt.Errorf("esign: build request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("esign: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out SignatureStatus
	if err := decodeEsignResponse(resp, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SignedDocumentDownload is the result of downloading a completed signature
// request's signed document (GET /api/signature/{id}/download/).
// DownloadURL expires at ValidUpto — callers should fetch and re-host it
// promptly (see loan.Service.CheckIndemnityBondSign) rather than storing
// the link itself.
type SignedDocumentDownload struct {
	ID          string `json:"id"`
	DownloadURL string `json:"downloadUrl"`
	ValidUpto   string `json:"validUpto"`
}

// GetSignedDocument fetches the download link for a completed signature
// request. Calling this before GetSignatureStatus reports "sign_complete"
// returns an error from Setu.
func (c *EsignClient) GetSignedDocument(requestID string) (*SignedDocumentDownload, error) {
	if !c.configured() {
		return nil, fmt.Errorf("esign: SETU_ESIGN_CLIENT_ID, SETU_ESIGN_CLIENT_SECRET and SETU_ESIGN_PRODUCT_INSTANCE_ID must be set")
	}
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+"/api/signature/"+requestID+"/download/", nil)
	if err != nil {
		return nil, fmt.Errorf("esign: build request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("esign: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out SignedDocumentDownload
	if err := decodeEsignResponse(resp, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

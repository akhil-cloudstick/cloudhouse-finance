package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	PAN        *PANClient
	Digilocker *DigilockerClient
	Esign      *EsignClient
)

var errSurepassNotConfigured = fmt.Errorf("surepass: API token is not configured (SUREPASS_API_TOKEN / SUREPASS_ESIGN_TOKEN)")

const (
	esignExpirySeconds = 7 * 24 * 3600
)

type surepassHTTP struct {
	Token      string
	BaseURL    string
	HTTPClient *http.Client
}

type SurepassError struct {
	StatusCode  int
	Message     string
	MessageCode string
}

type surepassEnvelope struct {
	Data        json.RawMessage `json:"data"`
	StatusCode  int             `json:"status_code"`
	Success     bool            `json:"success"`
	Message     string          `json:"message"`
	MessageCode string          `json:"message_code"`
}

type PANClient struct {
	surepassHTTP
}

type PANVerificationResult struct {
	Verification string `json:"verification"`
	Message      string `json:"message"`
	FullName     string `json:"full_name,omitempty"`
	Category     string `json:"category,omitempty"`
	TraceID      string `json:"traceId,omitempty"`
}

type DigilockerClient struct {
	surepassHTTP
}

type DigilockerRequest struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	ValidUpto string `json:"validUpto"`
	Status    string `json:"status"`
}

type DigilockerStatus struct {
	ID               string `json:"id"`
	Status           string `json:"status"`
	ErrorDescription string `json:"errorDescription,omitempty"`
}

type AadhaarXML struct {
	Aadhaar struct {
		Address struct {
			CareOf      string `json:"careOf"`
			Country     string `json:"country"`
			District    string `json:"district"`
			House       string `json:"house"`
			Landmark    string `json:"landmark"`
			Locality    string `json:"locality"`
			PIN         string `json:"pin"`
			PostOffice  string `json:"postOffice"`
			State       string `json:"state"`
			Street      string `json:"street"`
			SubDistrict string `json:"subDistrict"`
			VTC         string `json:"vtc"`
		} `json:"address"`
		DateOfBirth  string `json:"dateOfBirth"`
		Gender       string `json:"gender"`
		Name         string `json:"name"`
		MaskedNumber string `json:"maskedNumber"`
	} `json:"aadhaar"`
	ID     string `json:"id"`
	Status string `json:"status"`
}

type EsignClient struct {
	surepassHTTP
	SignX       int
	SignY       int
	YFromBottom bool
}

type UploadedDocument struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type SignatureConfig struct {
	OnPages  []string        `json:"onPages"`
	Position string          `json:"position"`
	Slots    []SignatureSlot `json:"slots,omitempty"`
}

type SignatureSlot struct {
	Page string `json:"page"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
	Role string `json:"role,omitempty"`
}

type Signer struct {
	Identifier  string           `json:"identifier"`
	DisplayName string           `json:"displayName"`
	BirthYear   string           `json:"birthYear,omitempty"`
	Email       string           `json:"email,omitempty"`
	Signature   *SignatureConfig `json:"signature,omitempty"`
}

type SignatureRequest struct {
	ID         string `json:"id"`
	DocumentID string `json:"documentId"`
	Status     string `json:"status"`
	URL        string `json:"url"`
	// Signers holds one invite link per signer, in request order; URL is the first.
	Signers []SignerLink `json:"signers,omitempty"`
}

type SignerLink struct {
	Identifier  string `json:"identifier"`
	DisplayName string `json:"displayName"`
	URL         string `json:"url"`
}

type esignElement struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Page   int    `json:"page"`
	Type   string `json:"type"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type SignatureStatus struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	RawStatus string `json:"rawStatus,omitempty"`
}

type SignedDocumentDownload struct {
	ID          string `json:"id"`
	DownloadURL string `json:"downloadUrl"`
	ValidUpto   string `json:"validUpto"`
}

func newSurepassHTTP(cfg Config, timeout time.Duration) surepassHTTP {
	return surepassHTTP{
		Token:      cfg.SurepassToken,
		BaseURL:    strings.TrimRight(cfg.SurepassBaseURL, "/"),
		HTTPClient: &http.Client{Timeout: timeout},
	}
}

func (c *surepassHTTP) IsSandbox() bool {
	return strings.Contains(c.BaseURL, "sandbox")
}

func (c *surepassHTTP) configured() bool {
	return c.Token != ""
}

func (e *SurepassError) Status() int {
	switch {
	case e.StatusCode == http.StatusUnauthorized || e.StatusCode == http.StatusForbidden:
		return http.StatusServiceUnavailable
	case e.StatusCode >= 500:
		return http.StatusBadGateway
	default:
		return http.StatusBadRequest
	}
}

func (e *SurepassError) Error() string {
	switch e.Status() {
	case http.StatusServiceUnavailable:
		return "The KYC/eSign provider rejected this account's credentials. Please contact support."
	case http.StatusBadGateway:
		return "The KYC/eSign provider is not responding. Please try again shortly."
	}
	if e.Message != "" {
		return e.Message
	}
	return "The KYC/eSign provider could not process this request."
}

func publicRedirectURL(u string) string {
	parsed, err := url.Parse(u)
	if err != nil {
		return u
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || host == "::1" || strings.HasPrefix(host, "127.") {
		return ""
	}
	return u
}

func (c *surepassHTTP) do(method, path, contentType string, body io.Reader, out any) error {
	if !c.configured() {
		return errSurepassNotConfigured
	}
	req, err := http.NewRequest(method, c.BaseURL+path, body)
	if err != nil {
		return fmt.Errorf("surepass: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil && contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("surepass: request failed: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("surepass: read response: %w", err)
	}
	var env surepassEnvelope
	if jsonErr := json.Unmarshal(raw, &env); jsonErr != nil {
		log.Printf("surepass: %s %s -> http %d, non-JSON body: %.300s", method, path, resp.StatusCode, string(raw))
		if resp.StatusCode >= 400 {
			return &SurepassError{StatusCode: resp.StatusCode}
		}
		return fmt.Errorf("surepass: unexpected status %d: %.300s", resp.StatusCode, string(raw))
	}
	if resp.StatusCode >= 400 || !env.Success {
		code := env.StatusCode
		if code == 0 {
			code = resp.StatusCode
		}
		log.Printf("surepass: %s %s -> status=%d code=%q message=%q", method, path, code, env.MessageCode, env.Message)
		return &SurepassError{StatusCode: code, Message: env.Message, MessageCode: env.MessageCode}
	}
	if out != nil {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return fmt.Errorf("surepass: decode response: %w (body=%s)", err, string(raw))
		}
	}
	return nil
}

func NewPANClient(cfg Config) *PANClient {
	return &PANClient{newSurepassHTTP(cfg, 15*time.Second)}
}

func (c *PANClient) VerifyPAN(pan string) (*PANVerificationResult, error) {
	body, err := json.Marshal(map[string]string{"id_number": pan})
	if err != nil {
		return nil, fmt.Errorf("surepass: encode request: %w", err)
	}
	var data struct {
		PANNumber string `json:"pan_number"`
		FullName  string `json:"full_name"`
		ClientID  string `json:"client_id"`
		Category  string `json:"category"`
	}
	err = c.do(http.MethodPost, "/api/v1/pan/pan", "application/json", strings.NewReader(string(body)), &data)
	if err != nil {
		if se, ok := err.(*SurepassError); ok && se.StatusCode == http.StatusUnprocessableEntity {
			return &PANVerificationResult{Verification: "failed", Message: se.Message}, nil
		}
		return nil, err
	}
	return &PANVerificationResult{
		Verification: "SUCCESS",
		Message:      "PAN verified",
		FullName:     data.FullName,
		Category:     data.Category,
		TraceID:      data.ClientID,
	}, nil
}

func NewDigilockerClient(cfg Config) *DigilockerClient {
	return &DigilockerClient{newSurepassHTTP(cfg, 15*time.Second)}
}

func (c *DigilockerClient) CreateRequest(redirectURL string) (*DigilockerRequest, error) {
	payload := map[string]any{"signup_flow": true, "aadhaar_xml": true}
	if u := publicRedirectURL(redirectURL); u != "" {
		payload["redirect_url"] = u
	}
	body, err := json.Marshal(map[string]any{"data": payload})
	if err != nil {
		return nil, fmt.Errorf("digilocker: encode request: %w", err)
	}
	var data struct {
		ClientID      string  `json:"client_id"`
		URL           string  `json:"url"`
		ExpirySeconds float64 `json:"expiry_seconds"`
	}
	if err := c.do(http.MethodPost, "/api/v1/digilocker/initialize", "application/json", bytes.NewReader(body), &data); err != nil {
		return nil, err
	}
	out := &DigilockerRequest{ID: data.ClientID, URL: data.URL, Status: "unauthenticated"}
	if data.ExpirySeconds > 0 {
		out.ValidUpto = time.Now().Add(time.Duration(data.ExpirySeconds) * time.Second).UTC().Format(time.RFC3339)
	}
	return out, nil
}

func (c *DigilockerClient) GetStatus(requestID string) (*DigilockerStatus, error) {
	var data struct {
		Completed        bool    `json:"completed"`
		Failed           bool    `json:"failed"`
		ErrorDescription *string `json:"error_description"`
	}
	if err := c.do(http.MethodGet, "/api/v1/digilocker/status/"+url.PathEscape(requestID), "", nil, &data); err != nil {
		return nil, err
	}
	out := &DigilockerStatus{ID: requestID, Status: "unauthenticated"}
	switch {
	case data.Completed:
		out.Status = "authenticated"
	case data.Failed:
		out.Status = "failed"
		if data.ErrorDescription != nil {
			out.ErrorDescription = *data.ErrorDescription
		}
	}
	return out, nil
}

func (c *DigilockerClient) GetAadhaar(requestID string) (*AadhaarXML, error) {
	var data struct {
		ClientID string `json:"client_id"`
		XML      struct {
			FullName    string `json:"full_name"`
			CareOf      string `json:"care_of"`
			DOB         string `json:"dob"`
			Zip         string `json:"zip"`
			Gender      string `json:"gender"`
			MaskedAdhar string `json:"masked_aadhaar"`
			Address     struct {
				Country  string `json:"country"`
				Dist     string `json:"dist"`
				State    string `json:"state"`
				PO       string `json:"po"`
				House    string `json:"house"`
				Loc      string `json:"loc"`
				VTC      string `json:"vtc"`
				SubDist  string `json:"subdist"`
				Street   string `json:"street"`
				Landmark string `json:"landmark"`
			} `json:"address"`
		} `json:"aadhaar_xml_data"`
	}
	if err := c.do(http.MethodGet, "/api/v1/digilocker/download-aadhaar/"+url.PathEscape(requestID), "", nil, &data); err != nil {
		return nil, err
	}
	var out AadhaarXML
	out.ID = data.ClientID
	out.Status = "authenticated"
	a := &out.Aadhaar
	a.Name = data.XML.FullName
	a.DateOfBirth = data.XML.DOB
	a.Gender = data.XML.Gender
	a.MaskedNumber = data.XML.MaskedAdhar
	a.Address.CareOf = data.XML.CareOf
	a.Address.PIN = data.XML.Zip
	a.Address.Country = data.XML.Address.Country
	a.Address.District = data.XML.Address.Dist
	a.Address.State = data.XML.Address.State
	a.Address.PostOffice = data.XML.Address.PO
	a.Address.House = data.XML.Address.House
	a.Address.Locality = data.XML.Address.Loc
	a.Address.VTC = data.XML.Address.VTC
	a.Address.SubDistrict = data.XML.Address.SubDist
	a.Address.Street = data.XML.Address.Street
	a.Address.Landmark = data.XML.Address.Landmark
	return &out, nil
}

func NewEsignClient(cfg Config) *EsignClient {
	return &EsignClient{
		surepassHTTP: surepassHTTP{
			Token:      cfg.SurepassEsignToken,
			BaseURL:    strings.TrimRight(cfg.SurepassEsignBaseURL, "/"),
			HTTPClient: &http.Client{Timeout: 30 * time.Second},
		},
		SignX:       cfg.SurepassEsignSignX,
		SignY:       cfg.SurepassEsignSignY,
		YFromBottom: cfg.SurepassEsignYFromBottom,
	}
}

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

func (c *EsignClient) elementsFor(sig *SignatureConfig) []esignElement {
	zeroBased := func(page string) int {
		n, err := strconv.Atoi(page)
		if err != nil || n < 1 {
			return 0
		}
		return n - 1
	}
	element := func(x, y int, page string) esignElement {
		bottom := y + 36
		if c.YFromBottom {
			bottom = 842 - bottom
		}
		return esignElement{X: x, Y: bottom, Page: zeroBased(page), Type: "signature", Width: 120, Height: 36}
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

func (c *EsignClient) CreateSignatureRequest(documentID string, signer Signer, redirectURL string) (*SignatureRequest, error) {
	return c.CreateSignatureRequestMulti(documentID, []Signer{signer}, redirectURL)
}

// CreateSignatureRequestMulti starts one eSign session for every signer on the
// same document; each signer gets their own invite link and signature boxes.
func (c *EsignClient) CreateSignatureRequestMulti(documentID string, signers []Signer, redirectURL string) (*SignatureRequest, error) {
	if len(signers) == 0 {
		return nil, fmt.Errorf("esign: at least one signer is required")
	}
	sgs := make([]any, 0, len(signers))
	for _, signer := range signers {
		sg := map[string]any{
			"full_name":    signer.DisplayName,
			"mobile":       signer.Identifier,
			"country_code": "+91",
			"reason":       "Pledge agreement signing",
			"notification": map[string]bool{"invite": false, "completion": false, "whatsapp": false},
			"elements":     c.elementsFor(signer.Signature),
		}
		if signer.Email != "" {
			sg["email"] = signer.Email
		}
		sgs = append(sgs, sg)
	}
	body, err := json.Marshal(map[string]any{
		"sign_type":      "aadhaar",
		"auth_mode":      1,
		"file_id":        documentID,
		"expiry_seconds": esignExpirySeconds,
		"signers":        sgs,
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
	if data.ClientID == "" || len(data.Signers) < len(signers) {
		return nil, fmt.Errorf("esign: initialize returned no signing link")
	}
	links := make([]SignerLink, 0, len(signers))
	for i, signer := range signers {
		if data.Signers[i].InviteURL == "" {
			return nil, fmt.Errorf("esign: initialize returned no signing link")
		}
		links = append(links, SignerLink{Identifier: signer.Identifier, DisplayName: signer.DisplayName, URL: data.Signers[i].InviteURL})
	}
	return &SignatureRequest{
		ID:         data.ClientID,
		DocumentID: documentID,
		Status:     "sign_initiated",
		URL:        links[0].URL,
		Signers:    links,
	}, nil
}

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

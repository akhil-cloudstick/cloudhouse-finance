package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// DigilockerClient calls Surepass's DigiLocker Aadhaar-verification API. It
// is a 3-step redirect flow: initialize a session (get back a login URL), the
// CUSTOMER (not the caller) logs into DigiLocker with their Aadhaar + OTP in
// their own browser, then the caller polls status and downloads the Aadhaar
// data once authenticated.
type DigilockerClient struct {
	surepassHTTP
}

// NewDigilockerClient builds a DigilockerClient from the app Config.
func NewDigilockerClient(cfg Config) *DigilockerClient {
	return &DigilockerClient{newSurepassHTTP(cfg, 15*time.Second)}
}

// DigilockerRequest is the result of creating a DigiLocker verification
// request.
type DigilockerRequest struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	ValidUpto string `json:"validUpto"`
	// Status is "unauthenticated" until the customer completes DigiLocker
	// login, then "authenticated" (or "failed").
	Status string `json:"status"`
}

// CreateRequest starts a new DigiLocker verification: returns a login URL
// the CUSTOMER must open (in their own browser/device) to authenticate with
// DigiLocker. redirectURL is where DigiLocker sends the customer back to
// after login — typically a small "you're done, close this tab" page the
// frontend serves.
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

// DigilockerStatus is the result of polling a request's authentication status.
type DigilockerStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"` // "unauthenticated" | "authenticated" | "failed"
	// ErrorDescription carries Surepass's reason when Status is "failed".
	ErrorDescription string `json:"errorDescription,omitempty"`
}

// GetStatus polls whether the customer has completed DigiLocker login yet.
// Surepass reports completed/failed flags; they are mapped onto the
// "authenticated"/"unauthenticated" vocabulary the callers already use, with
// "failed" added so a dead session stops being polled as pending.
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

// AadhaarXML mirrors the e-Aadhaar data returned once a request is
// authenticated.
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

// GetAadhaar fetches the customer's e-Aadhaar details once GetStatus reports
// "authenticated". Surepass releases the data once per session — a second
// call for the same request id fails with "Aadhaar already downloaded".
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

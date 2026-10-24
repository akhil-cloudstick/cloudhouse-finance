package models

// Provider is the public "App Provider" block printed on the store-listing
// pages (/privacy-policy, /account-deletion, ...). Only fields that are safe to
// show to anyone on the internet.
type Provider struct {
	Name         string `json:"name"`
	LegalName    string `json:"legal_name"`
	AddressLine  string `json:"address_line"`
	ContactPhone string `json:"contact_phone"`
	SupportEmail string `json:"support_email"`
	Website      string `json:"website"`
	LogoURL      string `json:"logo_url"`
}

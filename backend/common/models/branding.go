package models

import (
	"encoding/json"
)

type Public struct {
	Name             string          `json:"name"`
	LegalName        string          `json:"legal_name"`
	ShortName        string          `json:"short_name"`
	LockupTagline    string          `json:"lockup_tagline"`
	BrandColor       string          `json:"brand_color"`
	SecondaryColor   string          `json:"secondary_color"`
	AccentColor      string          `json:"accent_color"`
	SidebarColor     string          `json:"sidebar_color"`
	FontFamily       string          `json:"font_family"`
	FontScale        string          `json:"font_scale"`
	LogoScale        string          `json:"logo_scale"`
	LogoDisplay      string          `json:"logo_display"`
	NavTextColor     string          `json:"nav_text_color"`
	OnBrandTextColor string          `json:"on_brand_text_color"`
	HeaderLayout     json.RawMessage `json:"header_layout"`
	ShortNameSet     bool            `json:"short_name_set"`
	LogoURL          string          `json:"logo_url"`
	AppURL           string          `json:"app_url"`
}

type Self struct {
	Public
	AddressLine  string   `json:"address_line"`
	KMLRegNo     string   `json:"kml_reg_no"`
	ContactPhone string   `json:"contact_phone"`
	Policy       string   `json:"policy"`
	Modules      []string `json:"modules"`
	Languages    []string `json:"languages"`
	SingleBranch bool     `json:"single_branch"`
}

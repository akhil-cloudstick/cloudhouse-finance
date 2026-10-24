package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// providerTenantCode is the business whose details are the "App Provider" on the public store pages.
const providerTenantCode = "default"

func providerOf(t *commonModels.Tenant) commonModels.Provider {
	legal := strings.TrimSpace(t.LegalName)
	if legal == "" {
		legal = t.Name
	}
	return commonModels.Provider{
		Name:         t.Name,
		LegalName:    legal,
		AddressLine:  t.AddressLine,
		ContactPhone: t.ContactPhone,
		SupportEmail: t.SupportEmail,
		Website:      t.AppURL,
		LogoURL:      commonModels.TenantLogoPath(t),
	}
}

func GetPublicProvider(c echo.Context) error {
	p := commonModels.Provider{Name: "CloudHouse Finance", LegalName: "CloudHouse Finance"}
	if t, err := FindByCode(config.AllowCrossTenant(auth.RequestContext(c)), providerTenantCode); err == nil {
		p = providerOf(t)
	}
	c.Response().Header().Set("Cache-Control", "no-store")
	return Success(c, http.StatusOK, p)
}

package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

func publicOf(t *commonModels.Tenant, logoURL string) commonModels.Public {
	p := commonModels.Public{
		Name:             t.Name,
		LegalName:        t.LegalName,
		ShortName:        t.ShortName,
		LockupTagline:    t.LockupTagline,
		BrandColor:       t.BrandColor,
		SecondaryColor:   t.SecondaryColor,
		AccentColor:      t.AccentColor,
		SidebarColor:     t.SidebarColor,
		FontFamily:       t.FontFamily,
		FontScale:        t.FontScale,
		LogoScale:        t.LogoScale,
		LogoDisplay:      t.LogoDisplay,
		LogoURL:          logoURL,
		AppURL:           t.AppURL,
		NavTextColor:     t.NavTextColor,
		OnBrandTextColor: t.OnBrandTextColor,
		ShortNameSet:     t.ShortName != "",
	}
	if t.HeaderLayout != "" && json.Valid([]byte(t.HeaderLayout)) {
		p.HeaderLayout = json.RawMessage(t.HeaderLayout)
	}
	if p.Name == "" {
		p.Name = "CloudHouse Finance"
	}
	if p.LegalName == "" {
		p.LegalName = p.Name
	}
	if p.ShortName == "" {
		p.ShortName = p.Name
	}
	if p.BrandColor == "" {
		p.BrandColor = "#6054bf"
	}
	if p.FontFamily == "" {
		p.FontFamily = "inter"
	}
	if p.FontScale == "" {
		p.FontScale = "default"
	}
	if p.LogoScale == "" {
		p.LogoScale = "default"
	}
	if p.LogoDisplay == "" {
		p.LogoDisplay = "transparent"
	}
	return p
}

func defaultPublic() commonModels.Public {
	return commonModels.Public{
		Name: "CloudHouse Finance", LegalName: "CloudHouse Finance", ShortName: "CloudHouse Finance", BrandColor: "#6054bf",
		FontFamily: "inter", FontScale: "default",
		LogoScale: "default", LogoDisplay: "transparent",
	}
}

func publicByCode(ctx context.Context, code string) commonModels.Public {
	t, err := FindByCode(config.AllowCrossTenant(ctx), code)
	if err != nil {
		return defaultPublic()
	}
	return publicOf(t, commonModels.TenantLogoPath(t))
}

func publicByHost(ctx context.Context, host string) commonModels.Public {
	t, err := FindByHostLabel(config.AllowCrossTenant(ctx), host)
	if err != nil {
		return defaultPublic()
	}
	return publicOf(t, commonModels.TenantLogoPath(t))
}

func forTenant(ctx context.Context) (*commonModels.Self, error) {
	id, ok := config.TenantFromContext(ctx)
	if !ok || id == 0 {
		return nil, NewUnauthorized("no business in session")
	}
	t, err := FindTenantByID(config.AllowCrossTenant(ctx), id)
	if err != nil {
		return nil, err
	}
	return &commonModels.Self{
		Public:       publicOf(t, commonModels.TenantLogoPath(t)),
		AddressLine:  t.AddressLine,
		KMLRegNo:     t.KMLRegNo,
		ContactPhone: t.ContactPhone,
		Policy:       commonModels.PolicyOrDefault(t.Policy),
		Modules:      TenantEffectiveModules(t),
		Languages:    commonModels.TenantLanguageList(t),
		SingleBranch: t.SingleBranch,
	}, nil
}

func logoFile(ctx context.Context, code string) (path, contentType string, err error) {
	t, err := FindByCode(config.AllowCrossTenant(ctx), code)
	if err != nil {
		return "", "", NewNotFound("no logo for this business")
	}
	if t.LogoStorageKey == "" {
		return "", "", NewNotFound("no logo for this business")
	}
	f, err := findByStorageKey(config.WithTenant(ctx, t.ID), t.LogoStorageKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", "", NewNotFound("no logo for this business")
		}
		return "", "", err
	}
	return ResolvePath(config.Env.UploadsDir,
		t.ID, f.StorageKey), f.ContentType, nil
}

func GetPublicBranding(c echo.Context) error {
	return Success(c, http.StatusOK, publicByCode(auth.RequestContext(c), c.Param("code")))
}

func GetPublicBrandingByHost(c echo.Context) error {
	ctx := auth.RequestContext(c)
	host, _ := auth.RequestHostFromContext(ctx)
	return Success(c, http.StatusOK, publicByHost(ctx, host))
}

func GetPublicLogo(c echo.Context) error {
	path, contentType, err := logoFile(auth.RequestContext(c), c.Param("code"))
	if err != nil {
		return FailErr(c, err)
	}
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	c.Response().Header().Set("Cache-Control", "public, max-age=3600")
	return c.File(path)
}

func GetMyBranding(c echo.Context) error {
	rec, err := forTenant(auth.RequestContext(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func IssueConnectCode(c echo.Context) error {
	rec, err := issueConnectCode(auth.RequestContext(c))
	if err != nil {
		return FailErr(c, err)
	}
	c.Response().Header().Set("Cache-Control", "no-store")
	return Success(c, http.StatusOK, rec)
}

func RedeemConnectCode(c echo.Context) error {
	rec, err := redeemConnectCode(c.Param("code"))
	if err != nil {
		return FailErr(c, err)
	}
	c.Response().Header().Set("Cache-Control", "no-store")
	return Success(c, http.StatusOK, rec)
}

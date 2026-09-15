package superadmin

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/upload"
)

// HTTP surface for the branding and entitlement levers in profile.go.
//
// Same assumption as handler.go: SuperAdminAuthMiddleware has already run and
// is the ONLY gate — no CRUDPermissions appears here, because no grant inside
// a tenant may ever reach these. Every request carries a mandatory reason,
// which the service (not this file) enforces.

type updateProfileRequest struct {
	Name        string `json:"name"`
	LegalName   string `json:"legalName"`
	ShortName   string `json:"shortName"`
	AddressLine string `json:"addressLine"`
	KMLRegNo    string `json:"kmlRegNo"`
	AppURL      string `json:"appUrl"`
	Reason      string `json:"reason"`
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req updateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.UpdateProfile(platform.RequestContext(c), actor(c), id, ProfileInput{
		Name:        req.Name,
		LegalName:   req.LegalName,
		ShortName:   req.ShortName,
		AddressLine: req.AddressLine,
		KMLRegNo:    req.KMLRegNo,
		AppURL:      req.AppURL,
	}, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type setBrandingRequest struct {
	// Every colour/typography/logo field is "", or a value from its closed
	// set (see profile.go's knownFontFamilies etc.), or a hex colour — never
	// a pointer, because "" is a meaningful value here (reset to default),
	// not an absent one.
	BrandColor     string `json:"brandColor"`
	SecondaryColor string `json:"secondaryColor"`
	AccentColor    string `json:"accentColor"`
	SidebarColor   string `json:"sidebarColor"`
	FontFamily     string `json:"fontFamily"`
	FontScale      string `json:"fontScale"`
	LogoScale      string `json:"logoScale"`
	LogoDisplay    string `json:"logoDisplay"`
	Reason         string `json:"reason"`
}

func (h *Handler) SetBranding(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req setBrandingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.SetTheme(platform.RequestContext(c), actor(c), id, ThemeInput{
		BrandColor:     req.BrandColor,
		SecondaryColor: req.SecondaryColor,
		AccentColor:    req.AccentColor,
		SidebarColor:   req.SidebarColor,
		FontFamily:     req.FontFamily,
		FontScale:      req.FontScale,
		LogoScale:      req.LogoScale,
		LogoDisplay:    req.LogoDisplay,
	}, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// SetLogo takes multipart rather than JSON — the file field "file" and a text
// field "reason", mirroring upload.Handler.Upload's field name so there is
// one convention for uploads in this codebase rather than two.
//
// The bytes are read and validated before anything touches disk (the service
// delegates to upload.SaveBytesRecorded), so a refused file — an SVG, an
// oversized image — leaves nothing behind.
func (h *Handler) SetLogo(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		httpx.FailErr(c, ErrNoLogoFile)
		return
	}
	if fileHeader.Size > upload.MaxUploadBytes {
		httpx.FailErr(c, upload.ErrFileTooLarge)
		return
	}
	src, err := fileHeader.Open()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	defer src.Close()
	// One byte past the cap, so a file exactly at the limit passes but
	// anything larger is caught even if the declared Size lied.
	data, err := io.ReadAll(io.LimitReader(src, upload.MaxUploadBytes+1))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.SetLogo(platform.RequestContext(c), actor(c), id,
		fileHeader.Filename, data, c.PostForm("reason"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type setModulesRequest struct {
	Modules []string `json:"modules"`
	Reason  string   `json:"reason"`
}

func (h *Handler) SetModules(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req setModulesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.SetModules(platform.RequestContext(c), actor(c), id, req.Modules, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type setLanguagesRequest struct {
	Languages []string `json:"languages"`
	Reason    string   `json:"reason"`
}

func (h *Handler) SetLanguages(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req setLanguagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.SetLanguages(platform.RequestContext(c), actor(c), id, req.Languages, req.Reason)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// Catalogue exposes the closed sets the console renders its checkboxes from,
// so the list of toggleable modules and languages lives in exactly one place
// (internal/tenant) instead of being retyped in the frontend and drifting.
func (h *Handler) Catalogue(c *gin.Context) {
	httpx.Success(c, http.StatusOK, h.svc.Catalogue())
}

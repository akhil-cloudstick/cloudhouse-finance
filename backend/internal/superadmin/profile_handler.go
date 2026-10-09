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
	ShortName     string `json:"shortName"`
	LockupTagline string `json:"lockupTagline"`
	AddressLine   string `json:"addressLine"`
	KMLRegNo      string `json:"kmlRegNo"`
	ContactPhone  string `json:"contactPhone"`
	LenderAge     string `json:"lenderAge"`
	LenderPAN     string `json:"lenderPan"`
	LenderAadhaar string `json:"lenderAadhaar"`
	AppURL        string `json:"appUrl"`
	Policy        string `json:"policy"`
	Reason        string `json:"reason"`
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
		ShortName:     req.ShortName,
		LockupTagline: req.LockupTagline,
		AddressLine:   req.AddressLine,
		KMLRegNo:      req.KMLRegNo,
		ContactPhone:  req.ContactPhone,
		LenderAge:     req.LenderAge,
		LenderPAN:     req.LenderPAN,
		LenderAadhaar: req.LenderAadhaar,
		AppURL:        req.AppURL,
		Policy:        req.Policy,
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
	// "" = automatic text colour; see tenant.Tenant.NavTextColor.
	NavTextColor     string `json:"navTextColor"`
	OnBrandTextColor string `json:"onBrandTextColor"`
	// The arranged sidebar header as a JSON string; "" = classic lockup.
	HeaderLayout string `json:"headerLayout"`
	Reason       string `json:"reason"`
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

		NavTextColor:     req.NavTextColor,
		OnBrandTextColor: req.OnBrandTextColor,
		HeaderLayout:     req.HeaderLayout,
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

// ClearLogo mirrors ClearSignature: the reason rides the query string, since
// a DELETE carries no body.
func (h *Handler) ClearLogo(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.ClearLogo(platform.RequestContext(c), actor(c), id, c.Query("reason"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// SetSignature mirrors SetLogo's multipart shape: file field "file" plus a
// text field "reason".
func (h *Handler) SetSignature(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		httpx.FailErr(c, ErrNoSignatureFile)
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
	data, err := io.ReadAll(io.LimitReader(src, upload.MaxUploadBytes+1))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.SetSignature(platform.RequestContext(c), actor(c), id,
		fileHeader.Filename, data, c.PostForm("reason"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// GetSignature streams the signature image for the console's preview. The
// console fetches it with its bearer token into a blob URL — an <img src>
// pointing here directly would carry no Authorization header.
func (h *Handler) GetSignature(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	data, ct, err := h.svc.Signature(platform.RequestContext(c), id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, ct, data)
}

func (h *Handler) ClearSignature(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.ClearSignature(platform.RequestContext(c), actor(c), id, c.Query("reason"))
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

type setBranchModeRequest struct {
	SingleBranch bool   `json:"singleBranch"`
	Reason       string `json:"reason"`
}

func (h *Handler) SetBranchMode(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req setBranchModeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid input")
		return
	}
	rec, err := h.svc.SetBranchMode(platform.RequestContext(c), actor(c), id, req.SingleBranch, req.Reason)
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

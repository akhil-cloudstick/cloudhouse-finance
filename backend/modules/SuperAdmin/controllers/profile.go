package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/SuperAdmin/models"
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/labstack/echo/v4"
)

var brandColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

var (
	knownFontFamilies = []string{"inter", "system", "lora", "poppins"}
	knownFontScales   = []string{"compact", "default", "comfortable"}
	knownLogoScales   = []string{"small", "default", "large", "xlarge"}
	knownLogoDisplays = []string{"transparent", "light-pad", "dark-pad"}
)

const maxSignatureBytes = 1 << 20

type ProfileInput struct {
	Name          string
	LegalName     string
	ShortName     string
	LockupTagline string
	AppURL        string
	Policy        string
}

type ThemeInput struct {
	BrandColor       string
	SecondaryColor   string
	AccentColor      string
	SidebarColor     string
	FontFamily       string
	FontScale        string
	LogoScale        string
	LogoDisplay      string
	NavTextColor     string
	OnBrandTextColor string
	HeaderLayout     string
}

type PolicyOption struct {
	Code      string   `json:"code"`
	Label     string   `json:"label"`
	Languages []string `json:"languages"`
}

type CatalogueResponse struct {
	Modules   []string       `json:"modules"`
	Languages []string       `json:"languages"`
	Policies  []PolicyOption `json:"policies"`
}

type updateProfileRequest struct {
	Name          string `json:"name"`
	LegalName     string `json:"legal_name"`
	ShortName     string `json:"short_name"`
	LockupTagline string `json:"lockup_tagline"`
	AppURL        string `json:"app_url"`
	Policy        string `json:"policy"`
	Reason        string `json:"reason"`
}

type setBrandingRequest struct {
	BrandColor       string `json:"brand_color"`
	SecondaryColor   string `json:"secondary_color"`
	AccentColor      string `json:"accent_color"`
	SidebarColor     string `json:"sidebar_color"`
	FontFamily       string `json:"font_family"`
	FontScale        string `json:"font_scale"`
	LogoScale        string `json:"logo_scale"`
	LogoDisplay      string `json:"logo_display"`
	NavTextColor     string `json:"nav_text_color"`
	OnBrandTextColor string `json:"on_brand_text_color"`
	HeaderLayout     string `json:"header_layout"`
	Reason           string `json:"reason"`
}

type setModulesRequest struct {
	Modules []string `json:"modules"`
	Reason  string   `json:"reason"`
}

type setBranchModeRequest struct {
	SingleBranch bool   `json:"single_branch"`
	Reason       string `json:"reason"`
}

type setLanguagesRequest struct {
	Languages []string `json:"languages"`
	Reason    string   `json:"reason"`
}

func updateProfile(ctx context.Context, actor *models.SuperAdminUser, id uint, in ProfileInput, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, common.NewBadRequest("business name is required")
	}
	beforeName := t.Name
	t.Name = name
	t.LegalName = strings.TrimSpace(in.LegalName)
	t.ShortName = strings.TrimSpace(in.ShortName)
	t.LockupTagline = strings.TrimSpace(in.LockupTagline)
	t.AppURL = strings.TrimSpace(in.AppURL)
	beforePolicy := commonModels.PolicyOrDefault(t.Policy)
	beforeLanguages := t.DocumentLanguages
	common.SetTenantPolicy(t, in.Policy)
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	detail := fmt.Sprintf("legalName=%q appUrl=%q policy=%q", t.LegalName, t.AppURL, t.Policy)
	if beforePolicy != t.Policy {
		detail += fmt.Sprintf("; policy: %s -> %s (languages: %s -> %s)",
			beforePolicy, t.Policy, beforeLanguages, t.DocumentLanguages)
	}
	if beforeName != t.Name {
		detail = fmt.Sprintf("name: %s -> %s; ", beforeName, t.Name) + detail
	}
	auditBusiness(ctx, actor, "update_profile", &t.ID, t.Name, detail, reason)
	return t, nil
}

func oneOf(value string, allowed []string) bool {
	if value == "" {
		return true
	}
	for _, a := range allowed {
		if value == a {
			return true
		}
	}
	return false
}

func setTheme(ctx context.Context, actor *models.SuperAdminUser, id uint, in ThemeInput, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	primary := strings.TrimSpace(strings.ToLower(in.BrandColor))
	secondary := strings.TrimSpace(strings.ToLower(in.SecondaryColor))
	accent := strings.TrimSpace(strings.ToLower(in.AccentColor))
	sidebar := strings.TrimSpace(strings.ToLower(in.SidebarColor))
	navText := strings.TrimSpace(strings.ToLower(in.NavTextColor))
	onBrandText := strings.TrimSpace(strings.ToLower(in.OnBrandTextColor))
	for _, c := range []string{primary, secondary, accent, sidebar, navText, onBrandText} {
		if c != "" && !brandColorPattern.MatchString(c) {
			return nil, common.NewBadRequest("brand colour must be a hex value like #6054bf")
		}
	}
	fontFamily := strings.TrimSpace(strings.ToLower(in.FontFamily))
	fontScale := strings.TrimSpace(strings.ToLower(in.FontScale))
	logoScale := strings.TrimSpace(strings.ToLower(in.LogoScale))
	logoDisplay := strings.TrimSpace(strings.ToLower(in.LogoDisplay))
	if !oneOf(fontFamily, knownFontFamilies) {
		return nil, common.NewBadRequest("unknown font family")
	}
	if !oneOf(fontScale, knownFontScales) {
		return nil, common.NewBadRequest("unknown font scale")
	}
	if !oneOf(logoScale, knownLogoScales) {
		return nil, common.NewBadRequest("unknown logo scale")
	}
	if !oneOf(logoDisplay, knownLogoDisplays) {
		return nil, common.NewBadRequest("unknown logo display")
	}
	headerLayout, err := normalizeHeaderLayout(in.HeaderLayout)
	if err != nil {
		return nil, err
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	before := fmt.Sprintf("brand=%s secondary=%s accent=%s sidebar=%s font=%s/%s logo=%s/%s text=%s/%s header=%s",
		orDefault(t.BrandColor), orDefault(t.SecondaryColor), orDefault(t.AccentColor), orDefault(t.SidebarColor),
		orDefault(t.FontFamily), orDefault(t.FontScale), orDefault(t.LogoScale), orDefault(t.LogoDisplay),
		orDefault(t.NavTextColor), orDefault(t.OnBrandTextColor), orDefault(t.HeaderLayout))
	t.BrandColor = primary
	t.SecondaryColor = secondary
	t.AccentColor = accent
	t.SidebarColor = sidebar
	t.FontFamily = fontFamily
	t.FontScale = fontScale
	t.LogoScale = logoScale
	t.LogoDisplay = logoDisplay
	t.NavTextColor = navText
	t.OnBrandTextColor = onBrandText
	t.HeaderLayout = headerLayout
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	after := fmt.Sprintf("brand=%s secondary=%s accent=%s sidebar=%s font=%s/%s logo=%s/%s text=%s/%s header=%s",
		orDefault(t.BrandColor), orDefault(t.SecondaryColor), orDefault(t.AccentColor), orDefault(t.SidebarColor),
		orDefault(t.FontFamily), orDefault(t.FontScale), orDefault(t.LogoScale), orDefault(t.LogoDisplay),
		orDefault(t.NavTextColor), orDefault(t.OnBrandTextColor), orDefault(t.HeaderLayout))
	auditBusiness(ctx, actor, "set_branding", &t.ID, t.Name,
		fmt.Sprintf("theme: %s -> %s", before, after), reason)
	return t, nil
}

func orDefault(s string) string {
	if s == "" {
		return "default"
	}
	return s
}

func setLogo(ctx context.Context, actor *models.SuperAdminUser, id uint, filename string, data []byte, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	if len(data) == 0 {
		return nil, common.NewBadRequest("no logo file provided (expected multipart field \"file\")")
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	if config.Env.UploadsDir ==
		"" {
		return nil, common.NewBadRequest("file storage is not configured on this server")
	}
	url, err := common.SaveBytesRecorded(config.WithTenant(ctx, t.ID), config.Env.UploadsDir, filename, data)
	if err != nil {
		return nil, err
	}
	before := t.LogoStorageKey
	if before == "" {
		before = "none"
	}
	t.LogoStorageKey = strings.TrimPrefix(url, "/uploads/")
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	auditBusiness(ctx, actor, "set_logo", &t.ID, t.Name,
		fmt.Sprintf("logo: %s -> %s (%d bytes)", before, t.LogoStorageKey, len(data)), reason)
	return t, nil
}

func clearLogo(ctx context.Context, actor *models.SuperAdminUser, id uint, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	if t.LogoStorageKey == "" {
		return t, nil
	}
	before := t.LogoStorageKey
	t.LogoStorageKey = ""
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	t.LogoURL = ""
	auditBusiness(ctx, actor, "set_logo", &t.ID, t.Name,
		fmt.Sprintf("logo: %s -> none", before), reason)
	return t, nil
}

func setSignature(ctx context.Context, actor *models.SuperAdminUser, id uint, filename string, data []byte, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	if len(data) == 0 {
		return nil, common.NewBadRequest("no signature file provided (expected multipart field \"file\")")
	}
	if len(data) > maxSignatureBytes {
		return nil, common.NewBadRequest("signature image must be 1 MB or smaller")
	}
	switch common.DetectContentType(data) {
	case "image/png", "image/jpeg", "image/webp":
	default:
		return nil, common.NewBadRequest("signature must be a PNG, JPEG or WebP image")
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	if config.Env.UploadsDir ==
		"" {
		return nil, common.NewBadRequest("file storage is not configured on this server")
	}
	url, err := common.SaveBytesRecorded(config.WithTenant(ctx, t.ID), config.Env.UploadsDir, filename, data)
	if err != nil {
		return nil, err
	}
	before := t.SignatureStorageKey
	if before == "" {
		before = "none"
	}
	t.SignatureStorageKey = strings.TrimPrefix(url, "/uploads/")
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	auditBusiness(ctx, actor, "set_signature", &t.ID, t.Name,
		fmt.Sprintf("signature: %s -> %s (%d bytes)", before, t.SignatureStorageKey, len(data)), reason)
	return t, nil
}

func signatureBusiness(ctx context.Context, id uint) ([]byte, string, error) {
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, "", common.NewNotFound("business not found")
	}
	data, ct, ok := common.TenantSignatureImage(t, config.Env.UploadsDir)
	if !ok {
		return nil, "", common.NewNotFound("no signature for this business")
	}
	return data, ct, nil
}

func clearSignature(ctx context.Context, actor *models.SuperAdminUser, id uint, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	if t.SignatureStorageKey == "" {
		return t, nil
	}
	before := t.SignatureStorageKey
	t.SignatureStorageKey = ""
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	t.HasSignature = false
	auditBusiness(ctx, actor, "set_signature", &t.ID, t.Name,
		fmt.Sprintf("signature: %s -> none", before), reason)
	return t, nil
}

func setModules(ctx context.Context, actor *models.SuperAdminUser, id uint, modules []string, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	if bad := common.ValidateModules(modules); len(bad) > 0 {
		return nil, common.NewBadRequest("unknown module(s): " + strings.Join(bad, ", "))
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	before := t.EnabledModules
	if before == "" {
		before = "none"
	}
	common.SetTenantModules(t, modules)
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	after := t.EnabledModules
	if after == "" {
		after = "none"
	}
	auditBusiness(ctx, actor, "set_modules", &t.ID, t.Name,
		fmt.Sprintf("modules: %s -> %s", before, after), reason)
	return t, nil
}

func setBranchMode(ctx context.Context, actor *models.SuperAdminUser, id uint, singleBranch bool, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	if t.SingleBranch == singleBranch {
		return t, nil
	}
	t.SingleBranch = singleBranch
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	auditBusiness(ctx, actor, "set_branch_mode", &t.ID, t.Name,
		fmt.Sprintf("branch mode: %s -> %s", branchModeLabel(!singleBranch), branchModeLabel(singleBranch)), reason)
	return t, nil
}

func singleBranchFor(tier commonModels.Tier) bool {
	return tier.BranchQuota == 1
}

func branchModeLabel(single bool) string {
	if single {
		return "single"
	}
	return "multi"
}

func outsidePolicy(policy string, languages []string) []string {
	allowed := commonModels.LanguagesForPolicy(policy)
	var bad []string
	for _, code := range languages {
		ok := false
		for _, a := range allowed {
			if a == code {
				ok = true
				break
			}
		}
		if !ok {
			bad = append(bad, code)
		}
	}
	return bad
}

func setLanguages(ctx context.Context, actor *models.SuperAdminUser, id uint, languages []string, reason string) (*commonModels.Tenant, error) {
	reason = optionalReason(reason)
	if bad := common.ValidateLanguages(languages); len(bad) > 0 {
		return nil, common.NewBadRequest("unknown language(s): " + strings.Join(bad, ", "))
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	if bad := outsidePolicy(commonModels.PolicyOrDefault(t.Policy), languages); len(bad) > 0 {
		return nil, common.NewBadRequest(fmt.Sprintf(
			"language(s) not available under the %s policy: %s",
			strings.ToUpper(commonModels.PolicyOrDefault(t.Policy)), strings.Join(bad, ", ")))
	}
	before := t.DocumentLanguages
	if before == "" {
		before = commonModels.LangEnglish
	}
	common.SetTenantLanguages(t, languages)
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	auditBusiness(ctx, actor, "set_languages", &t.ID, t.Name,
		fmt.Sprintf("languages: %s -> %s", before, t.DocumentLanguages), reason)
	return t, nil
}

func catalogueBusiness() CatalogueResponse {
	policies := make([]PolicyOption, 0, len(commonModels.KnownPolicies))
	for _, code := range commonModels.KnownPolicies {
		label, ok := commonModels.PolicyLabels[code]
		if !ok {
			label = strings.ToUpper(code)
		}
		policies = append(policies, PolicyOption{
			Code:      code,
			Label:     label,
			Languages: commonModels.LanguagesForPolicy(code),
		})
	}
	return CatalogueResponse{
		Modules:   commonModels.KnownModules,
		Languages: common.KnownLanguages,
		Policies:  policies,
	}
}

func optionalReason(reason string) string {
	if strings.TrimSpace(reason) == "" {
		return "(none given)"
	}
	return reason
}

func UpdateSuperAdminProfile(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req updateProfileRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	rec, err := updateProfile(auth.RequestContext(c), actor(c), id, ProfileInput{
		Name:          req.Name,
		LegalName:     req.LegalName,
		ShortName:     req.ShortName,
		LockupTagline: req.LockupTagline,
		AppURL:        req.AppURL,
		Policy:        req.Policy,
	}, req.Reason)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SetBranding(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req setBrandingRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	rec, err := setTheme(auth.RequestContext(c), actor(c), id, ThemeInput{
		BrandColor:       req.BrandColor,
		SecondaryColor:   req.SecondaryColor,
		AccentColor:      req.AccentColor,
		SidebarColor:     req.SidebarColor,
		FontFamily:       req.FontFamily,
		FontScale:        req.FontScale,
		LogoScale:        req.LogoScale,
		LogoDisplay:      req.LogoDisplay,
		NavTextColor:     req.NavTextColor,
		OnBrandTextColor: req.OnBrandTextColor,
		HeaderLayout:     req.HeaderLayout,
	}, req.Reason)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SetLogo(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return common.FailErr(c, common.NewBadRequest("no logo file provided (expected multipart field \"file\")"))
	}
	if fileHeader.Size > common.MaxUploadBytes {
		return common.FailErr(c, common.NewBadRequest("file is too large (maximum 10 MB)"))
	}
	src, err := fileHeader.Open()
	if err != nil {
		return common.FailErr(c, err)
	}
	defer src.Close()
	data, err := io.ReadAll(io.LimitReader(src, common.MaxUploadBytes+1))
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := setLogo(auth.RequestContext(c), actor(c), id,
		fileHeader.Filename, data, c.FormValue("reason"))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ClearLogo(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := clearLogo(auth.RequestContext(c), actor(c), id, c.QueryParam("reason"))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SetSignature(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return common.FailErr(c, common.NewBadRequest("no signature file provided (expected multipart field \"file\")"))
	}
	if fileHeader.Size > common.MaxUploadBytes {
		return common.FailErr(c, common.NewBadRequest("file is too large (maximum 10 MB)"))
	}
	src, err := fileHeader.Open()
	if err != nil {
		return common.FailErr(c, err)
	}
	defer src.Close()
	data, err := io.ReadAll(io.LimitReader(src, common.MaxUploadBytes+1))
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := setSignature(auth.RequestContext(c), actor(c), id,
		fileHeader.Filename, data, c.FormValue("reason"))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetSignature(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	data, ct, err := signatureBusiness(auth.RequestContext(c), id)
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Cache-Control", "no-store")
	return c.Blob(http.StatusOK, ct, data)
}

func ClearSignature(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := clearSignature(auth.RequestContext(c), actor(c), id, c.QueryParam("reason"))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SetModules(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req setModulesRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	rec, err := setModules(auth.RequestContext(c), actor(c), id, req.Modules, req.Reason)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SetBranchMode(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req setBranchModeRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	rec, err := setBranchMode(auth.RequestContext(c), actor(c), id, req.SingleBranch, req.Reason)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SetLanguages(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req setLanguagesRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	rec, err := setLanguages(auth.RequestContext(c), actor(c), id, req.Languages, req.Reason)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetCatalogue(c echo.Context) error {
	return common.Success(c, http.StatusOK, catalogueBusiness())
}

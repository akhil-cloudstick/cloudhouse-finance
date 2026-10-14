package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"encoding/base64"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gorilla/websocket"
)

var (
	qrSessions       = newQRStore()
	brandingConnects = newConnectStore()
	notificationHub  = NewHub()
	socketUpgrader   = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
)

var (
	BankBalances     func(ctx context.Context, branchID *uint) (map[uint]float64, float64, error)
	LoansForCustomer func(ctx context.Context, customerID uint) ([]LoanSummary, error)
	HardDeleteLoan   func(ctx context.Context, loanID uint) error
)

func init() {
	auth.IsAllowed = IsAllowed
	auth.CurrentSession = CurrentSession
	auth.HasModule = HasModule
	auth.TenantIDForHost = TenantIDForHost
	auth.SingleBranchHeadOffice = SingleBranchHeadOffice
	config.AfterSetup(func() {
		SetBaseDomain(config.Env.BaseDomain)
		config.WhatsApp = config.NewOpenWASender(whatsappConfig)
	})
}

// WhatsAppServerConfig is the server-wide OpenWA connection (origin + API key +
// the shared session). Per-business sessions are layered on top by whatsappConfig.
func WhatsAppServerConfig() (config.WhatsAppConfig, error) {
	if config.Env.WhatsAppAPIKey != "" {
		return config.WhatsAppConfig{
			BaseURL:   config.Env.WhatsAppOrigin,
			APIKey:    config.Env.WhatsAppAPIKey,
			SessionID: config.Env.WhatsAppSessionID,
		}, nil
	}
	view, err := GetSettings(config.AllowCrossTenant(context.Background()), commonModels.CategoryWhatsApp)
	if err != nil {
		return config.WhatsAppConfig{}, err
	}
	if !view.IsSet {
		return config.WhatsAppConfig{}, nil
	}
	return config.ParseWhatsAppConfig(view.Value)
}

// whatsappConfig sends from the business's own connected session when it has
// one, and from the shared server session otherwise.
func whatsappConfig(ctx context.Context) (config.WhatsAppConfig, error) {
	cfg, err := WhatsAppServerConfig()
	if err != nil {
		return cfg, err
	}
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return cfg, nil
	}
	if sessionID := tenantSessionID(tenantID); sessionID != "" {
		cfg.SessionID = sessionID
	}
	return cfg, nil
}

// tenantSessionID reads on its own pinned connection, never the caller's: most
// sends run in a goroutine that outlives the request, whose connection is
// closed or still in use by the handler by then (same reason as CreateBackground).
func tenantSessionID(tenantID uint) string {
	ctx := config.WithTenant(context.Background(), tenantID)
	ctx, release, err := config.PinConn(ctx, config.BaseDB, tenantID)
	if err != nil {
		return ""
	}
	defer release()
	var sessionID string
	if err := config.NewConnPinner(config.BaseDB).WithContext(ctx).Table("whatsapp_sessions").
		Select("openwa_session_id").Where("status = ?", "ready").Limit(1).Scan(&sessionID).Error; err != nil {
		return ""
	}
	return sessionID
}

func CustomerToResponse(c *commonModels.Customer) commonModels.CustomerResponse {
	return commonModels.CustomerResponse{
		ID:                c.ID,
		Code:              c.Code,
		Name:              c.Name,
		Phone:             c.Phone,
		DOB:               c.DOB,
		Address:           c.Address,
		BranchID:          c.BranchID,
		Branch:            c.Branch,
		PhotoURL:          c.PhotoURL,
		IdentityProofURL:  c.IdentityProofURL,
		AddressProofURL:   c.AddressProofURL,
		KYCDocumentURL:    c.KYCDocumentURL,
		PAN:               c.PAN,
		AadhaarLast4:      c.AadhaarLast4,
		NomineeName:       c.NomineeName,
		NomineeRelation:   c.NomineeRelation,
		NomineePhone:      c.NomineePhone,
		KYCStatus:         c.KYCStatus,
		PANStatus:         c.PANStatus,
		AadhaarStatus:     c.AadhaarStatus,
		FatherName:        c.FatherName,
		District:          c.District,
		Taluk:             c.Taluk,
		Village:           c.Village,
		Place:             c.Place,
		PinCode:           c.PinCode,
		Age:               c.Age,
		CustomerType:      c.CustomerType,
		BankAccountName:   c.BankAccountName,
		BankAccountNumber: c.BankAccountNumber,
		BankIFSC:          c.BankIFSC,
		CreatedAt:         c.CreatedAt,
		UpdatedAt:         c.UpdatedAt,
	}
}

func validCategory(c commonModels.Category) bool {
	for _, known := range commonModels.AllCategories {
		if c == known {
			return true
		}
	}
	return false
}

func TierIsUnlimited(t commonModels.Tier) bool {
	return t.BranchQuota == commonModels.UnlimitedBranches
}

func TenantHasLanguage(t *commonModels.Tenant, code string) bool {
	if code == commonModels.LangEnglish {
		return true
	}
	if !commonModels.ContainsCSV(t.DocumentLanguages, code) {
		return false
	}
	for _, l := range commonModels.LanguagesForPolicy(t.Policy) {
		if l == code {
			return true
		}
	}
	return false
}

func TenantEffectiveModules(t *commonModels.Tenant) []string {
	mods := commonModels.TenantModuleList(t)
	if !t.SingleBranch {
		return mods
	}
	out := make([]string, 0, len(mods))
	for _, m := range mods {
		if m != commonModels.ModuleBranches {
			out = append(out, m)
		}
	}
	return out
}

func SetTenantModules(t *commonModels.Tenant, keys []string) {
	t.EnabledModules = strings.Join(commonModels.FilterKnown(strings.Join(keys, ","), commonModels.KnownModules), ",")
	commonModels.SyncTenant(t)
}

func SetTenantLanguages(t *commonModels.Tenant, codes []string) {
	t.DocumentLanguages = strings.Join(
		commonModels.FilterKnown(strings.Join(append(codes, commonModels.LangEnglish), ","), commonModels.LanguagesForPolicy(t.Policy)), ",")
	commonModels.SyncTenant(t)
}

func SetTenantPolicy(t *commonModels.Tenant, policy string) {
	t.Policy = commonModels.PolicyOrDefault(policy)
	SetTenantLanguages(t, commonModels.TenantLanguageList(t))
}

func TenantSignatureImage(t *commonModels.Tenant, uploadsRoot string) (data []byte, contentType string, ok bool) {
	if t == nil || t.SignatureStorageKey == "" || uploadsRoot == "" {
		return nil, "", false
	}
	b, err := os.ReadFile(ResolvePath(uploadsRoot, t.ID, t.SignatureStorageKey))
	if err != nil || len(b) == 0 {
		return nil, "", false
	}
	ct := http.DetectContentType(b)
	if !strings.HasPrefix(ct, "image/") {
		return nil, "", false
	}
	return b, ct, true
}

func TenantSignatureImgHTML(t *commonModels.Tenant, uploadsRoot string) template.HTML {
	data, ct, ok := TenantSignatureImage(t, uploadsRoot)
	if !ok {
		return ""
	}
	return template.HTML(`<img class="sig-img" alt="" src="data:` + ct + `;base64,` + //nolint:gosec // sniffed MIME + base64 only
		base64.StdEncoding.EncodeToString(data) + `">`)
}

func TenantDir(root string, tenantID uint) string {
	return filepath.Join(root, strconv.FormatUint(uint64(tenantID), 10))
}

func ResolveReadPath(root string, tenantID uint, key string) string {
	scoped := filepath.Join(TenantDir(root, tenantID), key)
	if _, err := os.Stat(scoped); err == nil {
		return scoped
	}
	return filepath.Join(root, key)
}

func ResolvePath(root string, tenantID uint, key string) string {
	return ResolveReadPath(root, tenantID, key)
}

// NormalizeLineBreaks turns a literal "\n" typed into a text field (and CRLF) into a real
// newline; print templates render newlines with white-space:pre-line.
func NormalizeLineBreaks(s string) string {
	s = strings.ReplaceAll(s, `\r\n`, "\n")
	s = strings.ReplaceAll(s, `\n`, "\n")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return s
}

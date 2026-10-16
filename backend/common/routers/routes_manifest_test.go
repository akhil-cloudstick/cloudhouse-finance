package routers

const (
	classProbe      = "probe"
	classCollection = "collection"
	classPublic     = "public"
	classSelf       = "self"
	classExternal   = "external"
	classGlobal     = "global"
	classSuperAdmin = "superadmin"
)

type routeSpec struct {
	class    string
	params   map[string]string
	customer bool
	why      string
}

func probe(params ...string) routeSpec {
	return routeSpec{class: classProbe, params: parseParams(params)}
}

func cprobe(params ...string) routeSpec {
	return routeSpec{class: classProbe, params: parseParams(params), customer: true}
}

func list() routeSpec { return routeSpec{class: classCollection} }

func clist(why string) routeSpec {
	return routeSpec{class: classCollection, customer: true, why: why}
}

func public(why string) routeSpec { return routeSpec{class: classPublic, why: why} }

func self(why string) routeSpec { return routeSpec{class: classSelf, why: why} }

func cself(why string) routeSpec {
	return routeSpec{class: classSelf, customer: true, why: why}
}

func external(why string, params ...string) routeSpec {
	return routeSpec{class: classExternal, params: parseParams(params), why: why}
}

func cexternal(why string, params ...string) routeSpec {
	return routeSpec{class: classExternal, params: parseParams(params), customer: true, why: why}
}

func global(why string) routeSpec { return routeSpec{class: classGlobal, why: why} }

func superAdminRoute(why string) routeSpec { return routeSpec{class: classSuperAdmin, why: why} }

func parseParams(specs []string) map[string]string {
	if len(specs) == 0 {
		return nil
	}
	out := make(map[string]string, len(specs))
	for _, s := range specs {
		name, fixture, ok := cut(s, "=")
		if !ok {
			panic("manifest: param spec must be name=table[:column], got " + s)
		}
		out[name] = fixture
	}
	return out
}

func cut(s, sep string) (before, after string, found bool) {
	for i := 0; i+len(sep) <= len(s); i++ {
		if s[i:i+len(sep)] == sep {
			return s[:i], s[i+len(sep):], true
		}
	}
	return s, "", false
}

var routeManifest = map[string]routeSpec{
	"POST /api/v1/auth/login":                                                             public("establishes the session; the AllowCrossTenant lookup in auth.Service"),
	"POST /api/v1/auth/forgot-password":                                                   public("pre-session by nature; must not reveal whether an identifier exists"),
	"POST /api/v1/auth/reset-password":                                                    public("pre-session, gated by the reset token rather than a JWT"),
	"POST /api/v1/auth/verify-reset-code":                                                 public("pre-session, gated by the reset token rather than a JWT; wrong codes are capped"),
	"POST /api/v1/auth/qr/redeem":                                                         public("pre-session; a one-time, short-lived random token from the web dashboard's QR is the credential"),
	"POST /api/v1/auth/qr/issue":                                                          self("mints a token for the caller's own employee, taken from the JWT; no identifier to substitute"),
	"POST /api/v1/webhooks/razorpay":                                                      public("Razorpay's own server; gated by webhook signature, not a JWT"),
	"GET /api/v1/auth/me":                                                                 self("returns the caller's own claims; no identifier to substitute"),
	"GET /api/v1/public/branding/:code":                                                   public("login-page branding; unknown codes return the platform default, never a 404"),
	"GET /api/v1/public/branding/:code/logo":                                              public("a public logo, resolved from the tenant row's own key rather than a caller-supplied one"),
	"GET /api/v1/public/connect/:code":                                                    public("staff-app connect code; a short-lived random code that only reveals a business code, which grants nothing"),
	"POST /api/v1/users/:user_id/branding/connect-code":                                   self("issues a connect code for the caller's own business, taken from the token; no identifier to substitute"),
	"GET /api/v1/users/:user_id/branding":                                                 self("the caller's own business's branding and grants, taken from the token; no identifier to substitute"),
	"GET /api/v1/users/:user_id/business-profile":                                         self("the caller's own business's profile, taken from the token; no identifier to substitute"),
	"PATCH /api/v1/users/:user_id/business-profile/update":                                self("edits the caller's own business's profile, taken from the token; no identifier to substitute"),
	"GET /api/v1/users/:user_id/branches":                                                 list(),
	"POST /api/v1/users/:user_id/branches":                                                list(),
	"GET /api/v1/users/:user_id/branches/switchable":                                      list(),
	"GET /api/v1/users/:user_id/branches/:id":                                             probe("id=branches"),
	"PATCH /api/v1/users/:user_id/branches/:id/update":                                    probe("id=branches"),
	"DELETE /api/v1/users/:user_id/branches/:id/delete":                                   probe("id=branches"),
	"GET /api/v1/users/:user_id/schemes":                                                  list(),
	"POST /api/v1/users/:user_id/schemes":                                                 list(),
	"GET /api/v1/users/:user_id/schemes/active":                                           list(),
	"GET /api/v1/users/:user_id/schemes/inactive":                                         list(),
	"GET /api/v1/users/:user_id/schemes/:id":                                              probe("id=schemes"),
	"PATCH /api/v1/users/:user_id/schemes/:id/update":                                     probe("id=schemes"),
	"DELETE /api/v1/users/:user_id/schemes/:id/delete":                                    probe("id=schemes"),
	"POST /api/v1/users/:user_id/schemes/:id/calculate":                                   probe("id=schemes"),
	"POST /api/v1/users/:user_id/schemes/:id/toggle-active":                               probe("id=schemes"),
	"GET /api/v1/users/:user_id/gold-rates":                                               list(),
	"POST /api/v1/users/:user_id/gold-rates":                                              list(),
	"GET /api/v1/users/:user_id/gold-rates/latest":                                        list(),
	"GET /api/v1/users/:user_id/gold-rates/:id":                                           probe("id=gold_rates"),
	"GET /api/v1/users/:user_id/purity-standards":                                         list(),
	"POST /api/v1/users/:user_id/purity-standards":                                        list(),
	"GET /api/v1/users/:user_id/employees":                                                list(),
	"POST /api/v1/users/:user_id/employees":                                               list(),
	"GET /api/v1/users/:user_id/employees/:id":                                            probe("id=employees"),
	"PATCH /api/v1/users/:user_id/employees/:id/update":                                   probe("id=employees"),
	"DELETE /api/v1/users/:user_id/employees/:id/delete":                                  probe("id=employees"),
	"GET /api/v1/users/:user_id/cash-movements":                                           list(),
	"GET /api/v1/users/:user_id/cash-movements/loan-sources":                              list(),
	"POST /api/v1/users/:user_id/cash-movements":                                          list(),
	"POST /api/v1/users/:user_id/cash-movements/self-transfer":                            list(),
	"GET /api/v1/users/:user_id/categories":                                               list(),
	"POST /api/v1/users/:user_id/categories":                                              list(),
	"GET /api/v1/users/:user_id/cash-movements/export":                                    list(),
	"GET /api/v1/users/:user_id/cash-movements/:id":                                       probe("id=cash_movements"),
	"PATCH /api/v1/users/:user_id/cash-movements/:id/status":                              probe("id=cash_movements"),
	"PATCH /api/v1/users/:user_id/cash-movements/:id/update":                              probe("id=cash_movements"),
	"GET /api/v1/users/:user_id/expenses":                                                 list(),
	"POST /api/v1/users/:user_id/expenses":                                                list(),
	"GET /api/v1/users/:user_id/expenses/:id":                                             probe("id=expenses"),
	"GET /api/v1/users/:user_id/expenses/export":                                          list(),
	"PATCH /api/v1/users/:user_id/expenses/:id/approve":                                   probe("id=expenses"),
	"PATCH /api/v1/users/:user_id/expenses/:id/reject":                                    probe("id=expenses"),
	"PATCH /api/v1/users/:user_id/expenses/:id/update":                                    probe("id=expenses"),
	"GET /api/v1/users/:user_id/cash/opening-balance":                                     list(),
	"POST /api/v1/users/:user_id/cash/opening-balance":                                    list(),
	"GET /api/v1/users/:user_id/cash/summary":                                             list(),
	"GET /api/v1/users/:user_id/gold-sales":                                               list(),
	"POST /api/v1/users/:user_id/gold-sales":                                              list(),
	"GET /api/v1/users/:user_id/gold-sales/:id":                                           probe("id=gold_sales"),
	"GET /api/v1/users/:user_id/integrations/whatsapp":                                    self("addresses only the caller's own business WhatsApp session; no record id"),
	"GET /api/v1/users/:user_id/integrations/whatsapp/qr":                                 self("addresses only the caller's own business WhatsApp session; no record id"),
	"POST /api/v1/users/:user_id/integrations/whatsapp/connect":                           self("addresses only the caller's own business WhatsApp session; no record id"),
	"POST /api/v1/users/:user_id/integrations/whatsapp/pairing-code":                      self("addresses only the caller's own business WhatsApp session; no record id"),
	"POST /api/v1/users/:user_id/integrations/whatsapp/disconnect":                        self("addresses only the caller's own business WhatsApp session; no record id"),
	"GET /api/v1/users/:user_id/settings/api-keys":                                        list(),
	"GET /api/v1/users/:user_id/settings/api-keys/:category":                              list(),
	"PATCH /api/v1/users/:user_id/settings/api-keys/:category/update":                     list(),
	"DELETE /api/v1/users/:user_id/settings/api-keys/:category/delete":                    list(),
	"GET /api/v1/users/:user_id/customers":                                                list(),
	"POST /api/v1/users/:user_id/customers":                                               list(),
	"GET /api/v1/users/:user_id/customers/:id":                                            probe("id=customers"),
	"PATCH /api/v1/users/:user_id/customers/:id/update":                                   probe("id=customers"),
	"DELETE /api/v1/users/:user_id/customers/:id/hard-delete":                             probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/profile360":                                 probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/loans":                                      probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/ornaments":                                  probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/payments":                                   probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/bank-pledges":                               probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/auction-history":                            probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/personal-loans":                             probe("id=customers"),
	"GET /api/v1/users/:user_id/customers/:id/aadhaar-full":                               probe("id=customers"),
	"POST /api/v1/users/:user_id/customers/:id/verify-pan":                                external("calls Setu PAN verification against a live provider account", "id=customers"),
	"POST /api/v1/users/:user_id/customers/:id/verify-aadhaar/start":                      external("starts a Setu DigiLocker/OKYC session against a live provider account", "id=customers"),
	"POST /api/v1/users/:user_id/customers/:id/verify-aadhaar/check":                      external("polls a live Setu session", "id=customers"),
	"GET /api/v1/users/:user_id/loans":                                                    list(),
	"POST /api/v1/users/:user_id/loans":                                                   list(),
	"GET /api/v1/users/:user_id/loans/:id":                                                probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/pledge-slip":                                    probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/next-number":                                        self("next number in the caller's own business sequence, taken from the token; no identifier to substitute"),
	"GET /api/v1/users/:user_id/loans/:id/approvals":                                      probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/statement":                                      probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/statement-receipt":                              probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/auction":                                        probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/auction/history":                                probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/bank-pledge/history":                            probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/approve":                                       probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/payments":                                      probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/ornaments":                                     probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/complete-release":                              probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/extension-request":                             probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/release-request":                               probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/bank-pledge":                                   probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/auction/eligible":                              probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/auction/decision":                              probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/auction/schedule":                              probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/auction/sale":                                  probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/auction/settle":                                probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/auction/notice":                                external("an auction notice is a legal notice sent to a real borrower over WhatsApp/SMS", "id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/indemnity-bond/esign/status":                    probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/indemnity-bond/pdf":                             probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/indemnity-bond/preview-pdf":                        self("renders a PDF purely from the posted draft in the request body; it reads no stored row, so there is no identifier to substitute"),
	"POST /api/v1/users/:user_id/loans/:id/indemnity-bond/esign/start":                    external("starts a Setu Aadhaar eSign transaction", "id=loans"),
	"PATCH /api/v1/users/:user_id/loans/:id/bank-pledge/:pledge_id/release":               probe("id=loans", "pledgeId=bank_pledge_records"),
	"PATCH /api/v1/users/:user_id/loans/:id/bank-pledge/:pledge_id/void":                  probe("id=loans", "pledgeId=bank_pledge_records"),
	"GET /api/v1/users/:user_id/loans/by-number/:loan_number":                             probe("loan_number=loans:loan_number"),
	"GET /api/v1/users/:user_id/loans/interest-collected":                                 list(),
	"GET /api/v1/users/:user_id/loans/risk-assessment":                                    list(),
	"GET /api/v1/users/:user_id/loans/bank-pledges/history":                               list(),
	"GET /api/v1/users/:user_id/loans/auctions/concluded":                                 list(),
	"GET /api/v1/users/:user_id/loans/auctions/decisions/pending":                         list(),
	"GET /api/v1/users/:user_id/loans/requests":                                           list(),
	"GET /api/v1/users/:user_id/loans/drafts":                                             list(),
	"POST /api/v1/users/:user_id/loans/drafts":                                            list(),
	"GET /api/v1/users/:user_id/loans/drafts/:draft_id":                                   probe("draft_id=loan_drafts"),
	"PATCH /api/v1/users/:user_id/loans/drafts/:draft_id/update":                          probe("draft_id=loan_drafts"),
	"DELETE /api/v1/users/:user_id/loans/drafts/:draft_id/delete":                         probe("draft_id=loan_drafts"),
	"PATCH /api/v1/users/:user_id/loans/:id":                                              probe("id=loans"),
	"DELETE /api/v1/users/:user_id/loans/:id/hard-delete":                                 probe("id=loans"),
	"DELETE /api/v1/users/:user_id/loans/ornaments/:ornament_id/delete":                   probe("ornament_id=ornaments"),
	"POST /api/v1/users/:user_id/loans/requests/:request_id/release-payment":              probe("request_id=loan_requests"),
	"PATCH /api/v1/users/:user_id/loans/ornaments/:ornament_id/update":                    probe("ornament_id=ornaments"),
	"POST /api/v1/users/:user_id/loans/ornaments/:ornament_id/images":                     probe("ornament_id=ornaments"),
	"POST /api/v1/users/:user_id/loans/ornaments/:ornament_id/purity-test":                probe("ornament_id=ornaments"),
	"POST /api/v1/users/:user_id/loans/requests/:request_id/approve":                      probe("request_id=loan_requests"),
	"PATCH /api/v1/users/:user_id/loans/requests/:request_id/decide":                      probe("request_id=loan_requests"),
	"PATCH /api/v1/users/:user_id/loans/requests/:request_id/verify":                      probe("request_id=loan_requests"),
	"GET /api/v1/users/:user_id/personal-loans":                                           list(),
	"POST /api/v1/users/:user_id/personal-loans":                                          list(),
	"GET /api/v1/users/:user_id/personal-loans/:id":                                       probe("id=personal_loans"),
	"GET /api/v1/users/:user_id/personal-loans/by-number/:number":                         probe("number=personal_loans:loan_number"),
	"GET /api/v1/users/:user_id/personal-loans/:id/schedule":                              probe("id=personal_loans"),
	"GET /api/v1/users/:user_id/personal-loans/:id/payments":                              probe("id=personal_loans"),
	"POST /api/v1/users/:user_id/personal-loans/:id/payments":                             probe("id=personal_loans"),
	"POST /api/v1/users/:user_id/personal-loans/:id/renewal-preview":                      probe("id=personal_loans"),
	"POST /api/v1/users/:user_id/personal-loans/:id/renew":                                probe("id=personal_loans"),
	"GET /api/v1/users/:user_id/personal-loans/:id/bond":                                  probe("id=personal_loans"),
	"GET /api/v1/users/:user_id/dashboard/needs-attention":                                list(),
	"GET /api/v1/users/:user_id/dashboard/summary":                                        list(),
	"GET /api/v1/users/:user_id/dashboard/activity":                                       list(),
	"GET /api/v1/users/:user_id/dashboard/snapshots":                                      list(),
	"GET /api/v1/users/:user_id/dashboard/snapshots/latest":                               list(),
	"POST /api/v1/users/:user_id/uploads":                                                 list(),
	"GET /uploads/:key":                                                                   probe("key=uploaded_files:storage_key"),
	"GET /api/v1/users/:user_id/ornament-types":                                           list(),
	"POST /api/v1/users/:user_id/ornament-types":                                          list(),
	"GET /api/v1/users/:user_id/banks":                                                    list(),
	"POST /api/v1/users/:user_id/banks":                                                   list(),
	"GET /api/v1/users/:user_id/lockers":                                                  list(),
	"POST /api/v1/users/:user_id/lockers":                                                 list(),
	"GET /api/v1/users/:user_id/lockers/:id":                                              probe("id=lockers"),
	"PATCH /api/v1/users/:user_id/lockers/:id/update":                                     probe("id=lockers"),
	"DELETE /api/v1/users/:user_id/lockers/:id/delete":                                    probe("id=lockers"),
	"GET /api/v1/users/:user_id/packets":                                                  list(),
	"GET /api/v1/users/:user_id/packets/:id":                                              probe("id=packets"),
	"GET /api/v1/users/:user_id/packets/:id/movements":                                    probe("id=packets"),
	"POST /api/v1/users/:user_id/packets/:id/movements":                                   probe("id=packets"),
	"GET /api/v1/users/:user_id/packets/by-code/:code":                                    probe("code=packets:code"),
	"GET /api/v1/users/:user_id/reminders":                                                list(),
	"POST /api/v1/users/:user_id/reminders":                                               list(),
	"GET /api/v1/users/:user_id/reminders/calendar":                                       list(),
	"GET /api/v1/users/:user_id/reminders/:id":                                            probe("id=reminders"),
	"PATCH /api/v1/users/:user_id/reminders/:id/update":                                   probe("id=reminders"),
	"DELETE /api/v1/users/:user_id/reminders/:id/delete":                                  probe("id=reminders"),
	"PATCH /api/v1/users/:user_id/reminders/:id/complete":                                 probe("id=reminders"),
	"PATCH /api/v1/users/:user_id/reminders/:id/send-whatsapp":                            external("sends a WhatsApp message to a real borrower", "id=reminders"),
	"GET /api/v1/users/:user_id/investment-plans":                                         list(),
	"POST /api/v1/users/:user_id/investment-plans":                                        list(),
	"GET /api/v1/users/:user_id/investment-plans/:id":                                     probe("id=investment_plans"),
	"PATCH /api/v1/users/:user_id/investment-plans/:id/update":                            probe("id=investment_plans"),
	"GET /api/v1/users/:user_id/investments":                                              list(),
	"POST /api/v1/users/:user_id/investments":                                             list(),
	"GET /api/v1/users/:user_id/investments/:id":                                          probe("id=investments"),
	"GET /api/v1/users/:user_id/investments/:id/ledger":                                   probe("id=investments"),
	"GET /api/v1/users/:user_id/investments/by-number/:number":                            probe("number=investments:investment_number"),
	"GET /api/v1/users/:user_id/investments/:id/schedule":                                 probe("id=investments"),
	"POST /api/v1/users/:user_id/investments/:id/mature":                                  probe("id=investments"),
	"POST /api/v1/users/:user_id/investments/:id/payouts/:payout_id/pay":                  probe("id=investments", "payoutId=investment_payouts"),
	"GET /api/v1/users/:user_id/customers/:id/investments":                                probe("id=customers"),
	"GET /api/v1/users/:user_id/reports/investments/deposit-register":                     list(),
	"GET /api/v1/users/:user_id/reports/investments/interest-payout-register":             list(),
	"GET /api/v1/users/:user_id/reports/investments/investor-ledger":                      list(),
	"GET /api/v1/users/:user_id/reports/investments/maturity-register":                    list(),
	"GET /api/v1/users/:user_id/reports/loans/status":                                     list(),
	"GET /api/v1/users/:user_id/reports/disbursement":                                     list(),
	"GET /api/v1/users/:user_id/reports/personal-loans":                                   list(),
	"GET /api/v1/users/:user_id/reports/interest-collection":                              list(),
	"GET /api/v1/users/:user_id/reports/payment-collection":                               list(),
	"GET /api/v1/users/:user_id/reports/outstanding-principal":                            list(),
	"GET /api/v1/users/:user_id/reports/gold-weight":                                      list(),
	"GET /api/v1/users/:user_id/reports/gold-release":                                     list(),
	"GET /api/v1/users/:user_id/reports/bank-pledge":                                      list(),
	"GET /api/v1/users/:user_id/reports/auctions":                                         list(),
	"GET /api/v1/users/:user_id/reports/loan-extensions":                                  list(),
	"GET /api/v1/users/:user_id/reports/packets":                                          list(),
	"GET /api/v1/users/:user_id/reports/expense-cashflow":                                 list(),
	"GET /api/v1/users/:user_id/reports/kyc":                                              list(),
	"GET /api/v1/users/:user_id/reports/gold-rate-history":                                list(),
	"GET /api/v1/users/:user_id/reports/employee-performance":                             list(),
	"GET /api/v1/users/:user_id/reports/communication-history":                            list(),
	"GET /api/v1/users/:user_id/reports/form-g":                                           list(),
	"GET /api/v1/users/:user_id/reports/balance-sheet":                                    list(),
	"GET /api/v1/users/:user_id/reports/profit-loss":                                      list(),
	"GET /api/v1/users/:user_id/reports/export/:key":                                      list(),
	"GET /api/v1/users/:user_id/audit-log":                                                list(),
	"GET /api/v1/users/:user_id/billing/status":                                           self("returns the caller's own business's billing status; no identifier to substitute"),
	"POST /api/v1/users/:user_id/billing/subscribe":                                       self("creates a subscription for the caller's own business only"),
	"POST /api/v1/users/:user_id/billing/confirm":                                         self("confirms the caller's own business's subscription only"),
	"POST /api/v1/users/:user_id/demo/reset":                                              self("wipes and reseeds the caller's own business only; the tenant comes from the JWT, there is no identifier to substitute"),
	"GET /api/v1/users/:user_id/roles":                                                    list(),
	"POST /api/v1/users/:user_id/roles":                                                   list(),
	"PATCH /api/v1/users/:user_id/roles/:id":                                              probe("id=roles"),
	"DELETE /api/v1/users/:user_id/roles/:id/delete":                                      probe("id=roles"),
	"GET /api/v1/users/:user_id/employees/:id/permissions":                                probe("id=employees"),
	"GET /api/v1/users/:user_id/employees/:id/permissions/by-employee":                    self("bootstrap permissions for the caller's own employee id only"),
	"PATCH /api/v1/users/:user_id/employees/:id/permissions/:role_id":                     probe("id=employees", "role_id=roles"),
	"PATCH /api/v1/users/:user_id/employees/:id/permissions/:role_id/set-all":             probe("id=employees", "role_id=roles"),
	"POST /api/v1/customer/auth/request-otp":                                              public("pre-session; the phone lookup that establishes the business"),
	"POST /api/v1/customer/auth/verify-otp":                                               public("establishes the borrower session"),
	"POST /api/v1/customer/auth/device-login":                                             public("pre-session; authenticates by device token"),
	"POST /api/v1/customer/auth/register-device":                                          public("pre-session; binds a device to a borrower"),
	"POST /api/v1/customer/auth/refresh":                                                  public("exchanges an existing borrower token"),
	"GET /api/v1/customers/:customer_id/gold-rate/latest":                                 clist("the public gold rate; read-only and not borrower-specific"),
	"GET /api/v1/customers/:customer_id/gold-rate/history":                                clist("the public gold rate; read-only and not borrower-specific"),
	"GET /api/v1/customers/:customer_id/loans":                                            clist("the caller's own loans, forced from the JWT"),
	"GET /api/v1/customers/:customer_id/loans/:id":                                        cprobe("id=loans"),
	"GET /api/v1/customers/:customer_id/loans/:id/requests":                               cprobe("id=loans"),
	"GET /api/v1/customers/:customer_id/loans/:id/payments":                               cprobe("id=loans"),
	"GET /api/v1/customers/:customer_id/loans/:id/statement":                              cprobe("id=loans"),
	"GET /api/v1/customers/:customer_id/loans/:id/indemnity-bond/esign/status":            cprobe("id=loans"),
	"POST /api/v1/customers/:customer_id/loans/:id/extension-request":                     cprobe("id=loans"),
	"POST /api/v1/customers/:customer_id/loans/:id/release-request":                       cprobe("id=loans"),
	"POST /api/v1/customers/:customer_id/loans/:id/pay/create-order":                      cexternal("opens a Razorpay order against a live account", "id=loans"),
	"POST /api/v1/customers/:customer_id/loans/:id/pay/verify":                            cexternal("verifies a live Razorpay payment signature", "id=loans"),
	"GET /api/v1/customers/:customer_id/payments":                                         clist("the caller's own payments, forced from the JWT"),
	"GET /api/v1/customers/:customer_id/payments/:payment_id/receipt":                     cprobe("payment_id=loan_payments"),
	"GET /api/v1/customers/:customer_id/notifications":                                    clist("the caller's own notifications, forced from the JWT"),
	"POST /api/v1/customers/:customer_id/notifications/:id/ack":                           cprobe("id=notifications"),
	"POST /api/v1/customers/:customer_id/notifications/:id/read":                          cprobe("id=notifications"),
	"GET /api/v1/customers/:customer_id/profile":                                          cself("the caller's own profile, forced from the JWT"),
	"GET /api/v1/customers/:customer_id/profile/aadhaar/status":                           cself("the caller's own verification state"),
	"POST /api/v1/customers/:customer_id/profile/verify-pan":                              cexternal("calls Setu PAN verification against a live provider account"),
	"POST /api/v1/customers/:customer_id/profile/aadhaar/start":                           cexternal("starts a live Setu DigiLocker/OKYC session"),
	"GET /api/v1/customer/ws":                                                             global("WebSocket upgrade; the hub is in-memory and keyed by globally unique customer id, so it has no query to filter"),
	"POST /api/v1/superadmin/login":                                                       public("pre-session; establishes the superadmin's own session, a scheme with no tenant at all"),
	"POST /api/v1/superadmin/users/:user_id/businesses":                                   superAdminRoute("creates a business; every field validated in superadmin.Service"),
	"GET /api/v1/superadmin/users/:user_id/businesses":                                    superAdminRoute("every business on the deployment, by design"),
	"GET /api/v1/superadmin/users/:user_id/businesses/:id":                                superAdminRoute("one business's admin-facing detail"),
	"POST /api/v1/superadmin/users/:user_id/businesses/:id/suspend":                       superAdminRoute("a commercial lever, never a data lock — see tenant.Tenant.CanWrite"),
	"POST /api/v1/superadmin/users/:user_id/businesses/:id/reactivate":                    superAdminRoute("reverses suspend"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/tier":                         superAdminRoute("does not re-check current usage against the new quota by design — see Service.ChangeTier"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/expiry":                       superAdminRoute("adjusts SubscriptionExpiresAt by hand"),
	"GET /api/v1/superadmin/users/:user_id/tiers":                                         superAdminRoute("the plan catalogue, identical for every business by definition"),
	"PATCH /api/v1/superadmin/users/:user_id/tiers/:id/price":                             superAdminRoute("sets a tier's Razorpay subscription price — vendor pricing, not a business's own record"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/profile":                      superAdminRoute("sets the name/legal identity printed on a business's own customer documents"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/branding":                     superAdminRoute("sets the one colour the frontend derives a business's whole palette from"),
	"DELETE /api/v1/superadmin/users/:user_id/businesses/:id/logo":                        superAdminRoute("removes one business's logo; runs under platform.WithTenant for that business"),
	"POST /api/v1/superadmin/users/:user_id/businesses/:id/logo":                          superAdminRoute("stores a logo AS that business — the write runs under platform.WithTenant, so the uploaded_files row is stamped to it, not to the vendor"),
	"POST /api/v1/superadmin/users/:user_id/businesses/:id/signature":                     superAdminRoute("stores the lender signature AS that business (platform.WithTenant), embedded on its own printed documents"),
	"GET /api/v1/superadmin/users/:user_id/businesses/:id/signature":                      superAdminRoute("streams that business's own lender signature, resolved from its tenant row — never a caller-supplied key"),
	"DELETE /api/v1/superadmin/users/:user_id/businesses/:id/signature":                   superAdminRoute("clears the lender signature pointer; documents fall back to a blank wet-ink line"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/modules":                      superAdminRoute("grants/revokes optional modules; enforced per request by platform.RequireTenantModule"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/languages":                    superAdminRoute("grants/revokes the languages a business may issue customer documents in"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/branch-mode":                  superAdminRoute("switches one business between single-branch and multi-branch"),
	"GET /api/v1/superadmin/users/:user_id/businesses/:id/admin":                          superAdminRoute("reads the business's Administrator login (never the password hash) under that business's tenant tx — see superadmin.inTenantTx"),
	"PATCH /api/v1/superadmin/users/:user_id/businesses/:id/admin":                        superAdminRoute("vendor-side reset of the Administrator's name/username/password, for an owner locked out with no phone for the SMS reset"),
	"GET /api/v1/superadmin/users/:user_id/catalogue":                                     superAdminRoute("the closed sets of toggleable modules/languages — a static vocabulary, no business's data at all"),
	"GET /api/v1/superadmin/users/:user_id/audit-log":                                     superAdminRoute("every privileged superadmin action across every business, by design — this IS the record of who saw/changed what"),
	"DELETE /api/v1/superadmin/users/:user_id/businesses/:id/delete":                      superAdminRoute("permanent hard delete of one business — every query in it is explicitly narrowed to that business id (see superadmin.hardDeletePredicate)"),
	"GET /api/v1/superadmin/users/:user_id/businesses/:id/overview":                       superAdminRoute("one business's details, plan usage counts and recent superadmin activity"),
	"GET /api/v1/superadmin/users/:user_id/businesses/:id/payments":                       superAdminRoute("hand-recorded plan payments for one business — information only"),
	"POST /api/v1/superadmin/users/:user_id/businesses/:id/payments":                      superAdminRoute("records a plan payment by hand; changes no status, plan or expiry"),
	"DELETE /api/v1/superadmin/users/:user_id/businesses/:id/payments/:payment_id/delete": superAdminRoute("removes a mistaken payment record; audited with a reason"),
	"GET /api/v1/users/:user_id/branches/quota":                                           self("the caller's own plan and active-branch count; the tenant comes only from the session, there is no parameter to point it elsewhere"),
	"GET /api/v1/users/:user_id/banks/:id":                                                probe("id=banks"),
	"PATCH /api/v1/users/:user_id/banks/:id/update":                                       probe("id=banks"),
	"DELETE /api/v1/users/:user_id/banks/:id/delete":                                      probe("id=banks"),
	"GET /api/v1/users/:user_id/banks/:id/ledger":                                         probe("id=banks"),
	"POST /api/v1/users/:user_id/banks/:id/merge":                                         probe("id=banks"),
	"GET /api/v1/users/:user_id/cash-sources":                                             list(),
	"POST /api/v1/users/:user_id/cash-sources":                                            list(),
	"GET /api/v1/users/:user_id/cash-sources/:id":                                         probe("id=categories"),
	"GET /api/v1/users/:user_id/cash-sources/:id/ledger":                                  probe("id=categories"),
	"PATCH /api/v1/users/:user_id/cash-sources/:id/loan":                                  probe("id=categories"),
	"GET /api/v1/users/:user_id/expense-categories":                                       list(),
	"POST /api/v1/users/:user_id/expense-categories":                                      list(),
	"GET /api/v1/users/:user_id/expense-categories/:id/ledger":                            probe("id=categories"),
	"GET /api/v1/users/:user_id/cash-movements/cash-ledger":                               list(),
	"GET /api/v1/users/:user_id/cash-movements/mode-ledger":                               list(),
	"GET /api/v1/users/:user_id/cash-movements/transactions/bank/:bank_id":                probe("bank_id=banks"),
	"GET /api/v1/users/:user_id/cash-movements/transactions/bank/:bank_id/export":         probe("bank_id=banks"),
	"GET /api/v1/users/:user_id/cash-movements/transactions/branch/:id":                   probe("id=branches"),
	"GET /api/v1/users/:user_id/cash-movements/transactions/branch/:id/export":            probe("id=branches"),
	"GET /api/v1/users/:user_id/cash-movements/transactions/customer/:customer_id":        probe("customer_id=customers"),
	"GET /api/v1/users/:user_id/cash-movements/transactions/customer/:customer_id/export": probe("customer_id=customers"),
	"GET /api/v1/users/:user_id/loans/:id/ledger":                                         probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/topups":                                         probe("id=loans"),
	"POST /api/v1/users/:user_id/loans/:id/topup":                                         probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/:id/release-agreement/pdf":                          probe("id=loans"),
	"GET /api/v1/users/:user_id/loans/requests/:request_id/partial-release-receipt/pdf":   probe("request_id=loan_requests"),
	"GET /api/v1/users/:user_id/personal-loans/:id/history":                               probe("id=personal_loans"),
	"GET /api/v1/users/:user_id/approval-workflow":                                        list(),
	"GET /api/v1/users/:user_id/approval-workflow/categories":                             list(),
	"PATCH /api/v1/users/:user_id/approval-workflow/categories/:category/update":          list(),
	"POST /api/v1/users/:user_id/loans/topups/:top_up_id/approve":                         probe("top_up_id=loan_top_ups"),
	"POST /api/v1/users/:user_id/personal-loans/:id/approve":                              probe("id=personal_loans"),
	"GET /api/v1/users/:user_id/personal-loans/:id/approvals":                             probe("id=personal_loans"),
	"GET /api/v1/users/:user_id/schemes/:id/statement":                                    probe("id=schemes"),
	"GET /api/v1/users/:user_id/investments/:id/transactions":                             probe("id=investments"),
	"GET /api/v1/users/:user_id/investments/:id/bond/pdf":                                 probe("id=investments"),
	"GET /api/v1/users/:user_id/investments/:id/statement/pdf":                            probe("id=investments"),
	"POST /api/v1/users/:user_id/investments/:id/add-cash":                                probe("id=investments"),
	"POST /api/v1/users/:user_id/investments/:id/withdraw":                                probe("id=investments"),
	"GET /api/v1/public/branding":                                                         public("host-resolved login branding — the business is picked from the Host header, which may only narrow, never authorise (see tenant.FindByAppURL)"),
}

const whatsAppProxyWhy = "reverse proxy to the shared OpenWA dashboard; no tenant table, but NO app-level auth — relies on OpenWA's own login (see whatsAppProxyWhy)"

func init() {
	for _, m := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE", "PROPFIND", "REPORT"} {
		routeManifest[m+" /admin/whatsapp"] = global(whatsAppProxyWhy)
		routeManifest[m+" /admin/whatsapp/*"] = global(whatsAppProxyWhy)
	}
}

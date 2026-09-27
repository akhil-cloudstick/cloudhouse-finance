package app

// The route manifest: every HTTP route this server mounts, classified by how
// its tenant isolation is proven.
//
// WHY THIS FILE EXISTS. Two cross-tenant leaks have already shipped in this
// codebase, both silent, both with every test green:
//
//   - db.Table("loans l") put the ALIAS in Statement.Table, so the tenant
//     filter looked up a table named "l", decided it was not tenant-owned,
//     and returned every business's rows with no predicate and no error.
//   - uploaded_files had a tenant_id column but was never added to
//     tenantScopedTables, so one business could read another's customer
//     photos and KYC documents.
//
// Neither was a logic error a reviewer would spot. Both were an ENDPOINT
// nobody had checked. So the defence is not more careful review, it is a list
// that cannot be left incomplete: TestEveryRouteIsClassified fails when a
// route is mounted that does not appear below, and fails when an entry below
// no longer matches a mounted route. Adding an endpoint therefore forces a
// decision about its isolation, at compile-and-test time, from someone who
// still remembers what the endpoint does.
//
// A route is never silently "fine". It is one of the classes below, with a
// reason.

// Isolation classes.
const (
	// classProbe — the path carries an identifier for a tenant-owned record.
	// Proven by requesting ANOTHER business's identifier and requiring a
	// refusal. This is the strongest class and the one that catches leaks.
	classProbe = "probe"

	// classCollection — no identifier in the path; the response is a list or
	// aggregate drawn from tenant-owned tables. Proven by seeding
	// recognisable rows in another business and requiring that none of them
	// appear in the response body.
	classCollection = "collection"

	// classPublic — reachable without authentication by design (login,
	// password reset, borrower OTP). There is no session to scope, and the
	// handlers that establish one are the deliberate AllowCrossTenant
	// exemptions. Not probeable; asserted to be unauthenticated instead.
	classPublic = "public"

	// classSelf — authenticated, but addresses only the caller's own session
	// or profile. There is no identifier to substitute, so a cross-tenant
	// request is not expressible. Covered by the token tests instead.
	classSelf = "self"

	// classExternal — carries an identifier, but the handler calls a
	// third-party provider (Setu KYC/eSign, Razorpay, WhatsApp). Probing it
	// would send real requests, real messages, or real money on someone
	// else's account, so it is EXCLUDED FROM AUTOMATED PROBING and must be
	// checked by hand. This class is a debt, not a clearance — keep it small
	// and see TestExternalRoutesAreProbedByHand for the standing list.
	classExternal = "external"

	// classGlobal — touches no tenant-owned table (the WebSocket upgrade).
	classGlobal = "global"

	// classSuperAdmin — mounted under /superadmin, gated ONLY by
	// platform.SuperAdminAuthMiddleware, never by CRUDPermissions. These routes
	// are SUPPOSED to see across every business — that is the superadmin
	// console's entire purpose (Step 7) — so the ordinary cross-tenant probe
	// (which treats seeing another business's data as a leak) does not apply
	// to them at all. What DOES apply, and is checked by
	// TestSuperAdminRoutesRejectStaffAndBorrowerTokens: neither a staff JWT nor a
	// borrower JWT may be accepted here, in either direction, and a superadmin
	// token must never be accepted on an ordinary staff or borrower route.
	classSuperAdmin = "superadmin"
)

// routeSpec is one manifest entry.
type routeSpec struct {
	class string

	// params maps each path parameter to the fixture that supplies its
	// value, as "table" (use that row's id) or "table:column" (use that
	// row's column, for lookups by code rather than id).
	//
	// Only meaningful for classProbe and classExternal.
	params map[string]string

	// customer marks a route on the borrower JWT scheme rather than the
	// staff one. These are the Step 5 surface.
	customer bool

	// why records the reasoning for every class except classProbe, where the
	// probe itself is the reasoning.
	why string
}

// Manifest DSL. Kept terse so the manifest reads as a table of decisions
// rather than a wall of struct literals.

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

// routeManifest is keyed "METHOD /path", exactly as gin reports it.
var routeManifest = map[string]routeSpec{
	// ---------------------------------------------------------------- auth
	// The three unauthenticated endpoints. Login is also the one query that
	// legitimately precedes a tenant, because it establishes one.
	"POST /api/v1/auth/login":           public("establishes the session; the AllowCrossTenant lookup in auth.Service"),
	"POST /api/v1/auth/forgot-password": public("pre-session by nature; must not reveal whether an identifier exists"),
	"POST /api/v1/auth/reset-password":  public("pre-session, gated by the reset token rather than a JWT"),

	// Razorpay's own server calling in, not a logged-in employee/borrower —
	// deliberately unauthenticated by the employee JWT scheme (see
	// billing.Handler.Webhook's doc comment). Its only gate is the
	// X-Razorpay-Signature check inside the handler itself, which every
	// other route classification here has nothing to do with — it cannot
	// be probed the way a JWT-gated route is.
	"POST /api/v1/webhooks/razorpay": public("Razorpay's own server; gated by webhook signature, not a JWT"),
	"GET /api/v1/auth/me":            self("returns the caller's own claims; no identifier to substitute"),

	// Branding. The two /public routes are unauthenticated by design — a
	// sign-in page must render a business's logo and colour before there is
	// a session. Neither is an enumeration oracle: an unknown code returns
	// the platform default rather than a 404, and the logo is resolved from
	// the tenant row's own LogoStorageKey, never from a key in the URL, so
	// it cannot be aimed at another business's customer documents.
	"GET /api/v1/public/branding/:code":      public("login-page branding; unknown codes return the platform default, never a 404"),
	"GET /api/v1/public/branding/:code/logo": public("a public logo, resolved from the tenant row's own key rather than a caller-supplied one"),
	"GET /api/v1/branding":                   self("the caller's own business's branding and grants, taken from the token; no identifier to substitute"),

	// ------------------------------------------------------------ branches
	"GET /api/v1/branches":  list(),
	"POST /api/v1/branches": list(),
	// The branch switcher's own list. Answers "which branches may I switch
	// between" rather than "give me this branch's data", so there is no
	// other business's record to request — it returns only the caller's own
	// business's branches regardless of role, which is asserted by
	// TestSwitchableBranchesNeverCrossBusinesses rather than the generic
	// collection probe (that probe checks against markers seeded on
	// tenant-owned business-data tables; branches is the table itself).
	"GET /api/v1/branches/switchable": list(),
	"GET /api/v1/branches/:id":        probe("id=branches"),
	"PUT /api/v1/branches/:id":        probe("id=branches"),
	"DELETE /api/v1/branches/:id":     probe("id=branches"),

	// ------------------------------------------------------------- schemes
	"GET /api/v1/schemes":                    list(),
	"POST /api/v1/schemes":                   list(),
	"GET /api/v1/schemes/active":             list(),
	"GET /api/v1/schemes/inactive":           list(),
	"GET /api/v1/schemes/:id":                probe("id=schemes"),
	"PUT /api/v1/schemes/:id":                probe("id=schemes"),
	"DELETE /api/v1/schemes/:id":             probe("id=schemes"),
	"POST /api/v1/schemes/:id/calculate":     probe("id=schemes"),
	"POST /api/v1/schemes/:id/toggle-active": probe("id=schemes"),

	// ----------------------------------------------------------- gold rates
	"GET /api/v1/gold-rates":        list(),
	"POST /api/v1/gold-rates":       list(),
	"GET /api/v1/gold-rates/latest": list(),
	"GET /api/v1/gold-rates/:id":    probe("id=gold_rates"),

	// ------------------------------------------------------ purity standards
	"GET /api/v1/purity-standards":  list(),
	"POST /api/v1/purity-standards": list(),

	// ----------------------------------------------------------- employees
	"GET /api/v1/employees":        list(),
	"POST /api/v1/employees":       list(),
	"GET /api/v1/employees/:id":    probe("id=employees"),
	"PUT /api/v1/employees/:id":    probe("id=employees"),
	"DELETE /api/v1/employees/:id": probe("id=employees"),

	// --------------------------------------------------------------- cash
	"GET /api/v1/cash-movements":              list(),
	"POST /api/v1/cash-movements":             list(),
	"GET /api/v1/cash-movements/export":       list(),
	"GET /api/v1/cash-movements/:id":          probe("id=cash_movements"),
	"PATCH /api/v1/cash-movements/:id/status": probe("id=cash_movements"),
	"GET /api/v1/expenses":                    list(),
	"POST /api/v1/expenses":                   list(),
	"GET /api/v1/expenses/:id":                probe("id=expenses"),
	"GET /api/v1/expenses/export":             list(),
	"PATCH /api/v1/expenses/:id/approve":      probe("id=expenses"),
	"PATCH /api/v1/expenses/:id/reject":       probe("id=expenses"),
	"GET /api/v1/cash/opening-balance":        list(),
	"POST /api/v1/cash/opening-balance":       list(),
	"GET /api/v1/cash/summary":                list(),
	"GET /api/v1/gold-sales":                  list(),
	"POST /api/v1/gold-sales":                 list(),
	"GET /api/v1/gold-sales/:id":              probe("id=gold_sales"),

	// ------------------------------------------------------------ settings
	// :category is an enum (whatsapp, sms, ...), not a record identifier, so
	// there is no other business's id to request — and there is deliberately
	// no isolation here either: api_key_settings has no tenant_id and one
	// global row per category, the documented shared-credentials decision.
	// TestProviderCredentialsAreDeliberatelyShared pins that, and records the
	// part the decision does not cover: every tenant's Administrator can
	// overwrite the shared credentials for everyone.
	"GET /api/v1/settings/api-keys":              list(),
	"GET /api/v1/settings/api-keys/:category":    list(),
	"PUT /api/v1/settings/api-keys/:category":    list(),
	"DELETE /api/v1/settings/api-keys/:category": list(),

	// ----------------------------------------------------------- customers
	"GET /api/v1/customers":                           list(),
	"POST /api/v1/customers":                          list(),
	"GET /api/v1/customers/:id":                       probe("id=customers"),
	"PUT /api/v1/customers/:id":                       probe("id=customers"),
	"DELETE /api/v1/customers/:id":                    probe("id=customers"),
	"DELETE /api/v1/customers/:id/hard-delete":        probe("id=customers"),
	"GET /api/v1/customers/:id/profile360":            probe("id=customers"),
	"GET /api/v1/customers/:id/loans":                 probe("id=customers"),
	"GET /api/v1/customers/:id/ornaments":             probe("id=customers"),
	"GET /api/v1/customers/:id/payments":              probe("id=customers"),
	"GET /api/v1/customers/:id/bank-pledges":          probe("id=customers"),
	"GET /api/v1/customers/:id/auction-history":       probe("id=customers"),
	"GET /api/v1/customers/:id/personal-loans":        probe("id=customers"),
	"GET /api/v1/customers/:id/aadhaar-full":          probe("id=customers"),
	"POST /api/v1/customers/:id/verify-pan":           external("calls Setu PAN verification against a live provider account", "id=customers"),
	"POST /api/v1/customers/:id/verify-aadhaar/start": external("starts a Setu DigiLocker/OKYC session against a live provider account", "id=customers"),
	"POST /api/v1/customers/:id/verify-aadhaar/check": external("polls a live Setu session", "id=customers"),

	// --------------------------------------------------------------- loans
	"GET /api/v1/loans":                                      list(),
	"POST /api/v1/loans":                                     list(),
	"GET /api/v1/loans/:id":                                  probe("id=loans"),
	"GET /api/v1/loans/:id/approvals":                        probe("id=loans"),
	"GET /api/v1/loans/:id/statement":                        probe("id=loans"),
	"GET /api/v1/loans/:id/auction":                          probe("id=loans"),
	"GET /api/v1/loans/:id/auction/history":                  probe("id=loans"),
	"GET /api/v1/loans/:id/bank-pledge/history":              probe("id=loans"),
	"POST /api/v1/loans/:id/approve":                         probe("id=loans"),
	"POST /api/v1/loans/:id/payments":                        probe("id=loans"),
	"POST /api/v1/loans/:id/ornaments":                       probe("id=loans"),
	"POST /api/v1/loans/:id/complete-release":                probe("id=loans"),
	"POST /api/v1/loans/:id/extension-request":               probe("id=loans"),
	"POST /api/v1/loans/:id/release-request":                 probe("id=loans"),
	"POST /api/v1/loans/:id/bank-pledge":                     probe("id=loans"),
	"POST /api/v1/loans/:id/auction/eligible":                probe("id=loans"),
	"POST /api/v1/loans/:id/auction/decision":                probe("id=loans"),
	"POST /api/v1/loans/:id/auction/schedule":                probe("id=loans"),
	"POST /api/v1/loans/:id/auction/sale":                    probe("id=loans"),
	"POST /api/v1/loans/:id/auction/settle":                  probe("id=loans"),
	"POST /api/v1/loans/:id/auction/notice":                  external("an auction notice is a legal notice sent to a real borrower over WhatsApp/SMS", "id=loans"),
	"GET /api/v1/loans/:id/indemnity-bond/esign/status":      probe("id=loans"),
	"GET /api/v1/loans/:id/indemnity-bond/pdf":               probe("id=loans"),
	"POST /api/v1/loans/indemnity-bond/preview-pdf":          self("renders a PDF purely from the posted draft in the request body; it reads no stored row, so there is no identifier to substitute"),
	"POST /api/v1/loans/:id/indemnity-bond/esign/start":      external("starts a Setu Aadhaar eSign transaction", "id=loans"),
	"PUT /api/v1/loans/:id/bank-pledge/:pledgeId/release":    probe("id=loans", "pledgeId=bank_pledge_records"),
	"PUT /api/v1/loans/:id/bank-pledge/:pledgeId/void":       probe("id=loans", "pledgeId=bank_pledge_records"),
	"GET /api/v1/loans/by-number/:loanNumber":                probe("loanNumber=loans:loan_number"),
	"GET /api/v1/loans/interest-collected":                   list(),
	"GET /api/v1/loans/risk-assessment":                      list(),
	"GET /api/v1/loans/bank-pledges/history":                 list(),
	"GET /api/v1/loans/auctions/concluded":                   list(),
	"GET /api/v1/loans/auctions/decisions/pending":           list(),
	"GET /api/v1/loans/requests":                             list(),
	"GET /api/v1/loans/drafts":                               list(),
	"POST /api/v1/loans/drafts":                              list(),
	"GET /api/v1/loans/drafts/:draftId":                      probe("draftId=loan_drafts"),
	"PUT /api/v1/loans/drafts/:draftId":                      probe("draftId=loan_drafts"),
	"DELETE /api/v1/loans/drafts/:draftId":                   probe("draftId=loan_drafts"),
	"PATCH /api/v1/loans/:id":                                probe("id=loans"),
	"DELETE /api/v1/loans/:id/hard-delete":                   probe("id=loans"),
	"DELETE /api/v1/loans/ornaments/:ornamentId":             probe("ornamentId=ornaments"),
	"POST /api/v1/loans/requests/:requestId/release-payment": probe("requestId=loan_requests"),
	"PUT /api/v1/loans/ornaments/:ornamentId":                probe("ornamentId=ornaments"),
	"POST /api/v1/loans/ornaments/:ornamentId/images":        probe("ornamentId=ornaments"),
	"POST /api/v1/loans/ornaments/:ornamentId/purity-test":   probe("ornamentId=ornaments"),
	"POST /api/v1/loans/requests/:requestId/approve":         probe("requestId=loan_requests"),
	"PUT /api/v1/loans/requests/:requestId/decide":           probe("requestId=loan_requests"),
	"PUT /api/v1/loans/requests/:requestId/verify":           probe("requestId=loan_requests"),
	"GET /api/v1/loans/approval-limits/loan-operator":        list(),
	"PUT /api/v1/loans/approval-limits/loan-operator":        list(),

	// -------------------------------------------------------- personal-loans
	"GET /api/v1/personal-loans":                      list(),
	"POST /api/v1/personal-loans":                     list(),
	"GET /api/v1/personal-loans/:id":                  probe("id=personal_loans"),
	"GET /api/v1/personal-loans/:id/schedule":         probe("id=personal_loans"),
	"GET /api/v1/personal-loans/:id/payments":         probe("id=personal_loans"),
	"POST /api/v1/personal-loans/:id/payments":        probe("id=personal_loans"),
	"POST /api/v1/personal-loans/:id/renewal-preview": probe("id=personal_loans"),
	"POST /api/v1/personal-loans/:id/renew":           probe("id=personal_loans"),
	"GET /api/v1/personal-loans/:id/bond":             probe("id=personal_loans"),

	// ----------------------------------------------------------- dashboard
	"GET /api/v1/dashboard/needs-attention": list(),
	"GET /api/v1/dashboard/summary":         list(),
	"GET /api/v1/dashboard/activity":        list(),
	// Snapshot IS tenant-owned. It was not: it shipped with no tenant_id, a
	// globally unique date, and a capture job under AllowCrossTenant, so one
	// row per day held every business's counts added together and every
	// business read it. Classified global here, which is why no probe caught
	// it. Both routes are ordinary per-business collections now.
	"GET /api/v1/dashboard/snapshots":        list(),
	"GET /api/v1/dashboard/snapshots/latest": list(),

	// ------------------------------------------------------------- uploads
	"POST /api/v1/uploads": list(),
	// Served from the router root, not /api/v1, and authenticated by a
	// path-scoped cookie rather than a header — an <img> tag cannot send an
	// Authorization header. The key is a storage key, not a row id.
	"GET /uploads/:key": probe("key=uploaded_files:storage_key"),

	// ------------------------------------------------------ ornament types
	"GET /api/v1/ornament-types":  list(),
	"POST /api/v1/ornament-types": list(),

	// --------------------------------------------------------------- banks
	"GET /api/v1/banks":  list(),
	"POST /api/v1/banks": list(),

	// ------------------------------------------------------------- lockers
	"GET /api/v1/lockers":        list(),
	"POST /api/v1/lockers":       list(),
	"GET /api/v1/lockers/:id":    probe("id=lockers"),
	"PUT /api/v1/lockers/:id":    probe("id=lockers"),
	"DELETE /api/v1/lockers/:id": probe("id=lockers"),

	// ------------------------------------------------------------- packets
	"GET /api/v1/packets":                list(),
	"GET /api/v1/packets/:id":            probe("id=packets"),
	"GET /api/v1/packets/:id/movements":  probe("id=packets"),
	"POST /api/v1/packets/:id/movements": probe("id=packets"),
	"GET /api/v1/packets/by-code/:code":  probe("code=packets:code"),

	// ----------------------------------------------------------- reminders
	"GET /api/v1/reminders":                   list(),
	"POST /api/v1/reminders":                  list(),
	"GET /api/v1/reminders/calendar":          list(),
	"GET /api/v1/reminders/:id":               probe("id=reminders"),
	"PUT /api/v1/reminders/:id":               probe("id=reminders"),
	"DELETE /api/v1/reminders/:id":            probe("id=reminders"),
	"PUT /api/v1/reminders/:id/complete":      probe("id=reminders"),
	"PUT /api/v1/reminders/:id/send-whatsapp": external("sends a WhatsApp message to a real borrower", "id=reminders"),

	// ------------------------------------------------------------- reports
	// All 16 are collections. They matter more than their class suggests:
	// every one is built as db.Table("loans l"), the exact shape that once
	// returned every business's rows unfiltered, and the plan records that
	// they had never been run with two businesses and the rows compared.
	// TestCollectionsDoNotLeak is that comparison.

	// ------------------------------------------------------ investments
	//
	// investments/investment_plans/investment_payouts each carry a
	// tenant_id but were absent from platform.tenantScopedTables until the
	// same change that classified these routes — so every query below ran
	// UNFILTERED. Registering the tables is what makes these probes
	// meaningful; classifying the routes without that would have recorded
	// a guarantee nothing enforced.
	"GET /api/v1/investment-plans":         list(),
	"POST /api/v1/investment-plans":        list(),
	"GET /api/v1/investment-plans/:id":     probe("id=investment_plans"),
	"PUT /api/v1/investment-plans/:id":     probe("id=investment_plans"),
	"GET /api/v1/investments":              list(),
	"POST /api/v1/investments":             list(),
	"GET /api/v1/investments/:id":          probe("id=investments"),
	"GET /api/v1/investments/:id/schedule": probe("id=investments"),
	"POST /api/v1/investments/:id/mature":  probe("id=investments"),
	// Two identifiers, so both are substituted: reaching another business's
	// payout through your own investment id must fail as surely as the
	// reverse.
	"POST /api/v1/investments/:id/payouts/:payoutId/pay": probe("id=investments", "payoutId=investment_payouts"),
	// Customer-shaped URL, customer-owned identifier — same treatment as the
	// other /customers/:id/* aggregates above.
	"GET /api/v1/customers/:id/investments": probe("id=customers"),

	"GET /api/v1/reports/investments/deposit-register":         list(),
	"GET /api/v1/reports/investments/interest-payout-register": list(),
	"GET /api/v1/reports/investments/investor-ledger":          list(),
	"GET /api/v1/reports/investments/maturity-register":        list(),
	"GET /api/v1/reports/loans/status":                         list(),
	"GET /api/v1/reports/disbursement":                         list(),
	"GET /api/v1/reports/personal-loans":                       list(),
	"GET /api/v1/reports/interest-collection":                  list(),
	"GET /api/v1/reports/payment-collection":                   list(),
	"GET /api/v1/reports/outstanding-principal":                list(),
	"GET /api/v1/reports/gold-weight":                          list(),
	"GET /api/v1/reports/gold-release":                         list(),
	"GET /api/v1/reports/bank-pledge":                          list(),
	"GET /api/v1/reports/auctions":                             list(),
	"GET /api/v1/reports/loan-extensions":                      list(),
	"GET /api/v1/reports/packets":                              list(),
	"GET /api/v1/reports/expense-cashflow":                     list(),
	"GET /api/v1/reports/kyc":                                  list(),
	"GET /api/v1/reports/gold-rate-history":                    list(),
	"GET /api/v1/reports/employee-performance":                 list(),
	"GET /api/v1/reports/communication-history":                list(),
	"GET /api/v1/reports/form-g":                               list(),
	"GET /api/v1/reports/balance-sheet":                        list(),
	"GET /api/v1/reports/profit-loss":                          list(),
	// :key names the report to export, not a record. The export path is the
	// classic blind spot — correct on screen, leaking in the file — so
	// TestCollectionsDoNotLeak walks every export key too.
	"GET /api/v1/reports/export/:key": list(),

	// This business's own audit log (Step 11) — a collection like reports
	// above, proven the same way (TestCollectionsDoNotLeak).
	"GET /api/v1/audit-log": list(),

	// This business's own subscription billing (Step 10) — no identifier to
	// substitute in any of the three; each reads/writes exactly the tenant
	// on the caller's own JWT, the same shape as GET /auth/me above.
	"GET /api/v1/billing/status":     self("returns the caller's own business's billing status; no identifier to substitute"),
	"POST /api/v1/billing/subscribe": self("creates a subscription for the caller's own business only"),
	"POST /api/v1/billing/confirm":   self("confirms the caller's own business's subscription only"),

	// --------------------------------------------------------- demo reset
	// Classed self, NOT probe, and the distinction is load-bearing:
	// TestCrossTenantAccessIsRefused INVOKES every probe-classed route once
	// per method per role, so classing a wipe endpoint as probe would destroy
	// the probe database dozens of times mid-suite. There is also nothing to
	// probe — the endpoint takes no identifier and no body, and acts only on
	// the business its own JWT names.
	"POST /api/v1/demo/reset": self("wipes and reseeds the caller's own business only; the tenant comes from the JWT, there is no identifier to substitute"),

	// --------------------------------------------------- roles/permissions
	"GET /api/v1/roles":                     list(),
	"POST /api/v1/roles":                    list(),
	"PATCH /api/v1/roles/:id":               probe("id=roles"),
	"DELETE /api/v1/roles/:id":              probe("id=roles"),
	"GET /api/v1/employees/:id/permissions": probe("id=employees"),
	// Not a probe: the handler requires the path id to equal the
	// AUTHENTICATED employee's id and returns 401 otherwise, so another
	// business's id is refused before any lookup and no cross-tenant request
	// is expressible. Reclassified after the harness showed the owning
	// business could not call it either — a probe whose refusal is
	// indistinguishable from its success proves nothing.
	"GET /api/v1/employees/:id/permissions/by-employee":        self("bootstrap permissions for the caller's own employee id only"),
	"PATCH /api/v1/employees/:id/permissions/:role_id":         probe("id=employees", "role_id=roles"),
	"PATCH /api/v1/employees/:id/permissions/:role_id/set-all": probe("id=employees", "role_id=roles"),

	// ================================================================
	// Borrower app (the Step 5 surface) — the borrower JWT scheme.
	// ================================================================
	"POST /api/v1/customer/auth/request-otp":     public("pre-session; the phone lookup that establishes the business"),
	"POST /api/v1/customer/auth/verify-otp":      public("establishes the borrower session"),
	"POST /api/v1/customer/auth/device-login":    public("pre-session; authenticates by device token"),
	"POST /api/v1/customer/auth/register-device": public("pre-session; binds a device to a borrower"),
	"POST /api/v1/customer/auth/refresh":         public("exchanges an existing borrower token"),

	"GET /api/v1/customer/gold-rate/latest":  clist("the public gold rate; read-only and not borrower-specific"),
	"GET /api/v1/customer/gold-rate/history": clist("the public gold rate; read-only and not borrower-specific"),

	"GET /api/v1/customer/loans":                        clist("the caller's own loans, forced from the JWT"),
	"GET /api/v1/customer/loans/:id":                    cprobe("id=loans"),
	"GET /api/v1/customer/loans/:id/requests":           cprobe("id=loans"),
	"GET /api/v1/customer/loans/:id/payments":           cprobe("id=loans"),
	"GET /api/v1/customer/loans/:id/statement":          cprobe("id=loans"),
	"POST /api/v1/customer/loans/:id/extension-request": cprobe("id=loans"),
	"POST /api/v1/customer/loans/:id/release-request":   cprobe("id=loans"),
	"POST /api/v1/customer/loans/:id/pay/create-order":  cexternal("opens a Razorpay order against a live account", "id=loans"),
	"POST /api/v1/customer/loans/:id/pay/verify":        cexternal("verifies a live Razorpay payment signature", "id=loans"),

	// Payment history and notifications are the routes the plan singles out:
	// they do NOT go through customerOwnedLoan and had never been tested
	// adversarially.
	"GET /api/v1/customer/payments":                    clist("the caller's own payments, forced from the JWT"),
	"GET /api/v1/customer/payments/:paymentId/receipt": cprobe("paymentId=loan_payments"),
	"GET /api/v1/customer/notifications":               clist("the caller's own notifications, forced from the JWT"),
	"POST /api/v1/customer/notifications/:id/ack":      cprobe("id=notifications"),
	"POST /api/v1/customer/notifications/:id/read":     cprobe("id=notifications"),

	"GET /api/v1/customer/profile":                cself("the caller's own profile, forced from the JWT"),
	"GET /api/v1/customer/profile/aadhaar/status": cself("the caller's own verification state"),
	"POST /api/v1/customer/profile/verify-pan":    cexternal("calls Setu PAN verification against a live provider account"),
	"POST /api/v1/customer/profile/aadhaar/start": cexternal("starts a live Setu DigiLocker/OKYC session"),

	"GET /api/v1/customer/ws": global("WebSocket upgrade; the hub is in-memory and keyed by globally unique customer id, so it has no query to filter"),

	// ================================================================
	// Superadmin console (Step 7) — legitimately cross-tenant by design.
	// ================================================================
	"POST /api/v1/superadmin/login": public("pre-session; establishes the superadmin's own session, a scheme with no tenant at all"),

	"POST /api/v1/superadmin/businesses":                superAdminRoute("creates a business; every field validated in superadmin.Service"),
	"GET /api/v1/superadmin/businesses":                 superAdminRoute("every business on the deployment, by design"),
	"GET /api/v1/superadmin/businesses/:id":             superAdminRoute("one business's admin-facing detail"),
	"POST /api/v1/superadmin/businesses/:id/suspend":    superAdminRoute("a commercial lever, never a data lock — see tenant.Tenant.CanWrite"),
	"POST /api/v1/superadmin/businesses/:id/reactivate": superAdminRoute("reverses suspend"),
	"PUT /api/v1/superadmin/businesses/:id/tier":        superAdminRoute("does not re-check current usage against the new quota by design — see Service.ChangeTier"),
	"PUT /api/v1/superadmin/businesses/:id/expiry":      superAdminRoute("adjusts SubscriptionExpiresAt by hand"),

	"GET /api/v1/superadmin/tiers":           superAdminRoute("the plan catalogue, identical for every business by definition"),
	"PUT /api/v1/superadmin/tiers/:id/price": superAdminRoute("sets a tier's Razorpay subscription price — vendor pricing, not a business's own record"),

	// Branding and entitlements. Vendor levers over another business's
	// identity and feature grants, so the same class as everything above.
	"PUT /api/v1/superadmin/businesses/:id/profile":   superAdminRoute("sets the name/legal identity printed on a business's own customer documents"),
	"PUT /api/v1/superadmin/businesses/:id/branding":  superAdminRoute("sets the one colour the frontend derives a business's whole palette from"),
	"POST /api/v1/superadmin/businesses/:id/logo":     superAdminRoute("stores a logo AS that business — the write runs under platform.WithTenant, so the uploaded_files row is stamped to it, not to the vendor"),
	"PUT /api/v1/superadmin/businesses/:id/modules":   superAdminRoute("grants/revokes optional modules; enforced per request by platform.RequireTenantModule"),
	"PUT /api/v1/superadmin/businesses/:id/languages": superAdminRoute("grants/revokes the languages a business may issue customer documents in"),

	"GET /api/v1/superadmin/catalogue": superAdminRoute("the closed sets of toggleable modules/languages — a static vocabulary, no business's data at all"),

	"GET /api/v1/superadmin/audit-log": superAdminRoute("every privileged superadmin action across every business, by design — this IS the record of who saw/changed what"),
}

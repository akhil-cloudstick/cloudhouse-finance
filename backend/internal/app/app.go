// Package app builds the HTTP server: every repository, service and handler,
// wired together and mounted on a router.
//
// This lives in a package rather than in main() for one reason that matters:
// the multi-tenancy isolation harness (documents/multitenancy_plan.md,
// Step 14) has to exercise the REAL router — the same middleware chain, the
// same permission gates, the same route table — because the isolation bugs
// this codebase has actually shipped were invisible at the unit level and
// only appeared in the generated SQL of a fully wired request. A harness that
// built its own miniature router would prove nothing about the server that
// ships.
package app

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"cloudhouse/backend/internal/auditlog"
	"cloudhouse/backend/internal/auth"
	"cloudhouse/backend/internal/authz"
	"cloudhouse/backend/internal/bank"
	"cloudhouse/backend/internal/billing"
	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/cash"
	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/customerauth"
	"cloudhouse/backend/internal/dashboard"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/locker"
	"cloudhouse/backend/internal/notification"
	"cloudhouse/backend/internal/ornamenttype"
	"cloudhouse/backend/internal/packet"
	"cloudhouse/backend/internal/investment"
	"cloudhouse/backend/internal/personalloan"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/puritystandard"
	"cloudhouse/backend/internal/realtime"
	"cloudhouse/backend/internal/reminder"
	"cloudhouse/backend/internal/reports"
	"cloudhouse/backend/internal/scheme"
	"cloudhouse/backend/internal/settings"
	"cloudhouse/backend/internal/superadmin"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"
	"cloudhouse/backend/internal/webstatic"
)

// corsMiddleware allows the Next.js dev server (a different origin/port from
// this API during local development) to make cross-origin requests. In
// production the built frontend is served from this same binary/origin, so
// this is effectively a no-op there.
func corsMiddleware(allowedOrigin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", allowedOrigin)
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// App is a wired-up server. Router is ready to serve; StartBackgroundJobs is
// separate and deliberately NOT started by Build, so the isolation harness
// can build the real router without a due/overdue sweep texting anybody.
type App struct {
	Router *gin.Engine

	// startJobs is populated by Build and invoked by StartBackgroundJobs.
	tenantRepo      *tenant.Repository
	notificationSvc *notification.Service
	loanSvc         *loan.Service
	billingSvc      *billing.Service
	dashboardSvc    *dashboard.Service
	investmentSvc   *investment.Service
}

// Build wires the entire application against an already-migrated database
// with the tenant scope already registered. It starts nothing.
func Build(db *gorm.DB, cfg platform.Config) (*App, error) {
	settingsCipher, err := platform.NewSettingsCipher(cfg.SettingsEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("settings encryption setup: %w", err)
	}
	aadhaarCipher, err := platform.NewAadhaarCipher(cfg.AadhaarEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("aadhaar encryption setup: %w", err)
	}

	router := gin.Default()
	router.Use(corsMiddleware(cfg.FrontendOrigin))

	// Tenant repository: used by auth to resolve which business a login is
	// for, before any tenant is established, by the branch quota check
	// below, and by the superadmin console (Step 7) to administer businesses —
	// the ONLY routes in this server that mount it, gated solely by
	// platform.SuperAdminAuthMiddleware and never by a tenant role's grants.
	tenantRepo := tenant.NewRepository(db)

	// Declared early: the loan service needs it to record the generated
	// indemnity bond, and the file-serving handler needs it to authorize
	// reads.
	uploadRepo := upload.NewRepository(db)

	// auditlog: this business's own record of its staff's privileged actions
	// (Step 11) — distinct from internal/superadmin's, which records the
	// superadmin's actions across every business. Declared here, ahead of
	// every service that writes to it.
	auditRepo := auditlog.NewRepository(db)

	branchRepo := branch.NewRepository(db)
	branchSvc := branch.NewService(branchRepo, tenantRepo, auditRepo)
	branchHandler := branch.NewHandler(branchSvc)

	schemeRepo := scheme.NewRepository(db)
	schemeSvc := scheme.NewService(schemeRepo, branchRepo)
	schemeHandler := scheme.NewHandler(schemeSvc)

	goldRateRepo := goldrate.NewRepository(db)
	goldRateSvc := goldrate.NewService(goldRateRepo)
	goldRateHandler := goldrate.NewHandler(goldRateSvc)

	purityStandardRepo := puritystandard.NewRepository(db)
	purityStandardSvc := puritystandard.NewService(purityStandardRepo)
	purityStandardHandler := puritystandard.NewHandler(purityStandardSvc)

	// Declared here rather than down by protected's routes below (its
	// original home) because employee.Service now needs it too, to resolve
	// a role NAME to its id at create/update time — see
	// employee.Service.resolveRoleID's doc comment for why that has to
	// happen on the write itself rather than waiting for a later backfill.
	authzRepo := authz.NewRepository(db)

	employeeRepo := employee.NewRepository(db)
	employeeSvc := employee.NewService(employeeRepo, branchRepo, authzRepo, auditRepo)
	employeeHandler := employee.NewHandler(employeeSvc)

	movementRepo := cash.NewMovementRepository(db)
	expenseRepo := cash.NewExpenseRepository(db)
	movementSvc := cash.NewMovementService(movementRepo, expenseRepo, branchRepo)
	movementHandler := cash.NewMovementHandler(movementSvc)

	expenseSvc := cash.NewExpenseService(expenseRepo, branchRepo)
	expenseHandler := cash.NewExpenseHandler(expenseSvc)

	openingBalanceRepo := cash.NewOpeningBalanceRepository(db)
	openingBalanceSvc := cash.NewOpeningBalanceService(openingBalanceRepo, branchRepo)
	openingBalanceHandler := cash.NewOpeningBalanceHandler(openingBalanceSvc)

	summarySvc := cash.NewSummaryService(movementRepo, expenseRepo, openingBalanceSvc)
	summaryHandler := cash.NewSummaryHandler(summarySvc)

	settingsRepo := settings.NewRepository(db)
	settingsSvc := settings.NewService(settingsRepo, settingsCipher)
	settingsHandler := settings.NewHandler(settingsSvc)

	// whatsappSender delivers messages (OTPs, reminders, and anything else
	// that wants WhatsApp delivery) via a self-hosted OpenWA instance,
	// configured live through Settings > WhatsApp (settingsSvc, category
	// "whatsapp") rather than an env var — see platform.OpenWASender. Until
	// that setting is configured, Send returns a clear "not configured"
	// error rather than silently doing nothing.
	whatsappLoader := func() (platform.WhatsAppConfig, error) {
		view, err := settingsSvc.Get(platform.AllowCrossTenant(context.Background()), settings.CategoryWhatsApp)
		if err != nil {
			return platform.WhatsAppConfig{}, err
		}
		if !view.IsSet {
			return platform.WhatsAppConfig{}, nil
		}
		return platform.ParseWhatsAppConfig(view.Value)
	}
	whatsappSender := platform.NewOpenWASender(whatsappLoader)

	setuClient := platform.NewSetuClient(cfg)
	digilockerClient := platform.NewDigilockerClient(cfg)
	esignClient := platform.NewEsignClient(cfg)
	razorpayClient := platform.NewRazorpayClient(cfg)

	customerRepo := customer.NewRepository(db)
	customerSvc := customer.NewService(db, customerRepo, branchRepo, aadhaarCipher, setuClient, digilockerClient)
	customerHandler := customer.NewHandler(customerSvc)

	// locker/packet are wired to each other via narrow interfaces
	// (locker.PacketCounter / packet.LockerCapacityProvider) so neither
	// package imports the other — both repos are built first, then handed
	// to each other's Service constructor.
	lockerRepo := locker.NewRepository(db)
	packetRepo := packet.NewRepository(db)

	packetSvc := packet.NewService(packetRepo, lockerRepo)
	packetHandler := packet.NewHandler(packetSvc)

	lockerSvc := locker.NewService(lockerRepo, branchRepo, packetRepo)
	lockerHandler := locker.NewHandler(lockerSvc)

	loanRepo := loan.NewRepository(db)
	loanOrnamentRepo := loan.NewOrnamentRepository(db)
	loanApprovalRepo := loan.NewApprovalRepository(db)
	loanPaymentRepo := loan.NewPaymentRepository(db)
	loanPledgeRepo := loan.NewBankPledgeRepository(db)
	loanRequestRepo := loan.NewLoanRequestRepository(db)
	requestApprovalRepo := loan.NewRequestApprovalRepository(db)
	loanAuctionRepo := loan.NewAuctionRepository(db)
	loanApprovalLimitRepo := loan.NewApprovalLimitRepository(db)
	// packetSvc satisfies both loan.PacketCreator (auto-creates a packet
	// right after loan creation) and loan.PacketMover (logs a matching
	// packet movement on bank-pledge/release) — see internal/loan's
	// PacketCreator/PacketMover doc comments. movementSvc satisfies
	// loan.CashRecorder, reflecting bank-pledge amounts into Cash-in-Hand.
	commlogRepo := commlog.NewRepository(db)

	// Realtime notifications (WebSocket, ack-and-resend) — realtimeHub tracks
	// live connections, notificationSvc is the durable store + resend logic
	// (see internal/notification, internal/realtime). notificationSvc
	// implements loan.CustomerNotifier so internal/loan can fire
	// notifications without importing this package directly.
	realtimeHub := realtime.NewHub()
	notificationRepo := notification.NewRepository(db)
	notificationSvc := notification.NewService(notificationRepo, realtimeHub)
	notificationHandler := notification.NewHandler(notificationSvc, realtimeHub)

	loanSvc := loan.NewService(db, loanRepo, loanOrnamentRepo, loanApprovalRepo, loanPaymentRepo, loanPledgeRepo, loanRequestRepo, requestApprovalRepo, loanAuctionRepo, loanApprovalLimitRepo, branchRepo, customerRepo, schemeRepo, goldRateRepo, packetSvc, packetSvc, movementSvc, notificationSvc, whatsappSender, commlogRepo, esignClient, cfg.UploadsDir, uploadRepo, tenantRepo, razorpayClient, aadhaarCipher, authzRepo)
	loanHandler := loan.NewHandler(loanSvc)

	personalLoanRepo := personalloan.NewRepository(db)
	personalLoanSvc := personalloan.NewService(personalLoanRepo, customerRepo, movementSvc, aadhaarCipher)
	personalLoanHandler := personalloan.NewHandler(personalLoanSvc)

	investmentRepo := investment.NewRepository(db)
	investmentSvc := investment.NewService(investmentRepo, customerRepo, movementSvc, investmentCommsAdapter{notificationSvc: notificationSvc})
	investmentHandler := investment.NewHandler(investmentSvc)

	reminderRepo := reminder.NewRepository(db)
	reminderSvc := reminder.NewService(reminderRepo, customerRepo, loanRepo, personalLoanSvc, loanAuctionRepo, whatsappSender, commlogRepo, tenantRepo)
	reminderHandler := reminder.NewHandler(reminderSvc)

	dashboardSnapshotRepo := dashboard.NewSnapshotRepository(db)
	dashboardSvc := dashboard.NewService(loanRepo, loanRequestRepo, dashboardSnapshotRepo)
	dashboardHandler := dashboard.NewHandler(dashboardSvc)

	uploadHandler := upload.NewHandler(cfg.UploadsDir, uploadRepo)
	uploadServeHandler := upload.NewServeHandler(uploadRepo, cfg.UploadsDir, cfg.JWTSecret, employeeRepo)

	ornamentTypeRepo := ornamenttype.NewRepository(db)
	ornamentTypeSvc := ornamenttype.NewService(ornamentTypeRepo)
	ornamentTypeHandler := ornamenttype.NewHandler(ornamentTypeSvc)

	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)
	bankHandler := bank.NewHandler(bankSvc)

	authSvc := auth.NewService(db, employeeRepo, tenantRepo, whatsappSender, cfg.JWTSecret, cfg.JWTExpiry, commlogRepo)
	authHandler := auth.NewHandler(authSvc, cfg.JWTExpiry)

	// Customer mobile app (customer-mobile/) — batch 1: OTP + device/biometric
	// sign-in, a separate JWT scheme (platform.CustomerClaims,
	// platform.CustomerAuthMiddleware) from the employee one above, so
	// customer tokens are never valid on staff routes and vice versa.
	customerAuthRepo := customerauth.NewRepository(db)
	customerAuthSvc := customerauth.NewService(db, customerRepo, tenantRepo, customerAuthRepo, whatsappSender, cfg.JWTSecret, commlogRepo)
	customerAuthHandler := customerauth.NewHandler(customerAuthSvc)
	customerAuthMiddleware := platform.CustomerAuthMiddleware(cfg.JWTSecret)

	reportsSvc := reports.NewService(db, commlogRepo, tenantRepo)
	reportsHandler := reports.NewHandler(reportsSvc)

	// employeeRepo doubles as the platform.EmployeeSessionChecker AuthMiddleware
	// uses to revalidate every request against the live employee row (Step
	// 8b) — its CurrentSession method's signature is exactly the interface's,
	// so no adapter is needed.
	authMiddleware := platform.AuthMiddleware(cfg.JWTSecret, employeeRepo)

	v1 := router.Group("/api/v1")

	// /auth/* is public (login/forgot/reset) except /auth/me, which
	// RegisterRoutes gates with authMiddleware itself — see
	// internal/auth/routes.go.
	auth.RegisterRoutes(v1.Group("/auth"), authHandler, authMiddleware)

	// Customer app routes live under their own top-level group, gated by
	// the customer JWT scheme rather than the employee authMiddleware used
	// for everything else in this file.
	customerauth.RegisterRoutes(v1.Group("/customer/auth"), customerAuthHandler, customerAuthMiddleware)
	customerGoldRate := v1.Group("/customer/gold-rate")
	customerGoldRate.Use(customerAuthMiddleware)
	// Reuses the existing staff goldrate handler's read-only methods
	// verbatim (Latest/List take no employee-specific input) — only the
	// route mount and auth middleware are customer-specific.
	customerGoldRate.GET("/latest", goldRateHandler.Latest)
	customerGoldRate.GET("/history", goldRateHandler.List)

	// Customer app — batch 2: My Loans + Loan Detail. Reuses loanHandler's
	// customer-scoped methods (internal/loan/customer_handler.go), which
	// force customerId from the JWT rather than trusting the client.
	customerLoans := v1.Group("/customer/loans")
	customerLoans.Use(customerAuthMiddleware)
	customerLoans.GET("", loanHandler.CustomerListLoans)
	customerLoans.GET("/:id", loanHandler.CustomerGetLoan)
	customerLoans.GET("/:id/requests", loanHandler.CustomerListLoanRequests)
	customerLoans.POST("/:id/extension-request", loanHandler.CustomerCreateExtensionRequest)
	customerLoans.POST("/:id/release-request", loanHandler.CustomerCreateReleaseRequest)

	// Customer app — batch 3: Razorpay Setup + Payments.
	customerLoans.POST("/:id/pay/create-order", loanHandler.CustomerCreateRazorpayOrder)
	customerLoans.POST("/:id/pay/verify", loanHandler.CustomerVerifyRazorpayPayment)
	customerLoans.GET("/:id/payments", loanHandler.CustomerListLoanPayments)

	// Customer app — batch 5: Documents (per-loan statement PDF).
	customerLoans.GET("/:id/statement", loanHandler.CustomerLoanStatement)

	customerPayments := v1.Group("/customer/payments")
	customerPayments.Use(customerAuthMiddleware)
	customerPayments.GET("", loanHandler.CustomerListPayments)
	customerPayments.GET("/:paymentId/receipt", loanHandler.CustomerPaymentReceipt)

	// Customer app — batch 4: Profile & KYC. Reuses customerHandler's
	// customer-scoped methods (internal/customer/customer_mobile_handler.go)
	// — same VerifyPAN/StartAadhaarVerify/CheckAadhaarVerify Setu/DigiLocker
	// calls staff use, just customerID forced from the JWT instead of :id +
	// branch scope.
	customerProfile := v1.Group("/customer/profile")
	customerProfile.Use(customerAuthMiddleware)
	customerProfile.GET("", customerHandler.CustomerGetProfile)
	customerProfile.POST("/verify-pan", customerHandler.CustomerVerifyPAN)
	customerProfile.POST("/aadhaar/start", customerHandler.CustomerStartAadhaarVerify)
	customerProfile.GET("/aadhaar/status", customerHandler.CustomerCheckAadhaarVerify)

	// Realtime notifications — REST history/ack + the WebSocket upgrade.
	// GET /customer/ws is registered directly on v1 (not customerNotifications)
	// since it's a single route, not a resource group, but uses the exact
	// same customerAuthMiddleware gate as every other /customer/* route: gin
	// processes the request normally (JWT parsed, customerId set on context)
	// right up until Upgrade() hijacks the connection.
	customerNotifications := v1.Group("/customer/notifications")
	customerNotifications.Use(customerAuthMiddleware)
	customerNotifications.GET("", notificationHandler.List)
	customerNotifications.POST("/:id/ack", notificationHandler.Ack)
	customerNotifications.POST("/:id/read", notificationHandler.Read)
	v1.GET("/customer/ws", customerAuthMiddleware, notificationHandler.Upgrade)

	// Every other /api/v1 route requires a valid JWT ("checkpoint 1"), then
	// a per-verb permission check against the permissions table
	// ("checkpoint 2" — see platform.CRUDPermissions), currently allow-all
	// for all 9 roles until an admin screen starts restricting rows.
	protected := v1.Group("")
	protected.Use(authMiddleware)

	// authzRepo is declared earlier now (see employeeSvc above) — read-only
	// here regardless: the permissions table is seeded and restricted solely
	// by cmd/migrate. This repo only reads those rows to authorize requests.

	branch.RegisterRoutes(protected.Group("/branches"), branchHandler, platform.CRUDPermissions(authzRepo, "branches"))
	scheme.RegisterRoutes(protected.Group("/schemes"), schemeHandler, platform.CRUDPermissions(authzRepo, "schemes"))
	goldrate.RegisterRoutes(protected.Group("/gold-rates"), goldRateHandler, platform.CRUDPermissions(authzRepo, "goldrates"))
	puritystandard.RegisterRoutes(protected.Group("/purity-standards"), purityStandardHandler, platform.CRUDPermissions(authzRepo, "puritystandards"))
	employee.RegisterRoutes(protected.Group("/employees"), employeeHandler, platform.CRUDPermissions(authzRepo, "employees"))
	cash.RegisterMovementRoutes(protected.Group("/cash-movements"), movementHandler, platform.CRUDPermissions(authzRepo, "cash"))
	cash.RegisterExpenseRoutes(protected.Group("/expenses"), expenseHandler, platform.CRUDPermissions(authzRepo, "cash"))
	cash.RegisterCashRoutes(protected.Group("/cash"), openingBalanceHandler, summaryHandler, platform.CRUDPermissions(authzRepo, "cash"))
	settings.RegisterRoutes(protected.Group("/settings/api-keys"), settingsHandler, platform.CRUDPermissions(authzRepo, "settings"))
	customer.RegisterRoutes(protected.Group("/customers"), customerHandler, platform.CRUDPermissions(authzRepo, "customers"))
	// Customer 360 lives on loanHandler (see internal/loan/service.go's
	// GetCustomer360 doc comment — avoids a customer<->loan import cycle)
	// but is mounted under /customers to keep the URL customer-shaped.
	protected.GET("/customers/:id/profile360", platform.CRUDPermissions(authzRepo, "customers").Read, loanHandler.GetCustomer360)
	// Server-side-paginated sub-tables for the Customer 360 view — same
	// rationale/placement as profile360 above (handler lives on loanHandler,
	// URL stays customer-shaped). Each accepts limit/offset plus the same
	// from/to opened-date window profile360 does.
	protected.GET("/customers/:id/loans", platform.CRUDPermissions(authzRepo, "customers").Read, loanHandler.ListLoansForCustomer)
	protected.GET("/customers/:id/ornaments", platform.CRUDPermissions(authzRepo, "customers").Read, loanHandler.ListOrnamentsForCustomer)
	protected.GET("/customers/:id/payments", platform.CRUDPermissions(authzRepo, "customers").Read, loanHandler.ListPaymentsForCustomer)
	protected.GET("/customers/:id/bank-pledges", platform.CRUDPermissions(authzRepo, "customers").Read, loanHandler.ListBankPledgesForCustomer)
	protected.GET("/customers/:id/auction-history", platform.CRUDPermissions(authzRepo, "customers").Read, loanHandler.ListAuctionHistoryForCustomer)
	protected.GET("/customers/:id/personal-loans", platform.CRUDPermissions(authzRepo, "personalloans").Read, personalLoanHandler.ListLoansForCustomer)
	loan.RegisterRoutes(protected.Group("/loans"), loanHandler, platform.CRUDPermissions(authzRepo, "loans"), platform.CRUDPermissions(authzRepo, "bankpledges"))
	dashboard.RegisterRoutes(protected.Group("/dashboard"), dashboardHandler, platform.CRUDPermissions(authzRepo, "loans"))
	upload.RegisterRoutes(protected.Group("/uploads"), uploadHandler, platform.CRUDPermissions(authzRepo, "uploads"))
	ornamenttype.RegisterRoutes(protected.Group("/ornament-types"), ornamentTypeHandler, platform.CRUDPermissions(authzRepo, "ornamenttypes"))
	bank.RegisterRoutes(protected.Group("/banks"), bankHandler, platform.CRUDPermissions(authzRepo, "banks"))
	locker.RegisterRoutes(protected.Group("/lockers"), lockerHandler, platform.CRUDPermissions(authzRepo, "lockers"))
	packet.RegisterRoutes(protected.Group("/packets"), packetHandler, platform.CRUDPermissions(authzRepo, "packets"))
	reminder.RegisterRoutes(protected.Group("/reminders"), reminderHandler, platform.CRUDPermissions(authzRepo, "reminders"))
	personalloan.RegisterRoutes(protected.Group("/personal-loans"), personalLoanHandler, platform.CRUDPermissions(authzRepo, "personalloans"))
	protected.GET("/customers/:id/investments", platform.CRUDPermissions(authzRepo, "investments").Read, investmentHandler.ListInvestmentsForCustomer)
	investment.RegisterRoutes(protected.Group("/investments"), investmentHandler, platform.CRUDPermissions(authzRepo, "investments"))
	investment.RegisterPlanRoutes(protected.Group("/investment-plans"), investmentHandler, platform.CRUDPermissions(authzRepo, "investments"))
	// Reports are read-only, gated solely by "can view report" — the
	// Administrator/Management/Branch Manager/Auditor default access is now
	// applied via internal/authz.Restrictions (a role_permissions grant, not
	// a hardcoded allowlist), editable from the permissions admin screen.
	reports.RegisterRoutes(protected.Group("/reports"), reportsHandler, platform.CRUDPermissions(authzRepo, "reports"))

	// This business's own audit log (Step 11) — read-only, same
	// "reports"-style single-permission gate; entries are written
	// internally by employee.Service/branch.Service, not through a route.
	auditLogHandler := auditlog.NewHandler(auditRepo)
	auditlog.RegisterRoutes(protected.Group("/audit-log"), auditLogHandler, platform.CRUDPermissions(authzRepo, "audit-log"))

	// Permissions admin API (the standard's 3-endpoint contract) + role
	// CRUD — see internal/authz/handler.go.
	authzHandler := authz.NewHandler(authzRepo)
	authz.RegisterRoutes(protected.Group("/employees"), protected.Group("/roles"), authzHandler, authzRepo)

	// This business's own subscription billing (Step 10) — one permission
	// gate, Administrator-only (see authz.Restrictions), same posture as
	// audit-log above.
	billingSvc := billing.NewService(db, tenantRepo, employeeRepo, razorpayClient, whatsappSender, commlogRepo)
	billingHandler := billing.NewHandler(billingSvc)
	billing.RegisterRoutes(protected.Group("/billing"), billingHandler, authzRepo)
	// The Razorpay webhook is a SIBLING of protected, never nested inside
	// it — same reasoning as the superadmin console below: it carries no
	// employee JWT and platform.CRUDPermissions would refuse it outright.
	// Its only gate is the signature Service.HandleWebhook verifies against
	// the raw request body (see billing.Handler.Webhook's doc comment).
	v1.POST("/webhooks/razorpay", billingHandler.Webhook)

	// The superadmin console (Step 7) — mounted on v1 directly, a SIBLING of
	// protected, never nested inside it. protected carries AuthMiddleware
	// (the employee JWT scheme) and platform.CRUDPermissions; neither
	// applies here. platform.SuperAdminAuthMiddleware, wired inside
	// superadmin.RegisterRoutes, is the only gate these routes get — see the
	// package doc comment for why tenant role grants must never reach them.
	superAdminRepo := superadmin.NewRepository(db)
	superAdminSvc := superadmin.NewService(db, superAdminRepo, tenantRepo, cfg.JWTSecret, cfg.JWTExpiry)
	superAdminHandler := superadmin.NewHandler(superAdminSvc)
	superadmin.RegisterRoutes(v1.Group("/superadmin"), superAdminHandler, platform.SuperAdminAuthMiddleware(cfg.JWTSecret))

	if err := os.MkdirAll(cfg.UploadsDir, 0o755); err != nil {
		return nil, fmt.Errorf("preparing uploads directory: %w", err)
	}
	// Files are served through a handler, NOT router.Static.
	//
	// The old static mount handed any file to anyone who asked — no login, no
	// ownership check — and those files include customer photos and KYC
	// documents. That was a privacy problem on a single installation and a
	// cross-business one the moment there are two. The handler authenticates
	// the request, resolves the file through the database, and only then
	// reads from disk.
	router.GET("/uploads/:key", uploadServeHandler.Serve)

	webstatic.Register(router, cfg.FrontendDir)

	return &App{
		Router:          router,
		tenantRepo:      tenantRepo,
		notificationSvc: notificationSvc,
		loanSvc:         loanSvc,
		billingSvc:      billingSvc,
		dashboardSvc:    dashboardSvc,
		investmentSvc:   investmentSvc,
	}, nil
}

// investmentCommsAdapter satisfies investment.CommsRecorder using the
// in-app notification.Service, without investment importing that package
// directly — mirrors how loan.CustomerNotifier is satisfied by the same
// *notification.Service (see notification.Service.Notify's doc comment).
// WhatsApp/commlog delivery for these two triggers (commlog.
// TriggerInterestPayout / TriggerInvestmentMatured) is not yet wired here —
// only the in-app notification fires today.
type investmentCommsAdapter struct {
	notificationSvc *notification.Service
}

func (a investmentCommsAdapter) NotifyInterestPayout(ctx context.Context, customerID uint, investmentNumber string, amount float64) error {
	a.notificationSvc.Notify(ctx, customerID, "investment_interest_payout",
		"Interest payout received",
		fmt.Sprintf("Your interest payout of %.2f for investment %s has been paid.", amount, investmentNumber),
		"Investment", 0)
	return nil
}

func (a investmentCommsAdapter) NotifyInvestmentMatured(ctx context.Context, customerID uint, investmentNumber string) error {
	a.notificationSvc.Notify(ctx, customerID, "investment_matured",
		"Investment matured",
		fmt.Sprintf("Your investment %s has matured. Please contact us to close or renew it.", investmentNumber),
		"Investment", 0)
	return nil
}

// StartBackgroundJobs launches the tickers the server runs. Kept separate
// from Build because tests build the router and must NOT start these: the
// due/overdue sweep sends real messages to real borrowers, and the billing
// reminder sends real messages to real business owners.
//
// All three jobs run with no request and therefore no tenant. Rather than
// letting them see every business at once, each tick walks the businesses
// and runs the job once per business with a context scoped to it — so a job
// behaves exactly as a logged-in user of that business would, and suspended
// businesses are skipped (the notification resend and due/overdue sweep
// only — the billing reminder deliberately walks every non-cancelled
// business itself; see billing.Service.NotifyExpiringSubscriptions's doc
// comment for why).
func (a *App) StartBackgroundJobs(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			tenant.ForEachActive(ctx, a.tenantRepo, "notification resend", func(ctx context.Context, t tenant.Tenant) error {
				a.notificationSvc.ResendPending(ctx)
				return nil
			})
		}
	}()
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			tenant.ForEachActive(ctx, a.tenantRepo, "due/overdue sweep", func(ctx context.Context, t tenant.Tenant) error {
				a.loanSvc.CheckDueAndOverdueLoans(ctx)
				return nil
			})
		}
	}()
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			tenant.ForEachActive(ctx, a.tenantRepo, "investment maturity sweep", func(ctx context.Context, t tenant.Tenant) error {
				return a.investmentSvc.SweepMaturities(ctx)
			})
		}
	}()
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			a.billingSvc.NotifyExpiringSubscriptions(ctx)
		}
	}()
	// Dashboard KPI snapshot — captures today's counts once/day for the
	// mobile dashboard's trend indicators (see dashboard.Service.
	// CaptureDailySnapshot's doc comment). Deliberately cross-tenant: Snapshot
	// is a single global row per day (unscoped across every business, same as
	// before multi-tenancy), not a per-tenant table, so it needs the explicit
	// exemption rather than a tenant walk. Ticks hourly like the jobs above;
	// CaptureDailySnapshot's own FindByDate guard keeps it to one row per day
	// regardless of tick cadence. Runs once immediately on boot too, so a
	// fresh deploy doesn't wait up to an hour for its first snapshot.
	snapshotCtx := platform.AllowCrossTenant(ctx)
	go func() {
		a.dashboardSvc.CaptureDailySnapshot(snapshotCtx)
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			a.dashboardSvc.CaptureDailySnapshot(snapshotCtx)
		}
	}()
}

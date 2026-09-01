package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/auth"
	"ambikagold/backend/internal/authz"
	"ambikagold/backend/internal/bank"
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/customerauth"
	"ambikagold/backend/internal/dashboard"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/loan"
	"ambikagold/backend/internal/locker"
	"ambikagold/backend/internal/migrate"
	"ambikagold/backend/internal/notification"
	"ambikagold/backend/internal/ornamenttype"
	"ambikagold/backend/internal/packet"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/puritystandard"
	"ambikagold/backend/internal/qr"
	"ambikagold/backend/internal/realtime"
	"ambikagold/backend/internal/reminder"
	"ambikagold/backend/internal/reports"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
	"ambikagold/backend/internal/upload"
	"ambikagold/backend/internal/webstatic"
)

// The authResources/staffRoles lists live in internal/migrate now — the
// single copy both this server and `cmd/migrate` seed from, so there is no
// second list anywhere to drift out of sync with the one actually applied.

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

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	// The API server migrates its own schema on every boot: AutoMigrate,
	// every backfill, and permission seeding, via the same internal/migrate.Run
	// that `go run ./cmd/migrate` calls standalone. Every step it runs is
	// either additive, an idempotent WHERE-guarded backfill, or a column drop
	// that only runs after that column's data has already been copied
	// forward — see internal/migrate's doc comments for the full accounting.
	if err := migrate.Run(db); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	settingsCipher, err := platform.NewSettingsCipher(cfg.SettingsEncryptionKey)
	if err != nil {
		log.Fatalf("settings encryption setup failed: %v", err)
	}
	aadhaarCipher, err := platform.NewAadhaarCipher(cfg.AadhaarEncryptionKey)
	if err != nil {
		log.Fatalf("aadhaar encryption setup failed: %v", err)
	}

	router := gin.Default()
	router.Use(corsMiddleware(cfg.FrontendOrigin))

	branchRepo := branch.NewRepository(db)
	branchSvc := branch.NewService(branchRepo)
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

	employeeRepo := employee.NewRepository(db)
	employeeSvc := employee.NewService(employeeRepo, branchRepo)
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
		view, err := settingsSvc.Get(settings.CategoryWhatsApp)
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
	customerSvc := customer.NewService(customerRepo, branchRepo, aadhaarCipher, setuClient, digilockerClient)
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

	loanSvc := loan.NewService(db, loanRepo, loanOrnamentRepo, loanApprovalRepo, loanPaymentRepo, loanPledgeRepo, loanRequestRepo, requestApprovalRepo, loanAuctionRepo, loanApprovalLimitRepo, branchRepo, customerRepo, schemeRepo, goldRateRepo, packetSvc, packetSvc, movementSvc, notificationSvc, whatsappSender, commlogRepo, esignClient, cfg.UploadsDir, razorpayClient, aadhaarCipher)
	loanHandler := loan.NewHandler(loanSvc)

	reminderRepo := reminder.NewRepository(db)
	reminderSvc := reminder.NewService(reminderRepo, customerRepo, loanRepo, whatsappSender, commlogRepo)
	reminderHandler := reminder.NewHandler(reminderSvc)

	dashboardSvc := dashboard.NewService(loanRepo, loanRequestRepo)
	dashboardHandler := dashboard.NewHandler(dashboardSvc)

	uploadHandler := upload.NewHandler(cfg.UploadsDir)
	qrHandler := qr.NewHandler()

	ornamentTypeRepo := ornamenttype.NewRepository(db)
	ornamentTypeSvc := ornamenttype.NewService(ornamentTypeRepo)
	ornamentTypeHandler := ornamenttype.NewHandler(ornamentTypeSvc)

	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)
	bankHandler := bank.NewHandler(bankSvc)

	authSvc := auth.NewService(employeeRepo, whatsappSender, cfg.JWTSecret, cfg.JWTExpiry, commlogRepo)
	authHandler := auth.NewHandler(authSvc)

	// Customer mobile app (customer-mobile/) — batch 1: OTP + device/biometric
	// sign-in, a separate JWT scheme (platform.CustomerClaims,
	// platform.CustomerAuthMiddleware) from the employee one above, so
	// customer tokens are never valid on staff routes and vice versa.
	customerAuthRepo := customerauth.NewRepository(db)
	customerAuthSvc := customerauth.NewService(customerRepo, customerAuthRepo, whatsappSender, cfg.JWTSecret, commlogRepo)
	customerAuthHandler := customerauth.NewHandler(customerAuthSvc)
	customerAuthMiddleware := platform.CustomerAuthMiddleware(cfg.JWTSecret)

	reportsSvc := reports.NewService(db, commlogRepo)
	reportsHandler := reports.NewHandler(reportsSvc)

	authMiddleware := platform.AuthMiddleware(cfg.JWTSecret)

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

	// Read-only here: the permissions table is seeded and restricted solely by
	// cmd/migrate now. This repo only reads those rows to authorize requests.
	authzRepo := authz.NewRepository(db)

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
	loan.RegisterRoutes(protected.Group("/loans"), loanHandler, platform.CRUDPermissions(authzRepo, "loans"), platform.CRUDPermissions(authzRepo, "bankpledges"))
	dashboard.RegisterRoutes(protected.Group("/dashboard"), dashboardHandler, platform.CRUDPermissions(authzRepo, "loans"))
	upload.RegisterRoutes(protected.Group("/uploads"), uploadHandler, platform.CRUDPermissions(authzRepo, "uploads"))
	// Stateless utility, not a CRUD resource — any authenticated staff
	// member can request a QR PNG, no separate permission gate.
	protected.GET("/qr", qrHandler.Generate)
	ornamenttype.RegisterRoutes(protected.Group("/ornament-types"), ornamentTypeHandler, platform.CRUDPermissions(authzRepo, "ornamenttypes"))
	bank.RegisterRoutes(protected.Group("/banks"), bankHandler, platform.CRUDPermissions(authzRepo, "banks"))
	locker.RegisterRoutes(protected.Group("/lockers"), lockerHandler, platform.CRUDPermissions(authzRepo, "lockers"))
	packet.RegisterRoutes(protected.Group("/packets"), packetHandler, platform.CRUDPermissions(authzRepo, "packets"))
	reminder.RegisterRoutes(protected.Group("/reminders"), reminderHandler, platform.CRUDPermissions(authzRepo, "reminders"))
	// Reports are read-only, gated solely by "can view report" — the
	// Administrator/Management/Branch Manager/Auditor default access is now
	// applied via internal/authz.Restrictions (a role_permissions grant, not
	// a hardcoded allowlist), editable from the permissions admin screen.
	reports.RegisterRoutes(protected.Group("/reports"), reportsHandler, platform.CRUDPermissions(authzRepo, "reports"))

	// Permissions admin API (the standard's 3-endpoint contract) + role
	// CRUD — see internal/authz/handler.go.
	authzHandler := authz.NewHandler(authzRepo)
	authz.RegisterRoutes(protected.Group("/employees"), protected.Group("/roles"), authzHandler, authzRepo)

	if err := os.MkdirAll(cfg.UploadsDir, 0o755); err != nil {
		log.Fatalf("failed to prepare uploads directory: %v", err)
	}
	router.Static("/uploads", cfg.UploadsDir)

	webstatic.Register(router, cfg.FrontendDir)

	// Realtime notifications — the first scheduled/background jobs in this
	// codebase (no cron/scheduler infra existed before). Resend ticker
	// re-pushes undelivered notifications to any customer with a live
	// connection every 10 minutes, capped at 10 attempts per notification
	// (notification.Service.ResendPending). Due/overdue ticker is the one
	// genuinely new notification *trigger* (see loan.Service.
	// CheckDueAndOverdueLoans's doc comment) — hourly is cheap since it only
	// walks the not-yet-closed loan set.
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			notificationSvc.ResendPending()
		}
	}()
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			loanSvc.CheckDueAndOverdueLoans()
		}
	}()

	log.Printf("Ambika Gold API + web app listening on :%s (serving frontend from %s)", cfg.Port, cfg.FrontendDir)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/auth"
	"ambikagold/backend/internal/authz"
	"ambikagold/backend/internal/bank"
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/loan"
	"ambikagold/backend/internal/locker"
	"ambikagold/backend/internal/ornamenttype"
	"ambikagold/backend/internal/packet"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/reminder"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
	"ambikagold/backend/internal/upload"
	"ambikagold/backend/internal/webstatic"
)

// authResources lists every domain package's permission resource key,
// seeded with allow-all rows for all 9 roles on startup (see
// authz.Repository.SeedDefaults). "kyc-documents" has no dedicated routes
// yet (KYC document URLs currently flow through the generic customer/
// upload endpoints) but is seeded now per the permissions plan so a future
// admin screen can restrict it independently without a migration.
var authResources = []string{
	"banks", "branches", "cash", "customers", "employees", "goldrates",
	"loans", "lockers", "ornamenttypes", "packets", "reminders", "schemes",
	"settings", "uploads", "kyc-documents",
}

// staffRoles is the canonical 9-role list permissions are seeded for. Keep
// in sync with employee.ValidRoles.
var staffRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
	"Accountant", "Collection Staff", "Auction Administrator", "Auditor",
}

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

	if err := scheme.BackfillDurationMonths(db); err != nil {
		log.Fatalf("scheme duration backfill failed: %v", err)
	}

	if err := db.AutoMigrate(
		&branch.Branch{},
		&scheme.Scheme{},
		&goldrate.GoldRate{},
		&employee.Employee{},
		&cash.CashMovement{},
		&cash.Expense{},
		&cash.OpeningCashBalance{},
		&settings.ApiKeySetting{},
		&customer.Customer{},
		&loan.Loan{},
		&loan.Ornament{},
		&loan.OrnamentPurityTest{},
		&loan.OrnamentImage{},
		&loan.LoanApproval{},
		&loan.LoanRequest{},
		&loan.RequestApproval{},
		&loan.LoanPayment{},
		&loan.BankPledgeRecord{},
		&loan.AuctionRecord{},
		&loan.AuctionNotice{},
		&ornamenttype.OrnamentType{},
		&bank.Bank{},
		&locker.Locker{},
		&packet.Packet{},
		&packet.PacketMovement{},
		&reminder.Reminder{},
		&authz.Permission{},
	); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
	}

	if err := scheme.DropLegacyDateColumns(db); err != nil {
		log.Fatalf("legacy scheme date column cleanup failed: %v", err)
	}

	authzRepo := authz.NewRepository(db)
	if inserted, skipped, err := authzRepo.SeedDefaults(staffRoles, authResources); err != nil {
		log.Fatalf("permissions seed failed: %v", err)
	} else {
		log.Printf("permissions seed: %d inserted, %d already present", inserted, skipped)
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
	schemeSvc := scheme.NewService(schemeRepo)
	schemeHandler := scheme.NewHandler(schemeSvc)

	goldRateRepo := goldrate.NewRepository(db)
	goldRateSvc := goldrate.NewService(goldRateRepo)
	goldRateHandler := goldrate.NewHandler(goldRateSvc)

	employeeRepo := employee.NewRepository(db)
	employeeSvc := employee.NewService(employeeRepo, branchRepo)
	employeeHandler := employee.NewHandler(employeeSvc)

	movementRepo := cash.NewMovementRepository(db)
	movementSvc := cash.NewMovementService(movementRepo, branchRepo)
	movementHandler := cash.NewMovementHandler(movementSvc)

	expenseRepo := cash.NewExpenseRepository(db)
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

	customerRepo := customer.NewRepository(db)
	customerSvc := customer.NewService(customerRepo, branchRepo, aadhaarCipher)
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
	// packetSvc satisfies both loan.PacketCreator (auto-creates a packet
	// right after loan creation) and loan.PacketMover (logs a matching
	// packet movement on bank-pledge/release) — see internal/loan's
	// PacketCreator/PacketMover doc comments. movementSvc satisfies
	// loan.CashRecorder, reflecting bank-pledge amounts into Cash-in-Hand.
	loanSvc := loan.NewService(loanRepo, loanOrnamentRepo, loanApprovalRepo, loanPaymentRepo, loanPledgeRepo, loanRequestRepo, requestApprovalRepo, loanAuctionRepo, branchRepo, customerRepo, schemeRepo, goldRateRepo, packetSvc, packetSvc, movementSvc)
	loanHandler := loan.NewHandler(loanSvc)

	reminderRepo := reminder.NewRepository(db)
	reminderSvc := reminder.NewService(reminderRepo, customerRepo, loanRepo)
	reminderHandler := reminder.NewHandler(reminderSvc)

	uploadHandler := upload.NewHandler(cfg.UploadsDir)

	ornamentTypeRepo := ornamenttype.NewRepository(db)
	ornamentTypeSvc := ornamenttype.NewService(ornamentTypeRepo)
	ornamentTypeHandler := ornamenttype.NewHandler(ornamentTypeSvc)

	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)
	bankHandler := bank.NewHandler(bankSvc)

	mailer := platform.NewMailer(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPFrom)
	authSvc := auth.NewService(employeeRepo, mailer, cfg.JWTSecret, cfg.JWTExpiry, cfg.FrontendOrigin)
	authHandler := auth.NewHandler(authSvc)

	authMiddleware := platform.AuthMiddleware(cfg.JWTSecret)

	v1 := router.Group("/api/v1")

	// /auth/* is public (login/forgot/reset) except /auth/me, which
	// RegisterRoutes gates with authMiddleware itself — see
	// internal/auth/routes.go.
	auth.RegisterRoutes(v1.Group("/auth"), authHandler, authMiddleware)

	// Every other /api/v1 route requires a valid JWT ("checkpoint 1"), then
	// a per-verb permission check against the permissions table
	// ("checkpoint 2" — see platform.CRUDPermissions), currently allow-all
	// for all 9 roles until an admin screen starts restricting rows.
	protected := v1.Group("")
	protected.Use(authMiddleware)

	branch.RegisterRoutes(protected.Group("/branches"), branchHandler, platform.CRUDPermissions(authzRepo, "branches"))
	scheme.RegisterRoutes(protected.Group("/schemes"), schemeHandler, platform.CRUDPermissions(authzRepo, "schemes"))
	goldrate.RegisterRoutes(protected.Group("/gold-rates"), goldRateHandler, platform.CRUDPermissions(authzRepo, "goldrates"))
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
	loan.RegisterRoutes(protected.Group("/loans"), loanHandler, platform.CRUDPermissions(authzRepo, "loans"))
	upload.RegisterRoutes(protected.Group("/uploads"), uploadHandler, platform.CRUDPermissions(authzRepo, "uploads"))
	ornamenttype.RegisterRoutes(protected.Group("/ornament-types"), ornamentTypeHandler, platform.CRUDPermissions(authzRepo, "ornamenttypes"))
	bank.RegisterRoutes(protected.Group("/banks"), bankHandler, platform.CRUDPermissions(authzRepo, "banks"))
	locker.RegisterRoutes(protected.Group("/lockers"), lockerHandler, platform.CRUDPermissions(authzRepo, "lockers"))
	packet.RegisterRoutes(protected.Group("/packets"), packetHandler, platform.CRUDPermissions(authzRepo, "packets"))
	reminder.RegisterRoutes(protected.Group("/reminders"), reminderHandler, platform.CRUDPermissions(authzRepo, "reminders"))

	if err := os.MkdirAll(cfg.UploadsDir, 0o755); err != nil {
		log.Fatalf("failed to prepare uploads directory: %v", err)
	}
	router.Static("/uploads", cfg.UploadsDir)

	webstatic.Register(router, cfg.FrontendDir)

	log.Printf("Ambika Gold API + web app listening on :%s (serving frontend from %s)", cfg.Port, cfg.FrontendDir)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

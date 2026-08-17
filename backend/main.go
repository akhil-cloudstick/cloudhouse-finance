package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ambikagold/backend/internal/auth"
	"ambikagold/backend/internal/authz"
	"ambikagold/backend/internal/bank"
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/loan"
	"ambikagold/backend/internal/locker"
	"ambikagold/backend/internal/ornamenttype"
	"ambikagold/backend/internal/packet"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/puritystandard"
	"ambikagold/backend/internal/reminder"
	"ambikagold/backend/internal/reports"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
	"ambikagold/backend/internal/upload"
	"ambikagold/backend/internal/webstatic"
)

// The authResources/staffRoles lists that used to live here have moved to
// cmd/migrate, which is now the only place permissions are seeded — keeping
// a second copy in the server would have been dead code that silently drifts
// out of sync with the list actually applied.

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

// requireMigratedSchema fails fast when the database has not had
// `go run ./cmd/migrate` applied to it. Since the server no longer migrates
// anything itself, a missing table would otherwise surface as an opaque SQL
// error on whichever request happened to touch it first.
//
// This is a presence check on a representative sample of tables, not a full
// schema verification — it catches "migrations were never run" and "a new
// model was added but not migrated", which are the realistic failures. It
// deliberately does not check columns; keeping it cheap means it can run on
// every boot without slowing startup.
func requireMigratedSchema(db *gorm.DB) error {
	required := []struct {
		name  string
		model any
	}{
		{"branches", &branch.Branch{}},
		{"schemes", &scheme.Scheme{}},
		{"employees", &employee.Employee{}},
		{"customers", &customer.Customer{}},
		{"loans", &loan.Loan{}},
		{"loan_payments", &loan.LoanPayment{}},
		{"packets", &packet.Packet{}},
		{"reminders", &reminder.Reminder{}},
		{"permissions", &authz.Permission{}},
		{"communication_logs", &commlog.CommunicationLog{}},
	}
	var missing []string
	for _, r := range required {
		if !db.Migrator().HasTable(r.model) {
			missing = append(missing, r.name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf(
			"database schema is not migrated — missing table(s): %s.\n"+
				"The API server no longer migrates on startup. Run:\n"+
				"    go run ./cmd/migrate",
			strings.Join(missing, ", "))
	}
	return nil
}

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	// The API server deliberately performs NO schema work: no AutoMigrate, no
	// backfills, no seeding. Migrations are applied only by an explicit
	// `go run ./cmd/migrate`, so restarting the server — including an
	// unattended restart after a crash — can never reshape or rewrite live
	// data as a side effect. cmd/migrate is the single source of the schema.
	//
	// The cost of that is a server booting against an un-migrated database,
	// which would otherwise fail later as confusing per-request SQL errors.
	// This check turns it into one clear message at startup instead.
	if err := requireMigratedSchema(db); err != nil {
		log.Fatalf("%v", err)
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

	loanSvc := loan.NewService(db, loanRepo, loanOrnamentRepo, loanApprovalRepo, loanPaymentRepo, loanPledgeRepo, loanRequestRepo, requestApprovalRepo, loanAuctionRepo, loanApprovalLimitRepo, branchRepo, customerRepo, schemeRepo, goldRateRepo, packetSvc, packetSvc, movementSvc, whatsappSender, commlogRepo, esignClient, cfg.UploadsDir)
	loanHandler := loan.NewHandler(loanSvc)

	reminderRepo := reminder.NewRepository(db)
	reminderSvc := reminder.NewService(reminderRepo, customerRepo, loanRepo, whatsappSender, commlogRepo)
	reminderHandler := reminder.NewHandler(reminderSvc)

	uploadHandler := upload.NewHandler(cfg.UploadsDir)

	ornamentTypeRepo := ornamenttype.NewRepository(db)
	ornamentTypeSvc := ornamenttype.NewService(ornamentTypeRepo)
	ornamentTypeHandler := ornamenttype.NewHandler(ornamentTypeSvc)

	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)
	bankHandler := bank.NewHandler(bankSvc)

	authSvc := auth.NewService(employeeRepo, whatsappSender, cfg.JWTSecret, cfg.JWTExpiry, commlogRepo)
	authHandler := auth.NewHandler(authSvc)

	reportsSvc := reports.NewService(db, commlogRepo)
	reportsHandler := reports.NewHandler(reportsSvc)

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
	loan.RegisterRoutes(protected.Group("/loans"), loanHandler, platform.CRUDPermissions(authzRepo, "loans"))
	upload.RegisterRoutes(protected.Group("/uploads"), uploadHandler, platform.CRUDPermissions(authzRepo, "uploads"))
	ornamenttype.RegisterRoutes(protected.Group("/ornament-types"), ornamentTypeHandler, platform.CRUDPermissions(authzRepo, "ornamenttypes"))
	bank.RegisterRoutes(protected.Group("/banks"), bankHandler, platform.CRUDPermissions(authzRepo, "banks"))
	locker.RegisterRoutes(protected.Group("/lockers"), lockerHandler, platform.CRUDPermissions(authzRepo, "lockers"))
	packet.RegisterRoutes(protected.Group("/packets"), packetHandler, platform.CRUDPermissions(authzRepo, "packets"))
	reminder.RegisterRoutes(protected.Group("/reminders"), reminderHandler, platform.CRUDPermissions(authzRepo, "reminders"))
	// Reports are gated by BOTH a role allow-list (Administrator/Management/
	// Branch Manager/Auditor — mirrors the auction routes' pattern in
	// internal/loan/routes.go) AND the ordinary "reports" resource permission
	// check, same double-gate style as auction routes.
	reportsRoles := platform.RequireAnyRole("Administrator", "Management", "Branch Manager", "Auditor")
	reports.RegisterRoutes(protected.Group("/reports"), reportsHandler, platform.CRUDPermissions(authzRepo, "reports"), reportsRoles)

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

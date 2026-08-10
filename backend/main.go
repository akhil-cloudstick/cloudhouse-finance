package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

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
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
	"ambikagold/backend/internal/upload"
	"ambikagold/backend/internal/webstatic"
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

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
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
		&loan.LoanPayment{},
		&loan.BankPledgeRecord{},
		&ornamenttype.OrnamentType{},
		&bank.Bank{},
		&locker.Locker{},
		&packet.Packet{},
		&packet.PacketMovement{},
	); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
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
	// packetSvc satisfies both loan.PacketCreator (auto-creates a packet
	// right after loan creation) and loan.PacketMover (logs a matching
	// packet movement on bank-pledge/release) — see internal/loan's
	// PacketCreator/PacketMover doc comments.
	loanSvc := loan.NewService(loanRepo, loanOrnamentRepo, loanApprovalRepo, loanPaymentRepo, loanPledgeRepo, branchRepo, customerRepo, schemeRepo, goldRateRepo, packetSvc, packetSvc)
	loanHandler := loan.NewHandler(loanSvc)

	uploadHandler := upload.NewHandler(cfg.UploadsDir)

	ornamentTypeRepo := ornamenttype.NewRepository(db)
	ornamentTypeSvc := ornamenttype.NewService(ornamentTypeRepo)
	ornamentTypeHandler := ornamenttype.NewHandler(ornamentTypeSvc)

	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)
	bankHandler := bank.NewHandler(bankSvc)

	v1 := router.Group("/api/v1")
	branch.RegisterRoutes(v1.Group("/branches"), branchHandler)
	scheme.RegisterRoutes(v1.Group("/schemes"), schemeHandler)
	goldrate.RegisterRoutes(v1.Group("/gold-rates"), goldRateHandler)
	employee.RegisterRoutes(v1.Group("/employees"), employeeHandler)
	cash.RegisterMovementRoutes(v1.Group("/cash-movements"), movementHandler)
	cash.RegisterExpenseRoutes(v1.Group("/expenses"), expenseHandler)
	cash.RegisterCashRoutes(v1.Group("/cash"), openingBalanceHandler, summaryHandler)
	settings.RegisterRoutes(v1.Group("/settings/api-keys"), settingsHandler)
	customer.RegisterRoutes(v1.Group("/customers"), customerHandler)
	loan.RegisterRoutes(v1.Group("/loans"), loanHandler)
	upload.RegisterRoutes(v1.Group("/uploads"), uploadHandler)
	ornamenttype.RegisterRoutes(v1.Group("/ornament-types"), ornamentTypeHandler)
	bank.RegisterRoutes(v1.Group("/banks"), bankHandler)
	locker.RegisterRoutes(v1.Group("/lockers"), lockerHandler)
	packet.RegisterRoutes(v1.Group("/packets"), packetHandler)

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

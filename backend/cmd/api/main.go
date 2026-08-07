package main

import (
	"log"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/webstatic"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	if err := db.AutoMigrate(
		&scheme.Scheme{},
		&goldrate.GoldRate{},
		&employee.Employee{},
		&cash.CashMovement{},
		&cash.Expense{},
	); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
	}

	router := gin.Default()

	schemeRepo := scheme.NewRepository(db)
	schemeSvc := scheme.NewService(schemeRepo)
	schemeHandler := scheme.NewHandler(schemeSvc)

	goldRateRepo := goldrate.NewRepository(db)
	goldRateSvc := goldrate.NewService(goldRateRepo)
	goldRateHandler := goldrate.NewHandler(goldRateSvc)

	employeeRepo := employee.NewRepository(db)
	employeeSvc := employee.NewService(employeeRepo)
	employeeHandler := employee.NewHandler(employeeSvc)

	movementRepo := cash.NewMovementRepository(db)
	movementSvc := cash.NewMovementService(movementRepo)
	movementHandler := cash.NewMovementHandler(movementSvc)

	expenseRepo := cash.NewExpenseRepository(db)
	expenseSvc := cash.NewExpenseService(expenseRepo)
	expenseHandler := cash.NewExpenseHandler(expenseSvc)

	v1 := router.Group("/api/v1")
	scheme.RegisterRoutes(v1.Group("/schemes"), schemeHandler)
	goldrate.RegisterRoutes(v1.Group("/gold-rates"), goldRateHandler)
	employee.RegisterRoutes(v1.Group("/employees"), employeeHandler)
	cash.RegisterMovementRoutes(v1.Group("/cash-movements"), movementHandler)
	cash.RegisterExpenseRoutes(v1.Group("/expenses"), expenseHandler)

	webstatic.Register(router, cfg.FrontendDir)

	log.Printf("Ambika Gold API + web app listening on :%s (serving frontend from %s)", cfg.Port, cfg.FrontendDir)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

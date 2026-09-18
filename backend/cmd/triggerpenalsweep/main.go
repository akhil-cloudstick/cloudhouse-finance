// Command triggerpenalsweep runs personalloan.Service.SweepPenalInterest once,
// immediately, for every active tenant — the same call StartBackgroundJobs'
// hourly ticker makes in internal/app/app.go, but on demand for manual
// testing instead of waiting for the next tick. Ad hoc, not wired into
// internal/migrate: run manually with `go run ./cmd/triggerpenalsweep`.
package main

import (
	"context"
	"log"

	"cloudhouse/backend/internal/personalloan"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/tenant"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	tenantRepo := tenant.NewRepository(db)
	personalLoanRepo := personalloan.NewRepository(db)
	// cashRecorder/customerRepo/aadhaarCipher are nil — SweepPenalInterest
	// never touches them (it only reads/writes loans + installments), unlike
	// CreateLoan/RecordPayment.
	personalLoanSvc := personalloan.NewService(personalLoanRepo, nil, nil, nil)

	ctx := context.Background()
	tenant.ForEachActive(ctx, db, tenantRepo, "triggerpenalsweep", func(ctx context.Context, t tenant.Tenant) error {
		return personalLoanSvc.SweepPenalInterest(ctx)
	})
	log.Println("penal interest sweep complete")
}

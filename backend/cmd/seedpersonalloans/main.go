// Command seedpersonalloans creates sample Personal Loan records for demo/
// testing purposes. For every active tenant it picks an existing branch,
// employee and a handful of existing customers, then creates loanCount
// loans per tenant with varied principal/interest/frequency/tenure via
// personalloan.Service.CreateLoan — so loan numbers, computed amounts and
// repayment schedules all come out correct, exactly as they would from the
// "New Personal Loan" form. Ad hoc — not wired into internal/migrate — run
// manually with: go run ./cmd/seedpersonalloans
package main

import (
	"context"
	"errors"
	"log"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/personalloan"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/tenant"
)

// loanCount is how many sample loans to create per active business.
const loanCount = 20

// variants gives each seeded loan a different shape so the list/demo data
// isn't 20 identical rows. Cycled round-robin across the customers found.
var variants = []struct {
	Principal    float64
	InterestType string
	InterestValue float64
	Frequency    string
	TenureCount  int
}{
	{Principal: 10000, InterestType: personalloan.InterestTypeFlat, InterestValue: 500, Frequency: personalloan.FrequencyMonthly, TenureCount: 6},
	{Principal: 25000, InterestType: personalloan.InterestTypePercentage, InterestValue: 12, Frequency: personalloan.FrequencyMonthly, TenureCount: 12},
	{Principal: 5000, InterestType: personalloan.InterestTypeFlat, InterestValue: 250, Frequency: personalloan.FrequencyWeekly, TenureCount: 10},
	{Principal: 15000, InterestType: personalloan.InterestTypePercentage, InterestValue: 10, Frequency: personalloan.FrequencyMonthly, TenureCount: 9},
	{Principal: 3000, InterestType: personalloan.InterestTypeFlat, InterestValue: 150, Frequency: personalloan.FrequencyDaily, TenureCount: 30},
	{Principal: 50000, InterestType: personalloan.InterestTypePercentage, InterestValue: 15, Frequency: personalloan.FrequencyMonthly, TenureCount: 18},
	{Principal: 8000, InterestType: personalloan.InterestTypeFlat, InterestValue: 400, Frequency: personalloan.FrequencyWeekly, TenureCount: 12},
}

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	tenantRepo := tenant.NewRepository(db)
	customerRepo := customer.NewRepository(db)
	personalLoanRepo := personalloan.NewRepository(db)
	// cashRecorder and aadhaarCipher are optional (nil is fine — CreateLoan
	// just skips cash-movement recording / leaves the bond's Aadhaar blank).
	personalLoanSvc := personalloan.NewService(personalLoanRepo, customerRepo, nil, nil)

	ctx := context.Background()
	tenant.ForEachActive(ctx, db, tenantRepo, "seedpersonalloans", func(ctx context.Context, t tenant.Tenant) error {
		return seedForTenant(ctx, db, personalLoanSvc, t)
	})
}

func seedForTenant(ctx context.Context, db *gorm.DB, svc *personalloan.Service, t tenant.Tenant) error {
	var b branch.Branch
	if err := db.WithContext(ctx).Order("id").First(&b).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("business %d (%s): no branch found, skipping", t.ID, t.Code)
			return nil
		}
		return err
	}

	var emp employee.Employee
	if err := db.WithContext(ctx).Order("id").First(&emp).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("business %d (%s): no employee found, skipping", t.ID, t.Code)
			return nil
		}
		return err
	}

	var custs []customer.Customer
	if err := db.WithContext(ctx).Order("id").Limit(loanCount).Find(&custs).Error; err != nil {
		return err
	}
	if len(custs) == 0 {
		log.Printf("business %d (%s): no customers found, skipping", t.ID, t.Code)
		return nil
	}

	created := 0
	for i := 0; i < loanCount; i++ {
		cust := custs[i%len(custs)]
		v := variants[i%len(variants)]

		loan, err := svc.CreateLoan(ctx, personalloan.CreateInput{
			BranchID:            b.ID,
			CustomerID:          cust.ID,
			PrincipalAmount:     v.Principal,
			InterestType:        v.InterestType,
			InterestValue:       v.InterestValue,
			Frequency:           v.Frequency,
			TenureCount:         v.TenureCount,
			CreatedByEmployeeID: emp.ID,
		})
		if err != nil {
			log.Printf("business %d (%s): create loan for customer %d failed: %v", t.ID, t.Code, cust.ID, err)
			continue
		}
		created++
		log.Printf("business %d (%s): seeded %s for customer %d (principal %.2f)", t.ID, t.Code, loan.LoanNumber, cust.ID, loan.PrincipalAmount)
	}
	log.Printf("business %d (%s): seeded %d/%d personal loans", t.ID, t.Code, created, loanCount)
	return nil
}

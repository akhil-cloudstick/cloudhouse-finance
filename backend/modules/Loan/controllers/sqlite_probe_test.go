package controllers

import (
	"context"
	"testing"
	"time"

	"cloudhouse/backend/common/mirror"
	"cloudhouse/backend/config"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// This runs the backend's own loan queries against a SQLite database built from the mirror schema, to see what the
// handlers need before they can serve a PC that is offline.
func TestLoanQueriesRunOnTheMirror(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:probe?mode=memory&cache=shared&_pragma=foreign_keys(0)&_pragma=busy_timeout(3000)"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(4)
	ddl, err := mirror.DDL()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(ddl).Error; err != nil {
		t.Fatalf("mirror schema: %v", err)
	}
	if err := config.RegisterTenantScope(db); err != nil {
		t.Fatal(err)
	}
	config.DB = config.NewConnPinner(db)

	now := time.Now().UTC().Format(time.RFC3339)
	for _, q := range []string{
		`INSERT INTO branches (tenant_id, id, name, code, created_at, updated_at) VALUES (1, 1, 'Main', 'B1', '` + now + `', '` + now + `')`,
		`INSERT INTO customers (tenant_id, id, uuid, name, phone, branch_id, created_at, updated_at) VALUES (1, 1, 'c-uuid', 'Meera', '9999', 1, '` + now + `', '` + now + `')`,
		`INSERT INTO schemes (tenant_id, id, name, created_at, updated_at) VALUES (1, 1, 'Gold 12', '` + now + `', '` + now + `')`,
		`INSERT INTO loans (tenant_id, id, uuid, loan_number, branch_id, customer_id, scheme_id, status, approval_stage, principal_amount, outstanding_amount, opened_date, due_date, created_at, updated_at) VALUES (1, 5, 'l-uuid', 'LN-5', 1, 1, 1, 'Active', 'Approved', 50000, 50000, '` + now + `', '` + now + `', '` + now + `', '` + now + `')`,
		`INSERT INTO loans (tenant_id, id, uuid, loan_number, branch_id, customer_id, scheme_id, status, approval_stage, principal_amount, outstanding_amount, opened_date, due_date, created_at, updated_at) VALUES (2, 6, 'other', 'LN-6', 1, 1, 1, 'Active', 'Approved', 1, 1, '` + now + `', '` + now + `', '` + now + `', '` + now + `')`,
		`INSERT INTO loan_payments (tenant_id, id, loan_id, amount, created_at) VALUES (1, 1, 5, 1000, '` + now + `')`,
	} {
		if err := db.Exec(q).Error; err != nil {
			t.Fatalf("seeding: %v\n%s", err, q)
		}
	}

	ctx := config.WithTenant(context.Background(), 1)
	l, err := GetLoan(ctx, 5, nil)
	if err != nil {
		t.Fatalf("GetLoan: %v", err)
	}
	if l.LoanNumber != "LN-5" || l.Customer.Name != "Meera" || len(l.Payments) != 1 {
		t.Errorf("loan read back as %q customer %q payments %d", l.LoanNumber, l.Customer.Name, len(l.Payments))
	}
	rows, total, err := FindLoans(ctx, LoanFilter{Limit: 50})
	if err != nil {
		t.Fatalf("FindLoans: %v", err)
	}
	if total != 1 || len(rows) != 1 {
		t.Errorf("FindLoans returned %d rows (total %d); another business's loan must not appear", len(rows), total)
	}
	if _, err := GetLoan(ctx, 6, nil); err == nil {
		t.Error("business two's loan must not be readable from business one")
	}
}

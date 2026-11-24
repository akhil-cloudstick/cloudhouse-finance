package mirror

import (
	"strings"
	"testing"
)

func TestTablesLoadWithValidRelations(t *testing.T) {
	ts, err := Tables()
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) < 40 {
		t.Fatalf("only %d tables", len(ts))
	}
	for _, tb := range ts {
		switch tb.Mode {
		case "child":
			if tb.Parent == nil {
				t.Errorf("%s is a child with no parent", tb.Name)
			}
		case "incremental":
			if !tb.HasUpdatedAt {
				t.Errorf("%s is incremental without updated_at", tb.Name)
			}
		case "whole":
		default:
			t.Errorf("%s has mode %q", tb.Name, tb.Mode)
		}
		if len(tb.PrimaryKey) != 1 {
			t.Errorf("%s has %d primary key columns; a PC addresses rows by one", tb.Name, len(tb.PrimaryKey))
		}
	}
}

func TestSecretsAreNeverListed(t *testing.T) {
	for table, cols := range excluded {
		tb := ByName(table)
		if tb == nil {
			t.Fatalf("%s is not a mirrored table", table)
		}
		for _, c := range tb.Columns {
			if cols[c.Name] {
				t.Errorf("%s.%s must not be mirrored", table, c.Name)
			}
		}
	}
	ddl, err := DDL()
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"password_hash", "aadhaar_encrypted", "aadhaar_hash"} {
		if strings.Contains(ddl, secret) {
			t.Errorf("the schema mentions %s", secret)
		}
	}
}

func TestMoneyTablesTrackChanges(t *testing.T) {
	for _, name := range []string{"cash_movements", "expenses", "gold_sales", "opening_cash_balances", "loan_cash_sources", "investment_transactions", "personal_loan_payments", "personal_loan_history", "approval_actions"} {
		tb := ByName(name)
		if tb == nil || !tb.HasUpdatedAt {
			t.Errorf("%s must carry updated_at so a PC can ask for what changed", name)
		}
	}
}

func TestEveryTableNeedsAViewPermission(t *testing.T) {
	ts, _ := Tables()
	for _, tb := range ts {
		if !strings.HasPrefix(tb.Permission, "can view ") {
			t.Errorf("%s has permission %q", tb.Name, tb.Permission)
		}
	}
	if p := ByName("ornament_images").Permission; p != "can view loan module" {
		t.Errorf("a loan's photos need the loan permission, got %q", p)
	}
	if p := ByName("bank_pledge_events").Permission; p != "can view bank pledge module" {
		t.Errorf("pledge events need the pledge permission, got %q", p)
	}
	if p := ByName("cash_movements").Permission; p != "can view cash module" {
		t.Errorf("cash rows need the cash permission, got %q", p)
	}
}

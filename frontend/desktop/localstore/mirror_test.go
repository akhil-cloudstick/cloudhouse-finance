package localstore

import (
	"testing"
)

func bind(t *testing.T, s *Store) {
	t.Helper()
	if err := s.MirrorBindTenant(1); err != nil {
		t.Fatal(err)
	}
}

func TestMirrorSchemaCreatesEveryTable(t *testing.T) {
	s := open(t)
	counts, err := s.MirrorCounts()
	if err != nil {
		t.Fatal(err)
	}
	if len(counts) != len(mirrorTables) || len(counts) < 40 {
		t.Fatalf("got %d tables, want %d", len(counts), len(mirrorTables))
	}
	for _, name := range []string{"loans", "customers", "loan_payments", "roles", "cash_movements"} {
		if _, ok := counts[name]; !ok {
			t.Errorf("table %s is not in the mirror", name)
		}
	}
}

func TestMirrorHoldsNoSecrets(t *testing.T) {
	for _, c := range mirrorTables["employees"].Columns {
		if c.Name == "password_hash" {
			t.Error("employees.password_hash must not be mirrored")
		}
	}
	for _, c := range mirrorTables["customers"].Columns {
		if c.Name == "aadhaar_encrypted" || c.Name == "aadhaar_hash" {
			t.Errorf("customers.%s must not be mirrored", c.Name)
		}
	}
}

func TestMirrorApplyUpsertsDeletesAndKeepsState(t *testing.T) {
	s := open(t)
	bind(t, s)
	err := s.MirrorApply(`{"tables":[
		{"table":"loans","rows":[{"id":1,"uuid":"u1","loan_number":"LN-1","branch_id":2,"principal_amount":1500.5,"created_at":"2026-01-02T03:04:05Z","extra":"ignored"},
		                         {"id":2,"uuid":"u2","loan_number":"LN-2","branch_id":2}]},
		{"table":"loan_payments","rows":[{"id":10,"loan_id":1,"amount":100},{"id":11,"loan_id":1,"amount":200},{"id":12,"loan_id":2,"amount":300}]}
	],"state":{"cursor.loans":"c1"}}`)
	if err != nil {
		t.Fatal(err)
	}
	counts, _ := s.MirrorCounts()
	if counts["loans"] != 2 || counts["loan_payments"] != 3 {
		t.Fatalf("counts after the first batch: %v", counts)
	}
	if v, _ := s.MirrorState("cursor.loans"); v != "c1" {
		t.Errorf("state = %q, want c1", v)
	}

	// a changed loan: its children are cleared and sent again, the loan row is replaced, one loan is deleted
	err = s.MirrorApply(`{"tables":[
		{"table":"loans","delete":[2],"rows":[{"id":1,"uuid":"u1","loan_number":"LN-1b","branch_id":2}]},
		{"table":"loans","refresh":[1]},
		{"table":"loan_payments","rows":[{"id":11,"loan_id":1,"amount":250}]}
	],"state":{"cursor.loans":"c2"}}`)
	if err != nil {
		t.Fatal(err)
	}
	counts, _ = s.MirrorCounts()
	if counts["loans"] != 1 || counts["loan_payments"] != 1 {
		t.Fatalf("counts after the second batch: %v", counts)
	}
	ids, _ := s.MirrorIDs("loan_payments")
	if len(ids) != 1 || ids[0] != 11 {
		t.Fatalf("payment ids = %v, want only 11 (loan 2 was deleted with its payment)", ids)
	}
	var number string
	db, _ := s.conn()
	if err := db.QueryRow(`SELECT loan_number FROM loans WHERE id = 1`).Scan(&number); err != nil || number != "LN-1b" {
		t.Errorf("loan 1 number = %q (%v), want LN-1b", number, err)
	}
	var amount float64
	if err := db.QueryRow(`SELECT amount FROM loan_payments WHERE id = 11`).Scan(&amount); err != nil || amount != 250 {
		t.Errorf("payment 11 amount = %v (%v), want 250", amount, err)
	}
}

func TestMirrorApplyIsAllOrNothing(t *testing.T) {
	s := open(t)
	bind(t, s)
	err := s.MirrorApply(`{"tables":[
		{"table":"loans","rows":[{"id":1,"uuid":"u1"}]},
		{"table":"not_a_table","rows":[{"id":1}]}
	],"state":{"cursor.loans":"c1"}}`)
	if err == nil {
		t.Fatal("a batch naming an unknown table must be refused")
	}
	counts, _ := s.MirrorCounts()
	if counts["loans"] != 0 {
		t.Errorf("a refused batch left %d loans behind", counts["loans"])
	}
	if v, _ := s.MirrorState("cursor.loans"); v != "" {
		t.Errorf("a refused batch moved the cursor to %q", v)
	}
	if err := s.MirrorApply(`{"tables":[],"state":{"bad name":"x"}}`); err == nil {
		t.Error("a state name with a space must be refused")
	}
}

func TestServerRowReplacesTheRecordMadeOffline(t *testing.T) {
	s := open(t)
	bind(t, s)
	// a loan made offline: a negative id, its UUID, and a payment hanging off it
	err := s.MirrorApply(`{"tables":[
		{"table":"loans","rows":[{"id":-1,"uuid":"u-new","loan_number":"#7F3A","branch_id":2}]},
		{"table":"loan_payments","rows":[{"id":-5,"loan_id":-1,"amount":100}]}
	]}`)
	if err != nil {
		t.Fatal(err)
	}
	// the server saved it: the same UUID comes back with the real id and the real child rows
	err = s.MirrorApply(`{"tables":[
		{"table":"loans","refresh":[240],"rows":[{"id":240,"uuid":"u-new","loan_number":"LN-00240","branch_id":2}]},
		{"table":"loan_payments","rows":[{"id":901,"loan_id":240,"amount":100}]}
	]}`)
	if err != nil {
		t.Fatal(err)
	}
	loans, _ := s.MirrorIDs("loans")
	payments, _ := s.MirrorIDs("loan_payments")
	if len(loans) != 1 || loans[0] != 240 {
		t.Errorf("loans = %v, want only the server's 240", loans)
	}
	if len(payments) != 1 || payments[0] != 901 {
		t.Errorf("payments = %v, want only the server's 901 (the local one went with the local loan)", payments)
	}
}

func TestMirrorSurvivesReopen(t *testing.T) {
	root := t.TempDir()
	s := New(root)
	if err := s.Open("acme", "dev_1"); err != nil {
		t.Fatal(err)
	}
	if err := s.MirrorBindTenant(1); err != nil {
		t.Fatal(err)
	}
	if err := s.MirrorApply(`{"tables":[{"table":"banks","rows":[{"id":5,"name":"SBI"}]}],"state":{"cursor.banks":"x"}}`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if err := s.Open("acme", "dev_1"); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	counts, _ := s.MirrorCounts()
	if counts["banks"] != 1 {
		t.Errorf("banks after reopen = %d, want 1", counts["banks"])
	}
}

func TestMirrorRefusesRowsUntilBoundToABusiness(t *testing.T) {
	s := open(t)
	if err := s.MirrorApply(`{"tables":[{"table":"banks","rows":[{"id":1,"name":"SBI"}]}]}`); err == nil {
		t.Fatal("rows must not be accepted before the mirror is bound to a business")
	}
}

func TestMirrorNeverMixesTwoBusinesses(t *testing.T) {
	s := open(t)
	bind(t, s)
	if err := s.MirrorApply(`{"tables":[{"table":"banks","rows":[{"id":1,"name":"Business one bank"}]}],"state":{"cursor.banks":"c1"}}`); err != nil {
		t.Fatal(err)
	}
	// the same file is later used for another business: nothing of the first one may remain
	if err := s.MirrorBindTenant(2); err != nil {
		t.Fatal(err)
	}
	counts, _ := s.MirrorCounts()
	if counts["banks"] != 0 {
		t.Errorf("business two sees %d banks left by business one", counts["banks"])
	}
	if v, _ := s.MirrorState("cursor.banks"); v != "" {
		t.Errorf("business two inherited the cursor %q", v)
	}
	if err := s.MirrorApply(`{"tables":[{"table":"banks","rows":[{"id":9,"name":"Business two bank"}]}]}`); err != nil {
		t.Fatal(err)
	}
	db, _ := s.conn()
	var tenant int64
	if err := db.QueryRow(`SELECT tenant_id FROM banks WHERE id = 9`).Scan(&tenant); err != nil || tenant != 2 {
		t.Errorf("row stamped with business %d (%v), want 2", tenant, err)
	}
	// binding the same business again keeps its data
	if err := s.MirrorBindTenant(2); err != nil {
		t.Fatal(err)
	}
	if counts, _ := s.MirrorCounts(); counts["banks"] != 1 {
		t.Errorf("binding the same business again changed the data: %v", counts["banks"])
	}
}

func TestTemporaryRowsGoWhenTheirEntryIsSent(t *testing.T) {
	s := open(t)
	bind(t, s)
	id := "0190a1b2-0000-7000-8000-000000000001"
	// an offline top-up: a negative id, hanging off a real loan
	if err := s.MirrorApply(`{"tables":[{"table":"loans","rows":[{"id":5,"uuid":"l5"}]}]}`); err != nil {
		t.Fatal(err)
	}
	err := s.MirrorWriteTemp(id, `{"tables":[{"table":"loan_top_ups","rows":[{"id":-1,"loan_id":5,"amount":900}]}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if ids, _ := s.MirrorIDs("loan_top_ups"); len(ids) != 1 || ids[0] != -1 {
		t.Fatalf("temporary top-up not written: %v", ids)
	}
	if err := s.MirrorWriteTemp(id, `{"tables":[{"table":"loan_top_ups","rows":[{"id":7,"loan_id":5}]}]}`); err == nil {
		t.Error("a temporary row with a positive id must be refused")
	}
	// the entry is sent: its temporary rows go and the loan stays
	if err := s.MirrorDropTemp(id); err != nil {
		t.Fatal(err)
	}
	if ids, _ := s.MirrorIDs("loan_top_ups"); len(ids) != 0 {
		t.Errorf("temporary rows left behind: %v", ids)
	}
	if ids, _ := s.MirrorIDs("loans"); len(ids) != 1 {
		t.Errorf("the real loan must stay: %v", ids)
	}
}

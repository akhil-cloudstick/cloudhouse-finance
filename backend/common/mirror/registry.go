// Package mirror lists the tables a desktop PC copies from the server, with the columns each one carries.
// The desktop's SQLite schema is generated from this list (cmd/mirrorschema), and the table sync endpoint serves
// only these tables and columns, so the two cannot drift apart.
package mirror

import (
	"fmt"
	"reflect"
	"strings"
	"sync"

	commonModels "cloudhouse/backend/common/models"
	cashModels "cloudhouse/backend/modules/Cash/models"
	investModels "cloudhouse/backend/modules/Investment/models"
	loanModels "cloudhouse/backend/modules/Loan/models"
	lockerModels "cloudhouse/backend/modules/Locker/models"
	packetModels "cloudhouse/backend/modules/Packet/models"
	personalModels "cloudhouse/backend/modules/PersonalLoan/models"
	reminderModels "cloudhouse/backend/modules/Reminder/models"
	reportModels "cloudhouse/backend/modules/Reports/models"

	"gorm.io/gorm/schema"
)

type Column struct {
	Name     string `json:"name"`
	SQLType  string `json:"type"`
	Nullable bool   `json:"nullable"`
}

type Table struct {
	Name         string   `json:"name"`
	Columns      []Column `json:"columns"`
	PrimaryKey   []string `json:"primary_key"`
	HasUpdatedAt bool     `json:"has_updated_at"`
	HasDeletedAt bool     `json:"has_deleted_at"`
	// LoanKey is the column that points at the loan a child row belongs to ("" for tables that are not loan children).
	LoanKey string `json:"loan_key"`
	// BranchKey is the column that says which branch the row belongs to ("" when the table is not branch-scoped).
	BranchKey string `json:"branch_key"`
	// Mode says how a PC keeps the table current: "incremental" (rows changed since a cursor), "whole" (the whole table,
	// for small tables with no change time) or "child" (rows are fetched again, as a set, when their parent changes).
	Mode string `json:"mode"`
	// Parent is the table a child row belongs to, and the column that points at it.
	Parent *Relation `json:"parent,omitempty"`
	// Permission is the view permission a user needs before this table is sent to their PC: the same one the module's own
	// screens ask for, so a PC never holds data the user could not open online.
	Permission string `json:"permission"`
	// VisibleVia is the table whose visibility decides this table's rows when it has no branch column of its own.
	VisibleVia *Relation `json:"visible_via,omitempty"`
	// Children are the tables whose rows hang off this one.
	Children []Relation `json:"children,omitempty"`
}

type Relation struct {
	Table  string `json:"table"`
	Column string `json:"column"`
}

// childTables lists, for each parent table, the tables whose rows belong to it. A change to a loan marks the loan
// changed (see Loan/models/touch.go), so a loan's whole tree is fetched again when the loan comes down.
var childTables = map[string][]Relation{
	"loans": {
		{"ornaments", "loan_id"}, {"loan_payments", "loan_id"}, {"loan_top_ups", "loan_id"}, {"loan_accruals", "loan_id"},
		{"loan_approvals", "loan_id"}, {"loan_requests", "loan_id"}, {"auction_records", "loan_id"},
		{"auction_decision_requests", "loan_id"}, {"bank_pledge_records", "loan_id"}, {"packets", "loan_id"},
	},
	"ornaments":           {{"ornament_images", "ornament_id"}, {"ornament_purity_tests", "ornament_id"}},
	"loan_requests":       {{"loan_request_ornaments", "request_id"}, {"request_approvals", "request_id"}},
	"auction_records":     {{"auction_notices", "auction_record_id"}, {"auction_events", "auction_record_id"}},
	"bank_pledge_records": {{"bank_pledge_events", "bank_pledge_record_id"}},
	"packets":             {{"packet_movements", "packet_id"}},
	"loan_drafts":         {{"loan_draft_ornaments", "draft_id"}},
}

// excluded columns are secrets or server-only values: they are never sent to a PC and not created in its database.
var excluded = map[string]map[string]bool{
	"employees": {"password_hash": true, "password_reset_token_hash": true, "password_reset_expires_at": true, "password_reset_attempts": true},
	"customers": {"aadhaar_encrypted": true, "aadhaar_hash": true, "digilocker_request_id": true},
}

func models() []any {
	return []any{
		&commonModels.Branch{}, &commonModels.Scheme{}, &commonModels.GoldRate{}, &commonModels.Employee{}, &commonModels.Bank{},
		&commonModels.Customer{}, &commonModels.OrnamentType{}, &commonModels.PurityStandard{},
		&commonModels.Role{}, &commonModels.RolePermission{}, &commonModels.Permission{},
		&commonModels.ApprovalAction{}, &commonModels.ApprovalCategoryMode{}, &commonModels.ApprovalChain{}, &commonModels.ApprovalStageSetting{},
		&cashModels.CashMovement{}, &cashModels.Category{}, &cashModels.Expense{}, &cashModels.GoldSale{}, &cashModels.LoanCashSource{}, &cashModels.OpeningCashBalance{},
		&investModels.Investment{}, &investModels.InvestmentPayout{}, &investModels.InvestmentPlan{}, &investModels.InvestmentTransaction{},
		&loanModels.Loan{}, &loanModels.Ornament{}, &loanModels.OrnamentImage{}, &loanModels.OrnamentPurityTest{},
		&loanModels.LoanPayment{}, &loanModels.LoanTopUp{}, &loanModels.LoanAccrual{}, &loanModels.LoanApproval{},
		&loanModels.LoanRequest{}, &loanModels.LoanRequestOrnament{}, &loanModels.RequestApproval{},
		&loanModels.AuctionRecord{}, &loanModels.AuctionNotice{}, &loanModels.AuctionEvent{}, &loanModels.AuctionDecisionRequest{},
		&loanModels.BankPledgeRecord{}, &loanModels.BankPledgeEvent{}, &loanModels.LoanDraft{}, &loanModels.LoanDraftOrnament{},
		&lockerModels.Locker{}, &packetModels.Packet{}, &packetModels.PacketMovement{},
		&personalModels.PersonalLoan{}, &personalModels.PersonalLoanInstallment{}, &personalModels.PersonalLoanPayment{}, &personalModels.PersonalLoanHistory{},
		&reminderModels.Reminder{}, &reportModels.DayBookEntry{},
	}
}

func sqlType(dt string) string {
	t := strings.ToLower(dt)
	switch {
	case strings.Contains(t, "int"), strings.Contains(t, "bool"):
		return "INTEGER"
	case strings.Contains(t, "float"), strings.Contains(t, "numeric"), strings.Contains(t, "decimal"), strings.Contains(t, "double"), strings.Contains(t, "real"):
		return "REAL"
	case strings.Contains(t, "bytes"), strings.Contains(t, "blob"), strings.Contains(t, "bytea"):
		return "BLOB"
	case strings.Contains(t, "time"), strings.Contains(t, "date"):
		return "DATETIME"
	default:
		return "TEXT"
	}
}

var (
	once   sync.Once
	tables []Table
	loadEr error
)

// Tables returns every mirrored table in a stable order.
func Tables() ([]Table, error) {
	once.Do(func() {
		cache := &sync.Map{}
		seen := map[string]bool{}
		for _, m := range models() {
			s, err := schema.Parse(m, cache, schema.NamingStrategy{})
			if err != nil {
				loadEr = fmt.Errorf("parsing %s: %w", reflect.TypeOf(m), err)
				return
			}
			if seen[s.Table] {
				loadEr = fmt.Errorf("table %s is listed twice", s.Table)
				return
			}
			seen[s.Table] = true
			t := Table{Name: s.Table}
			for _, name := range s.DBNames {
				f := s.FieldsByDBName[name]
				if f == nil || f.IgnoreMigration || name == "tenant_id" || excluded[s.Table][name] {
					continue
				}
				t.Columns = append(t.Columns, Column{Name: name, SQLType: sqlType(string(f.DataType)), Nullable: !f.NotNull && !f.PrimaryKey})
				switch name {
				case "updated_at":
					t.HasUpdatedAt = true
				case "deleted_at":
					t.HasDeletedAt = true
				case "loan_id":
					t.LoanKey = "loan_id"
				case "branch_id":
					t.BranchKey = "branch_id"
				}
			}
			for _, f := range s.PrimaryFields {
				t.PrimaryKey = append(t.PrimaryKey, f.DBName)
			}
			if len(t.PrimaryKey) == 0 {
				loadEr = fmt.Errorf("table %s has no primary key", s.Table)
				return
			}
			tables = append(tables, t)
		}
		loadEr = link(tables)
	})
	return tables, loadEr
}

// tablePermission is the view permission for each table that has one of its own; a child table that is not listed here
// needs the same permission as its parent.
var tablePermission = map[string]string{
	"branches": "can view branch module", "schemes": "can view scheme module", "gold_rates": "can view gold rate module",
	"employees": "can view employee module", "banks": "can view bank module", "customers": "can view customer module",
	"ornament_types": "can view ornament type module", "purity_standards": "can view purity standard module",
	"roles": "can view role and permission module", "role_permissions": "can view role and permission module",
	"permissions":      "can view role and permission module",
	"approval_actions": "can view loan module", "approval_category_modes": "can view loan module",
	"approval_chains": "can view loan module", "approval_stage_settings": "can view loan module",
	"cash_movements": "can view cash module", "categories": "can view cash module", "expenses": "can view cash module",
	"gold_sales": "can view cash module", "loan_cash_sources": "can view cash module", "opening_cash_balances": "can view cash module",
	"investments": "can view investment module", "investment_payouts": "can view investment module",
	"investment_plans": "can view investment module", "investment_transactions": "can view investment module",
	"loans": "can view loan module", "loan_drafts": "can view loan module",
	"bank_pledge_records": "can view bank pledge module",
	"auction_records":     "can view auction module", "auction_decision_requests": "can view auction module",
	"lockers": "can view locker module", "packets": "can view packet module",
	"personal_loans": "can view personal loan module", "personal_loan_installments": "can view personal loan module",
	"personal_loan_payments": "can view personal loan module", "personal_loan_history": "can view personal loan module",
	"reminders": "can view reminder module", "day_book_entries": "can view report module",
}

// visibleVia names, for tables with no branch column that are not children, the table that decides who may see a row.
var visibleVia = map[string]Relation{
	"reminders":                  {"customers", "customer_id"},
	"investment_payouts":         {"investments", "investment_id"},
	"investment_transactions":    {"investments", "investment_id"},
	"personal_loan_installments": {"personal_loans", "personal_loan_id"},
	"personal_loan_payments":     {"personal_loans", "personal_loan_id"},
	"personal_loan_history":      {"personal_loans", "personal_loan_id"},
	"loan_cash_sources":          {"cash_movements", "cash_movement_id"},
}

func link(ts []Table) error {
	by := map[string]*Table{}
	for i := range ts {
		by[ts[i].Name] = &ts[i]
	}
	for parent, rels := range childTables {
		p := by[parent]
		if p == nil {
			return fmt.Errorf("child list names unknown table %s", parent)
		}
		for _, r := range rels {
			c := by[r.Table]
			if c == nil {
				return fmt.Errorf("%s: unknown child table %s", parent, r.Table)
			}
			has := false
			for _, col := range c.Columns {
				if col.Name == r.Column {
					has = true
				}
			}
			if !has {
				return fmt.Errorf("%s has no column %s", r.Table, r.Column)
			}
			if c.Parent != nil {
				return fmt.Errorf("%s is listed under two parents", r.Table)
			}
			c.Parent = &Relation{Table: parent, Column: r.Column}
			p.Children = append(p.Children, r)
		}
	}
	for name, rel := range visibleVia {
		t, p := by[name], by[rel.Table]
		if t == nil || p == nil {
			return fmt.Errorf("visible-via names unknown table %s or %s", name, rel.Table)
		}
		r := rel
		t.VisibleVia = &r
	}
	for i := range ts {
		ts[i].Permission = tablePermission[ts[i].Name]
	}
	for i := range ts {
		for p := &ts[i]; p.Permission == "" && p.Parent != nil; {
			p = by[p.Parent.Table]
			ts[i].Permission = p.Permission
		}
		if ts[i].Permission == "" {
			return fmt.Errorf("table %s has no permission", ts[i].Name)
		}
	}
	for i := range ts {
		switch {
		case ts[i].Parent != nil:
			ts[i].Mode = "child"
		case ts[i].HasUpdatedAt:
			ts[i].Mode = "incremental"
		default:
			ts[i].Mode = "whole"
		}
	}
	return nil
}

// ByName returns one table, or nil.
func ByName(name string) *Table {
	ts, err := Tables()
	if err != nil {
		return nil
	}
	for i := range ts {
		if ts[i].Name == name {
			return &ts[i]
		}
	}
	return nil
}

// DDL is the SQLite statements that create the mirror.
func DDL() (string, error) {
	ts, err := Tables()
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, t := range ts {
		fmt.Fprintf(&b, "CREATE TABLE IF NOT EXISTS %s (\n  tenant_id INTEGER NOT NULL DEFAULT 0,\n", t.Name)
		for i, c := range t.Columns {
			fmt.Fprintf(&b, "  %s %s", c.Name, c.SQLType)
			if len(t.PrimaryKey) == 1 && t.PrimaryKey[0] == c.Name {
				b.WriteString(" PRIMARY KEY")
			}
			if i < len(t.Columns)-1 || len(t.PrimaryKey) > 1 {
				b.WriteString(",")
			}
			b.WriteString("\n")
		}
		if len(t.PrimaryKey) > 1 {
			fmt.Fprintf(&b, "  PRIMARY KEY (%s)\n", strings.Join(t.PrimaryKey, ", "))
		}
		b.WriteString(");\n")
		for _, c := range t.Columns {
			if strings.HasSuffix(c.Name, "_id") && c.Name != t.PrimaryKey[0] || c.Name == "uuid" || c.Name == "updated_at" {
				fmt.Fprintf(&b, "CREATE INDEX IF NOT EXISTS idx_%s_%s ON %s (%s);\n", t.Name, c.Name, t.Name, c.Name)
			}
		}
		b.WriteString("\n")
	}
	return b.String(), nil
}

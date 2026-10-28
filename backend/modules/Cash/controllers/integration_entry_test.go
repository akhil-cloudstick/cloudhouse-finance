package controllers

// Edits and deletes of manual cash-book entries (cash-in, debit, self transfer, gold sale, loan draw) and the
// info lookups for system lines, against the scratch database. Entries are built with the same functions the
// screens use and driven through the real UpdateMovement / DeleteMovement / GetMovementEntry handlers:
//
//	DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations go test ./modules/Cash/controllers/ -run Integration -v
//
// Refuses to run on any database not named ambikagold_scratch.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"

	"github.com/labstack/echo/v4"
)

const (
	itTenant = uint(5)
	itBranch = uint(6)
	itMarker = "ITCASH"
	// a gold loan of tenant 5 the lookups attach their records to (it only supplies a loan id and number)
	itGoldLoan = uint(221)
)

var itOnce sync.Once

func itCtx(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("DB_NAME") != "ambikagold_scratch" {
		t.Skip("integration test: set DB_NAME=ambikagold_scratch")
	}
	itOnce.Do(func() { config.InitDB() })
	ctx := config.WithTenant(context.Background(), itTenant)
	t.Cleanup(itCleanup)
	return ctx
}

func itCleanup() {
	db := config.BaseDB
	db.Exec(`DELETE FROM loan_cash_sources WHERE cash_movement_id IN (SELECT id FROM cash_movements WHERE tenant_id = ? AND remarks LIKE ?)`, itTenant, itMarker+"%")
	db.Exec(`DELETE FROM gold_sales WHERE tenant_id = ? AND remarks LIKE ?`, itTenant, itMarker+"%")
	db.Exec(`DELETE FROM cash_movements WHERE tenant_id = ? AND (remarks LIKE ? OR purpose LIKE 'Gold sale — IT %' OR purpose LIKE 'Gold sale cost — IT %')`, itTenant, itMarker+"%")
	db.Exec(`DELETE FROM cash_movements WHERE expense_id IN (SELECT id FROM expenses WHERE tenant_id = ? AND remarks LIKE ?)`, itTenant, itMarker+"%")
	db.Exec(`DELETE FROM expenses WHERE tenant_id = ? AND remarks LIKE ?`, itTenant, itMarker+"%")
	db.Exec(`DELETE FROM cash_sources WHERE tenant_id = ? AND name LIKE 'Loan IT %'`, itTenant)
}

// itBank inserts a bank with a large opening balance so debits and transfers pass the balance check.
func itBank(t *testing.T, name string) uint {
	t.Helper()
	var id uint
	if err := config.BaseDB.Raw(`INSERT INTO banks (name, tenant_id, branch_id, created_at, updated_at) VALUES (?, ?, ?, now(), now()) RETURNING id`, name, itTenant, itBranch).Row().Scan(&id); err != nil {
		t.Fatal(err)
	}
	config.BaseDB.Exec(`INSERT INTO cash_movements (type, source, purpose, mode, amount, status, occurred_on, created_at, branch_id, tenant_id, bank_id, is_manual) VALUES ('in', 'Other', 'IT seed', 'Bank Transfer', 1000000, 'Approved', now() - interval '300 days', now(), ?, ?, ?, false)`, itBranch, itTenant, id)
	t.Cleanup(func() {
		config.BaseDB.Exec(`DELETE FROM cash_movements WHERE bank_id = ? OR to_bank_id = ? OR counter_bank_id = ?`, id, id, id)
		config.BaseDB.Exec(`DELETE FROM banks WHERE id = ?`, id)
	})
	return id
}

// call runs a handler like the router would: tenant 5, pinned to branch 6.
func call(t *testing.T, h echo.HandlerFunc, method string, id uint, body any) (int, map[string]any) {
	t.Helper()
	var rd *strings.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	} else {
		rd = strings.NewReader("")
	}
	req := httptest.NewRequest(method, "/", rd)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set("tenantId", itTenant)
	c.Set("singleBranchHeadOffice", itBranch)
	c.SetParamNames("id")
	c.SetParamValues(strconv.FormatUint(uint64(id), 10))
	if err := h(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func dataOf(m map[string]any) map[string]any {
	d, _ := m["data"].(map[string]any)
	return d
}

func num(v any) float64 { f, _ := v.(float64); return f }

func mark(s string) string { return itMarker + " " + s }

func today() string { return time.Now().Format("2006-01-02") }

// movementsByGroup returns count and sum of lines of a group.
func groupLines(g string) (n int, sum float64) {
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE transaction_group_id = ? AND tenant_id = ?`, g, itTenant).Row().Scan(&n, &sum)
	return
}

func groupOf(id uint) string {
	var g string
	config.BaseDB.Raw(`SELECT COALESCE(transaction_group_id,'') FROM cash_movements WHERE id = ?`, id).Row().Scan(&g)
	return g
}

func exists(id uint) bool {
	var n int
	config.BaseDB.Raw(`SELECT count(*) FROM cash_movements WHERE id = ?`, id).Row().Scan(&n)
	return n == 1
}

// snapshot fingerprints every cash line / expense / gold sale / loan link carrying the test marker plus the given groups.
func snapshot(extraGroups ...string) string {
	var s strings.Builder
	rows, _ := config.BaseDB.Raw(`SELECT id, type, source, purpose, mode, amount, status, occurred_on, COALESCE(transaction_group_id,''), COALESCE(bank_id,0), COALESCE(to_bank_id,0), COALESCE(counter_bank_id,0), COALESCE(expense_id,0), is_manual, remarks
		FROM cash_movements WHERE tenant_id = ? AND (remarks LIKE ? OR transaction_group_id = ANY(?)) ORDER BY id`, itTenant, itMarker+"%", "{"+strings.Join(extraGroups, ",")+"}").Rows()
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var id, bank, to, counter, exp uint
			var typ, src, purpose, mode, status, group, remarks string
			var amt float64
			var occ time.Time
			var manual bool
			_ = rows.Scan(&id, &typ, &src, &purpose, &mode, &amt, &status, &occ, &group, &bank, &to, &counter, &exp, &manual, &remarks)
			fmt.Fprintf(&s, "cm[%d %s %s %s %s %v %s %s %s %d %d %d %d %v %s]\n", id, typ, src, purpose, mode, amt, status, occ.Format(time.RFC3339), group, bank, to, counter, exp, manual, remarks)
		}
	}
	rows2, _ := config.BaseDB.Raw(`SELECT id, category, amount, mode, status, COALESCE(group_id,''), COALESCE(cash_movement_id,0) FROM expenses WHERE tenant_id = ? AND remarks LIKE ? ORDER BY id`, itTenant, itMarker+"%").Rows()
	if rows2 != nil {
		defer rows2.Close()
		for rows2.Next() {
			var id, cm uint
			var cat, mode, status, group string
			var amt float64
			_ = rows2.Scan(&id, &cat, &amt, &mode, &status, &group, &cm)
			fmt.Fprintf(&s, "ex[%d %s %v %s %s %s %d]\n", id, cat, amt, mode, status, group, cm)
		}
	}
	rows3, _ := config.BaseDB.Raw(`SELECT id, ornament_type, sold_amount, cost_amount, COALESCE(cash_movement_id,0), COALESCE(cost_cash_movement_id,0) FROM gold_sales WHERE tenant_id = ? AND remarks LIKE ? ORDER BY id`, itTenant, itMarker+"%").Rows()
	if rows3 != nil {
		defer rows3.Close()
		for rows3.Next() {
			var id, cm, cc uint
			var orn string
			var sold, cost float64
			_ = rows3.Scan(&id, &orn, &sold, &cost, &cm, &cc)
			fmt.Fprintf(&s, "gs[%d %s %v %v %d %d]\n", id, orn, sold, cost, cm, cc)
		}
	}
	rows4, _ := config.BaseDB.Raw(`SELECT id, cash_movement_id, loan_number, principal_amount FROM loan_cash_sources WHERE cash_movement_id IN (SELECT id FROM cash_movements WHERE tenant_id = ? AND remarks LIKE ?) ORDER BY id`, itTenant, itMarker+"%").Rows()
	if rows4 != nil {
		defer rows4.Close()
		for rows4.Next() {
			var id, cm uint
			var ln string
			var pa float64
			_ = rows4.Scan(&id, &cm, &ln, &pa)
			fmt.Fprintf(&s, "lcs[%d %d %s %v]\n", id, cm, ln, pa)
		}
	}
	return s.String()
}

func itCashIn(t *testing.T, ctx context.Context, category, remarks string, occurred time.Time, parts []SplitPart) *models.CashMovement {
	t.Helper()
	var total float64
	for _, p := range parts {
		total += p.Amount
	}
	b := uint(itBranch)
	rec, err := SaveMovementParts(ctx, RecordMovementInput{Type: "in", Source: category, Amount: total, BranchID: &b, OccurredOn: occurred, Remarks: remarks, Manual: true}, nil, parts)
	if err != nil {
		t.Fatalf("create cash-in: %v", err)
	}
	return rec
}

func daysAgo(n int) time.Time {
	y, m, d := time.Now().Date()
	return time.Date(y, m, d-n, 12, 0, 0, 0, time.Local)
}

func TestIntegration_CashInEditDelete(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t, "IT Bank A")
	rem := mark("cashin")
	rec := itCashIn(t, ctx, "IT Misc Income", rem, daysAgo(3), []SplitPart{{Mode: "Cash", Amount: 500}})
	oldID := rec.ID

	// info lookup for a single line
	if code, out := call(t, GetMovementEntry, "GET", oldID, nil); code != 200 || dataOf(out)["kind"] != "cash_in" || num(dataOf(out)["amount"]) != 500 || dataOf(out)["editable"] != true {
		t.Fatalf("info: %d %v", code, out)
	}

	// edit: amount and remarks, still all cash
	code, out := call(t, UpdateMovement, "PATCH", oldID, map[string]any{"category": "IT Misc Income", "amount": 700, "occurred_on": daysAgo(2).Format("2006-01-02"), "remarks": rem + " v2"})
	if code != 200 {
		t.Fatalf("edit single: %d %v", code, out)
	}
	newID := uint(num(dataOf(out)["id"]))
	if exists(oldID) || !exists(newID) {
		t.Fatalf("old line should be replaced: old exists=%v new exists=%v", exists(oldID), exists(newID))
	}
	if n, sum := groupLines(groupOf(newID)); n != 1 || sum != 700 {
		t.Fatalf("lines %d sum %v", n, sum)
	}
	var m models.CashMovement
	config.BaseDB.WithContext(ctx).First(&m, newID)
	if !m.IsManual || m.Source != "IT Misc Income" || m.OccurredOn.Format("2006-01-02") != daysAgo(2).Format("2006-01-02") || m.Remarks != rem+" v2" || *m.BranchID != itBranch {
		t.Fatalf("edited line: %+v", m)
	}

	// convert to multi-mode: cash 300 + UPI 400 through a bank
	code, out = call(t, UpdateMovement, "PATCH", newID, map[string]any{"category": "IT Misc Income", "amount": 700, "remarks": rem + " v3",
		"payments": []map[string]any{{"mode": "Cash", "amount": 300}, {"mode": "UPI", "amount": 400, "bank_id": bank}}})
	if code != 200 {
		t.Fatalf("edit to multi: %d %v", code, out)
	}
	multiID := uint(num(dataOf(out)["id"]))
	g := groupOf(multiID)
	if n, sum := groupLines(g); n != 2 || sum != 700 || exists(newID) {
		t.Fatalf("multi lines %d sum %v oldExists=%v", n, sum, exists(newID))
	}
	var upiBank uint
	config.BaseDB.Raw(`SELECT COALESCE(bank_id,0) FROM cash_movements WHERE transaction_group_id = ? AND mode = 'UPI'`, g).Row().Scan(&upiBank)
	if upiBank != bank {
		t.Fatalf("UPI line bank %d want %d", upiBank, bank)
	}
	if code, out := call(t, GetMovementEntry, "GET", multiID, nil); code != 200 || num(dataOf(out)["amount"]) != 700 || len(dataOf(out)["lines"].([]any)) != 2 {
		t.Fatalf("multi info: %d %v", code, out)
	}

	// refusals leave the entry exactly as it was (same ids)
	before := snapshot()
	for name, tc := range map[string]struct {
		body map[string]any
		want int
	}{
		"parts do not add up":  {map[string]any{"category": "IT Misc Income", "amount": 700, "payments": []map[string]any{{"mode": "Cash", "amount": 100}, {"mode": "UPI", "amount": 100, "bank_id": bank}}}, 400},
		"upi without a bank":   {map[string]any{"category": "IT Misc Income", "amount": 700, "payments": []map[string]any{{"mode": "UPI", "amount": 700}}}, 400},
		"unknown mode":         {map[string]any{"category": "IT Misc Income", "amount": 700, "payments": []map[string]any{{"mode": "Barter", "amount": 700}}}, 400},
		"zero amount":          {map[string]any{"category": "IT Misc Income", "amount": 0}, 400},
		"negative amount":      {map[string]any{"category": "IT Misc Income", "amount": -5}, 400},
		"bad date":             {map[string]any{"category": "IT Misc Income", "amount": 700, "occurred_on": "31/12/2025"}, 400},
		"convert to bad types": {map[string]any{"kind": "gold_sale", "category": "x", "amount": 700}, 409},
	} {
		code, out := call(t, UpdateMovement, "PATCH", multiID, tc.body)
		if code != tc.want {
			t.Fatalf("%s: HTTP %d (want %d): %v", name, code, tc.want, out)
		}
		if after := snapshot(); after != before {
			t.Fatalf("%s: refused edit changed the ledger:\n%s\n--\n%s", name, before, after)
		}
	}
	if code, _ := call(t, UpdateMovement, "PATCH", 99999999, map[string]any{"amount": 1}); code != 404 {
		t.Fatalf("unknown id: %d", code)
	}

	// delete the multi-mode entry: both lines go
	code, out = call(t, DeleteMovement, "DELETE", multiID, nil)
	if code != 200 || num(dataOf(out)["deleted"]) != 2 {
		t.Fatalf("delete: %d %v", code, out)
	}
	if n, _ := groupLines(g); n != 0 || exists(multiID) {
		t.Fatal("lines left after delete")
	}
	if code, _ := call(t, DeleteMovement, "DELETE", multiID, nil); code != 404 {
		t.Fatalf("second delete: %d", code)
	}
	if snapshot() != "" {
		t.Fatalf("marker rows left:\n%s", snapshot())
	}
}

func itExpense(t *testing.T, ctx context.Context, category, remarks string, parts []SplitPart) *models.Expense {
	t.Helper()
	var total float64
	for _, p := range parts {
		total += p.Amount
	}
	rec, err := SaveExpenseParts(ctx, RecordExpenseInput{OccurredOn: daysAgo(2), Category: category, Amount: total, BranchID: itBranch, Remarks: remarks, Payee: "IT payee"}, parts)
	if err != nil {
		t.Fatalf("create expense: %v", err)
	}
	if rec.Status != "Approved" {
		t.Skip("expense approval workflow is on for this tenant; a debit would not book cash lines")
	}
	return rec
}

func TestIntegration_DebitEditDelete(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t, "IT Bank B")
	rem := mark("debit")
	rec := itExpense(t, ctx, "IT Office", rem, []SplitPart{{Mode: "Cash", Amount: 200}, {Mode: "UPI", Amount: 300, BankID: &bank}})
	var lineID uint
	config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE expense_id = ? ORDER BY id LIMIT 1`, rec.ID).Row().Scan(&lineID)
	if lineID == 0 {
		t.Fatal("no cash line for the expense")
	}
	var oldExp []uint
	config.BaseDB.Raw(`SELECT id FROM expenses WHERE tenant_id = ? AND remarks = ? ORDER BY id`, itTenant, rem).Scan(&oldExp)
	if len(oldExp) != 2 {
		t.Fatalf("expected 2 expense rows, got %d", len(oldExp))
	}
	if code, out := call(t, GetMovementEntry, "GET", lineID, nil); code != 200 || dataOf(out)["kind"] != "debit" || num(dataOf(out)["amount"]) != 500 || dataOf(out)["category"] != "IT Office" {
		t.Fatalf("info: %d %v", code, out)
	}

	// edit: new total and split, new category
	code, out := call(t, UpdateMovement, "PATCH", lineID, map[string]any{"category": "IT Office 2", "amount": 600, "remarks": rem + " v2",
		"payments": []map[string]any{{"mode": "Cash", "amount": 100}, {"mode": "UPI", "amount": 500, "bank_id": bank}}})
	if code != 200 {
		t.Fatalf("edit debit: %d %v", code, out)
	}
	var newExp []uint
	config.BaseDB.Raw(`SELECT id FROM expenses WHERE tenant_id = ? AND remarks LIKE ? ORDER BY id`, itTenant, rem+"%").Scan(&newExp)
	if len(newExp) != 2 {
		t.Fatalf("expected 2 expense rows after edit, got %v", newExp)
	}
	for _, id := range oldExp {
		var n int
		config.BaseDB.Raw(`SELECT count(*) FROM expenses WHERE id = ?`, id).Row().Scan(&n)
		if n != 0 {
			t.Fatalf("old expense %d still there", id)
		}
	}
	var sumExp float64
	var cats int
	config.BaseDB.Raw(`SELECT COALESCE(sum(amount),0), count(DISTINCT category) FROM expenses WHERE tenant_id = ? AND remarks LIKE ?`, itTenant, rem+"%").Row().Scan(&sumExp, &cats)
	if sumExp != 600 || cats != 1 {
		t.Fatalf("expense rows sum %v categories %d", sumExp, cats)
	}
	// every expense's cash line points back at it, and nothing else is left
	var linked, lines int
	var lineSum float64
	config.BaseDB.Raw(`SELECT count(*) FROM expenses e JOIN cash_movements m ON m.id = e.cash_movement_id AND m.expense_id = e.id WHERE e.tenant_id = ? AND e.remarks LIKE ?`, itTenant, rem+"%").Row().Scan(&linked)
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE tenant_id = ? AND remarks LIKE ?`, itTenant, rem+"%").Row().Scan(&lines, &lineSum)
	if linked != 2 || lines != 2 || lineSum != 600 {
		t.Fatalf("cash lines: linked %d, lines %d sum %v", linked, lines, lineSum)
	}
	var newLine uint
	config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE tenant_id = ? AND remarks LIKE ? ORDER BY id LIMIT 1`, itTenant, rem+"%").Row().Scan(&newLine)

	// a refused edit (more cash than is in hand) puts the original back, ids included
	before := snapshot()
	code, out = call(t, UpdateMovement, "PATCH", newLine, map[string]any{"category": "IT Office 2", "amount": 99999999999, "remarks": rem + " v2",
		"payments": []map[string]any{{"mode": "Cash", "amount": 99999999999}}})
	if code < 400 || code >= 500 {
		t.Fatalf("over-spending edit: HTTP %d %v", code, out)
	}
	if after := snapshot(); after != before {
		t.Fatalf("refused debit edit changed the ledger:\n%s\n--\n%s", before, after)
	}
	code, _ = call(t, UpdateMovement, "PATCH", newLine, map[string]any{"category": "IT Office 2", "amount": 600, "payments": []map[string]any{{"mode": "Cash", "amount": 50}}})
	if code != 400 || snapshot() != before {
		t.Fatalf("bad parts: %d changed=%v", code, snapshot() != before)
	}

	// pending expenses can neither be edited nor deleted from the ledger
	config.BaseDB.Exec(`UPDATE expenses SET status = 'Pending' WHERE tenant_id = ? AND remarks LIKE ?`, itTenant, rem+"%")
	before = snapshot()
	if code, _ := call(t, UpdateMovement, "PATCH", newLine, map[string]any{"category": "IT Office 2", "amount": 600, "payments": []map[string]any{{"mode": "Cash", "amount": 600}}}); code != 409 {
		t.Fatalf("edit pending: %d", code)
	}
	if code, _ := call(t, DeleteMovement, "DELETE", newLine, nil); code != 409 {
		t.Fatalf("delete pending: %d", code)
	}
	if snapshot() != before {
		t.Fatal("refusals changed data")
	}
	config.BaseDB.Exec(`UPDATE expenses SET status = 'Approved' WHERE tenant_id = ? AND remarks LIKE ?`, itTenant, rem+"%")

	// delete: expense records and both cash lines go
	code, out = call(t, DeleteMovement, "DELETE", newLine, nil)
	if code != 200 || num(dataOf(out)["deleted"]) != 2 {
		t.Fatalf("delete debit: %d %v", code, out)
	}
	if snapshot() != "" {
		t.Fatalf("rows left after delete:\n%s", snapshot())
	}
}

func TestIntegration_SelfTransferEditDelete(t *testing.T) {
	ctx := itCtx(t)
	a, b := itBank(t, "IT Bank C"), itBank(t, "IT Bank D")
	rem := mark("selftransfer")
	rows, err := recordSelfTransfer(ctx, RecordSelfTransferInput{Category: "IT Move", Amount: 1000, FromBankID: a, ToBankID: b, Mode: "Bank Transfer", BranchID: func() *uint { x := itBranch; return &x }(), OccurredOn: daysAgo(2), Remarks: rem})
	if err != nil || len(rows) != 2 {
		t.Fatalf("create: %v %d", err, len(rows))
	}
	id := rows[0].ID
	code, out := call(t, GetMovementEntry, "GET", id, nil)
	d := dataOf(out)
	if code != 200 || d["kind"] != "self_transfer" || num(d["amount"]) != 1000 || num(d["from_bank_id"]) != float64(a) || num(d["to_bank_id"]) != float64(b) {
		t.Fatalf("info: %d %v", code, out)
	}
	// edit: amount, banks swapped, date
	code, out = call(t, UpdateMovement, "PATCH", id, map[string]any{"category": "IT Move", "amount": 1500, "from_bank_id": b, "to_bank_id": a, "mode": "UPI", "occurred_on": daysAgo(1).Format("2006-01-02"), "remarks": rem})
	if code != 200 {
		t.Fatalf("edit: %d %v", code, out)
	}
	newID := uint(num(dataOf(out)["id"]))
	g := groupOf(newID)
	if n, sum := groupLines(g); n != 2 || sum != 3000 {
		t.Fatalf("legs %d sum %v", n, sum)
	}
	var outBank, inBank uint
	var mode string
	config.BaseDB.Raw(`SELECT bank_id, mode FROM cash_movements WHERE transaction_group_id = ? AND type = 'out'`, g).Row().Scan(&outBank, &mode)
	config.BaseDB.Raw(`SELECT bank_id FROM cash_movements WHERE transaction_group_id = ? AND type = 'in'`, g).Row().Scan(&inBank)
	if outBank != b || inBank != a || mode != "UPI" {
		t.Fatalf("legs: out %d in %d mode %s", outBank, inBank, mode)
	}
	var cnt int
	config.BaseDB.Raw(`SELECT count(*) FROM cash_movements WHERE id IN (?, ?)`, rows[0].ID, rows[1].ID).Row().Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("old legs left: %d", cnt)
	}
	// refusals
	before := snapshot()
	for name, body := range map[string]map[string]any{
		"same bank":    {"category": "IT Move", "amount": 10, "from_bank_id": a, "to_bank_id": a, "remarks": rem},
		"no from bank": {"category": "IT Move", "amount": 10, "to_bank_id": a, "remarks": rem},
		"zero amount":  {"category": "IT Move", "amount": 0, "from_bank_id": a, "to_bank_id": b, "remarks": rem},
		"bad mode":     {"category": "IT Move", "amount": 10, "from_bank_id": a, "to_bank_id": b, "mode": "Cash", "remarks": rem},
	} {
		if code, out := call(t, UpdateMovement, "PATCH", newID, body); code != 400 {
			t.Fatalf("%s: %d %v", name, code, out)
		}
		if snapshot() != before {
			t.Fatalf("%s: refusal changed data:\n%s\n--\n%s", name, before, snapshot())
		}
	}
	code, out = call(t, DeleteMovement, "DELETE", newID, nil)
	if code != 200 || num(dataOf(out)["deleted"]) != 2 || snapshot() != "" {
		t.Fatalf("delete: %d %v left:\n%s", code, out, snapshot())
	}
}

func TestIntegration_GoldSaleEditDelete(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t, "IT Bank E")
	rem := mark("goldsale")
	gs, err := createGoldSale(ctx, RecordGoldSaleInput{OrnamentType: "IT Chain", SoldAmount: 5000, CostAmount: 3000, SoldOn: daysAgo(2), BranchID: itBranch, Remarks: rem})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := *gs.CashMovementID
	costID := *gs.CostCashMovementID
	if code, out := call(t, GetMovementEntry, "GET", id, nil); code != 200 || dataOf(out)["kind"] != "gold_sale" || num(dataOf(out)["cost_amount"]) != 3000 {
		t.Fatalf("info: %d %v", code, out)
	}
	// edit: sold amount, cost, cost paid by UPI
	code, out := call(t, UpdateMovement, "PATCH", id, map[string]any{"amount": 6000, "ornament_type": "IT Chain 2", "cost_amount": 3500, "cost_mode": "UPI", "cost_bank_id": bank, "remarks": rem,
		"occurred_on": daysAgo(1).Format("2006-01-02")})
	if code != 200 || uint(num(dataOf(out)["id"])) != id {
		t.Fatalf("edit: %d %v", code, out)
	}
	var sold, cost, profit float64
	var costMode string
	config.BaseDB.Raw(`SELECT sold_amount, cost_amount, profit, COALESCE(cost_mode,'') FROM gold_sales WHERE id = ?`, gs.ID).Row().Scan(&sold, &cost, &profit, &costMode)
	if sold != 6000 || cost != 3500 || profit != 2500 || costMode != "UPI" {
		t.Fatalf("sale row: %v %v %v %s", sold, cost, profit, costMode)
	}
	var inAmt, outAmt float64
	var outBank uint
	var outMode, outPurpose string
	config.BaseDB.Raw(`SELECT amount FROM cash_movements WHERE id = ?`, id).Row().Scan(&inAmt)
	config.BaseDB.Raw(`SELECT amount, COALESCE(bank_id,0), mode, purpose FROM cash_movements WHERE id = ?`, costID).Row().Scan(&outAmt, &outBank, &outMode, &outPurpose)
	if inAmt != 6000 || outAmt != 3500 || outBank != bank || outMode != "UPI" || !strings.Contains(outPurpose, "IT Chain 2") {
		t.Fatalf("lines: in %v out %v bank %d mode %s purpose %q", inAmt, outAmt, outBank, outMode, outPurpose)
	}
	// refusals
	before := snapshot()
	for name, body := range map[string]map[string]any{
		"no ornament":      {"amount": 6000, "cost_amount": 3500},
		"zero sold":        {"amount": 0, "ornament_type": "X"},
		"negative cost":    {"amount": 100, "ornament_type": "X", "cost_amount": -1},
		"upi without bank": {"amount": 100, "ornament_type": "X", "mode": "UPI"},
		"cost upi no bank": {"amount": 100, "ornament_type": "X", "cost_amount": 10, "cost_mode": "UPI"},
		"cost bad mode":    {"amount": 100, "ornament_type": "X", "cost_amount": 10, "cost_mode": "Barter"},
	} {
		body["remarks"] = rem
		if code, out := call(t, UpdateMovement, "PATCH", id, body); code != 400 {
			t.Fatalf("%s: %d %v", name, code, out)
		}
		if snapshot() != before {
			t.Fatalf("%s: refusal changed data:\n%s\n--\n%s", name, before, snapshot())
		}
	}
	// cost to zero removes the cost line
	if code, out := call(t, UpdateMovement, "PATCH", id, map[string]any{"amount": 6000, "ornament_type": "IT Chain 2", "cost_amount": 0, "remarks": rem}); code != 200 {
		t.Fatalf("cost to zero: %d %v", code, out)
	}
	if exists(costID) {
		t.Fatal("cost line should be removed")
	}
	// and back: cost added again creates the line
	if code, out := call(t, UpdateMovement, "PATCH", id, map[string]any{"amount": 6000, "ornament_type": "IT Chain 2", "cost_amount": 1000, "remarks": rem}); code != 200 {
		t.Fatalf("cost back: %d %v", code, out)
	}
	var newCost uint
	config.BaseDB.Raw(`SELECT COALESCE(cost_cash_movement_id,0) FROM gold_sales WHERE id = ?`, gs.ID).Row().Scan(&newCost)
	if newCost == 0 || !exists(newCost) {
		t.Fatal("cost line not recreated")
	}
	// delete: sale record, sale line and cost line all go
	code, out = call(t, DeleteMovement, "DELETE", id, nil)
	if code != 200 || num(dataOf(out)["deleted"]) != 2 {
		t.Fatalf("delete: %d %v", code, out)
	}
	var left int
	config.BaseDB.Raw(`SELECT (SELECT count(*) FROM gold_sales WHERE id = ?) + (SELECT count(*) FROM cash_movements WHERE id IN (?, ?))`, gs.ID, id, newCost).Row().Scan(&left)
	if left != 0 {
		t.Fatalf("%d rows left after deleting a gold sale", left)
	}
}

func TestIntegration_LoanDrawEditDelete(t *testing.T) {
	ctx := itCtx(t)
	rem := mark("loandraw")
	b := uint(itBranch)
	rec, err := SaveMovementParts(ctx, RecordMovementInput{Type: "in", Source: "Loan IT Lender", Amount: 2000, BranchID: &b, OccurredOn: daysAgo(2), Remarks: rem, Manual: true},
		&LoanSourceInput{LoanNumber: "ITL-1", PrincipalAmount: 10000}, []SplitPart{{Mode: "Cash", Amount: 2000}})
	if err != nil {
		t.Fatalf("create draw: %v", err)
	}
	links := func() (n int, cmID uint, principal float64) {
		config.BaseDB.Raw(`SELECT count(*), COALESCE(max(cash_movement_id),0), COALESCE(max(principal_amount),0) FROM loan_cash_sources WHERE cash_movement_id IN (SELECT id FROM cash_movements WHERE tenant_id = ? AND remarks LIKE ?)`, itTenant, itMarker+"%").Row().Scan(&n, &cmID, &principal)
		return
	}
	if n, cm, p := links(); n != 1 || cm != rec.ID || p != 10000 {
		t.Fatalf("link after create: %d %d %v", n, cm, p)
	}
	if code, out := call(t, GetMovementEntry, "GET", rec.ID, nil); code != 200 || dataOf(out)["loan_number"] != "ITL-1" || num(dataOf(out)["principal_amount"]) != 10000 {
		t.Fatalf("info: %d %v", code, out)
	}
	// edit the amount: stays on the loan, link moves to the new line
	code, out := call(t, UpdateMovement, "PATCH", rec.ID, map[string]any{"category": "something else", "amount": 3000, "remarks": rem})
	if code != 200 {
		t.Fatalf("edit draw: %d %v", code, out)
	}
	newID := uint(num(dataOf(out)["id"]))
	if n, cm, p := links(); n != 1 || cm != newID || p != 10000 {
		t.Fatalf("link after edit: %d %d(%d) %v", n, cm, newID, p)
	}
	var src string
	config.BaseDB.Raw(`SELECT source FROM cash_movements WHERE id = ?`, newID).Row().Scan(&src)
	if src != "Loan IT Lender" {
		t.Fatalf("a draw must stay on its loan, source is %q", src)
	}
	// over the loan's balance is refused and the draw and its link are put back
	before := snapshot()
	if code, out := call(t, UpdateMovement, "PATCH", newID, map[string]any{"amount": 20000, "remarks": rem}); code != 400 {
		t.Fatalf("over-draw: %d %v", code, out)
	}
	if after := snapshot(); after != before {
		t.Fatalf("refused draw edit changed data:\n%s\n--\n%s", before, after)
	}
	// delete: the line and its link go
	code, out = call(t, DeleteMovement, "DELETE", newID, nil)
	if code != 200 {
		t.Fatalf("delete draw: %d %v", code, out)
	}
	if n, _, _ := links(); n != 0 || exists(newID) {
		t.Fatalf("link/line left after delete: %d", n)
	}
	var orphan int
	config.BaseDB.Raw(`SELECT count(*) FROM loan_cash_sources WHERE cash_movement_id = ?`, newID).Row().Scan(&orphan)
	if orphan != 0 {
		t.Fatal("orphan loan link")
	}
}

func TestIntegration_SystemEntriesRefused(t *testing.T) {
	ctx := itCtx(t)
	// system lines: a gold-loan top-up payout and a collection, neither keyed by a person
	id, group, err := RecordLoanTopUpCashOut(ctx, itGoldLoan, "IT-TOPUP", 100, 100, 0, 0, 0, itBranch, daysAgo(1), 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { config.BaseDB.Exec(`DELETE FROM cash_movements WHERE transaction_group_id = ?`, group) })
	id2, group2, err := RecordLoanPaymentCashIn(ctx, itGoldLoan, "IT-PAY", 50, 50, 0, 0, 0, itBranch, daysAgo(1), "Interest", 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { config.BaseDB.Exec(`DELETE FROM cash_movements WHERE transaction_group_id = ?`, group2) })
	snap := func() string {
		var s string
		config.BaseDB.Raw(`SELECT COALESCE(string_agg(id::text || ':' || amount::text || ':' || is_manual::text, ',' ORDER BY id), '') FROM cash_movements WHERE transaction_group_id IN (?, ?)`, group, group2).Row().Scan(&s)
		return s
	}
	before := snap()
	for _, lid := range []uint{id, id2} {
		if code, out := call(t, UpdateMovement, "PATCH", lid, map[string]any{"category": "x", "amount": 5}); code != 409 {
			t.Fatalf("edit system %d: %d %v", lid, code, out)
		}
		if code, out := call(t, DeleteMovement, "DELETE", lid, nil); code != 409 {
			t.Fatalf("delete system %d: %d %v", lid, code, out)
		}
		code, out := call(t, GetMovementEntry, "GET", lid, nil)
		if code != 200 || dataOf(out)["editable"] != false || dataOf(out)["kind"] != "system" {
			t.Fatalf("info of a system line should be read-only: %d %v", code, out)
		}
	}
	if snap() != before {
		t.Fatal("refusals changed data")
	}
	// a manual-looking line with an unknown shape (cash-out without an expense) is not deletable either
	var oid uint
	config.BaseDB.Raw(`INSERT INTO cash_movements (type, source, purpose, mode, amount, status, occurred_on, created_at, branch_id, tenant_id, is_manual, remarks) VALUES ('out','', 'IT odd', 'Cash', 5, 'Approved', now(), now(), ?, ?, true, ?) RETURNING id`, itBranch, itTenant, mark("odd")).Row().Scan(&oid)
	if code, _ := call(t, DeleteMovement, "DELETE", oid, nil); code != 409 {
		t.Fatalf("delete of an unclassifiable manual line: %d", code)
	}
	if code, _ := call(t, UpdateMovement, "PATCH", oid, map[string]any{"amount": 5}); code != 409 {
		t.Fatalf("edit of an unclassifiable manual line: %d", code)
	}
}

// infoOf returns the info popup's data for a movement.
func infoOf(t *testing.T, id uint) map[string]any {
	t.Helper()
	code, out := call(t, GetMovementEntry, "GET", id, nil)
	if code != 200 {
		t.Fatalf("info %d: %d %v", id, code, out)
	}
	return dataOf(out)
}

func goldLoanNumber(t *testing.T) string {
	var n string
	if err := config.BaseDB.Raw(`SELECT loan_number FROM loans WHERE id = ?`, itGoldLoan).Row().Scan(&n); err != nil || n == "" {
		t.Fatalf("template loan: %v", err)
	}
	return n
}

func TestIntegration_GoldLoanInfoLookups(t *testing.T) {
	ctx := itCtx(t)
	number := goldLoanNumber(t)
	var cleanupGroups []string
	var cleanupIDs []uint
	var linkRows struct{ pay, top, pledge []uint }
	t.Cleanup(func() {
		for _, g := range cleanupGroups {
			config.BaseDB.Exec(`DELETE FROM cash_movements WHERE transaction_group_id = ?`, g)
		}
		for _, id := range cleanupIDs {
			config.BaseDB.Exec(`DELETE FROM cash_movements WHERE id = ?`, id)
			config.BaseDB.Exec(`DELETE FROM expenses WHERE cash_movement_id = ?`, id)
		}
		config.BaseDB.Exec(`DELETE FROM loan_payments WHERE id = ANY(?)`, "{"+joinIDs(linkRows.pay)+"}")
		config.BaseDB.Exec(`DELETE FROM loan_top_ups WHERE id = ANY(?)`, "{"+joinIDs(linkRows.top)+"}")
		config.BaseDB.Exec(`DELETE FROM bank_pledge_records WHERE id = ANY(?)`, "{"+joinIDs(linkRows.pledge)+"}")
	})
	firstLine := func(group string) uint {
		var id uint
		config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE transaction_group_id = ? ORDER BY id LIMIT 1`, group).Row().Scan(&id)
		return id
	}
	bank := itBank(t, "IT Bank F")

	// repayment: found by the payment's saved cash_transaction_group_id
	_, g, err := RecordLoanPaymentCashIn(ctx, itGoldLoan, number, 100, 60, 40, 0, 0, itBranch, daysAgo(1), "Interest", 0, &bank)
	if err != nil {
		t.Fatal(err)
	}
	cleanupGroups = append(cleanupGroups, g)
	var payID uint
	config.BaseDB.Raw(`INSERT INTO loan_payments (tenant_id, loan_id, amount, type, paid_on, cash_transaction_group_id, created_at) VALUES (?, ?, 100, 'Interest', now(), ?, now()) RETURNING id`, itTenant, itGoldLoan, g).Row().Scan(&payID)
	linkRows.pay = append(linkRows.pay, payID)
	if payID == 0 {
		t.Fatal("could not create the loan payment link row")
	}
	// both lines of the group resolve to the same payment
	var ids []uint
	config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE transaction_group_id = ?`, g).Scan(&ids)
	if len(ids) != 2 {
		t.Fatalf("expected 2 repayment lines, got %d", len(ids))
	}
	for _, id := range ids {
		d := infoOf(t, id)
		if d["loan_entry"] != "payment" || num(d["loan_id"]) != float64(itGoldLoan) || num(d["loan_payment_id"]) != float64(payID) || d["editable"] != false {
			t.Fatalf("repayment line %d: %v", id, d)
		}
	}
	// an auction sale payment is named as such; a write-off has no entry
	_, g2, err := RecordLoanPaymentCashIn(ctx, itGoldLoan, number, 70, 70, 0, 0, 0, itBranch, daysAgo(1), "Auction sale", 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	cleanupGroups = append(cleanupGroups, g2)
	var auctionPay uint
	config.BaseDB.Raw(`INSERT INTO loan_payments (tenant_id, loan_id, amount, type, paid_on, cash_transaction_group_id, created_at) VALUES (?, ?, 70, 'Auction Sale', now(), ?, now()) RETURNING id`, itTenant, itGoldLoan, g2).Row().Scan(&auctionPay)
	linkRows.pay = append(linkRows.pay, auctionPay)
	if d := infoOf(t, firstLine(g2)); d["loan_entry"] != "auction_sale" || num(d["loan_payment_id"]) != float64(auctionPay) || num(d["loan_id"]) != float64(itGoldLoan) {
		t.Fatalf("auction sale line: %v", d)
	}
	_, g3, _ := RecordLoanPaymentCashIn(ctx, itGoldLoan, number, 5, 5, 0, 0, 0, itBranch, daysAgo(1), "Auction write-off", 0, nil)
	cleanupGroups = append(cleanupGroups, g3)
	var wo uint
	config.BaseDB.Raw(`INSERT INTO loan_payments (tenant_id, loan_id, amount, type, paid_on, cash_transaction_group_id, created_at) VALUES (?, ?, 5, 'Auction Write-Off', now(), ?, now()) RETURNING id`, itTenant, itGoldLoan, g3).Row().Scan(&wo)
	linkRows.pay = append(linkRows.pay, wo)
	if d := infoOf(t, firstLine(g3)); d["loan_entry"] != nil {
		t.Fatalf("write-off line must carry no entry: %v", d)
	}

	// top-up line: by group, and the fallback for older rows (exact timestamp, no saved group)
	occ := daysAgo(2)
	_, tg, err := RecordLoanTopUpCashOut(ctx, itGoldLoan, number, 500, 500, 0, 0, 0, itBranch, occ, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	cleanupGroups = append(cleanupGroups, tg)
	var topID uint
	config.BaseDB.Raw(`INSERT INTO loan_top_ups (tenant_id, loan_id, amount, eligible_amount_at_top_up, occurred_on, status, cash_transaction_group_id, created_at) VALUES (?, ?, 500, 500, ?, 'Active', ?, now()) RETURNING id`, itTenant, itGoldLoan, occ, tg).Row().Scan(&topID)
	linkRows.top = append(linkRows.top, topID)
	if d := infoOf(t, firstLine(tg)); d["loan_entry"] != "top_up" || num(d["loan_top_up_id"]) != float64(topID) || num(d["loan_id"]) != float64(itGoldLoan) {
		t.Fatalf("top-up by group: %v", d)
	}
	config.BaseDB.Exec(`UPDATE loan_top_ups SET cash_transaction_group_id = '' WHERE id = ?`, topID)
	if d := infoOf(t, firstLine(tg)); d["loan_entry"] != "top_up" || num(d["loan_top_up_id"]) != float64(topID) {
		t.Fatalf("top-up fallback: %v", d)
	}
	// a cancelled top-up is not offered
	config.BaseDB.Exec(`UPDATE loan_top_ups SET status = 'Cancelled' WHERE id = ?`, topID)
	if d := infoOf(t, firstLine(tg)); d["loan_entry"] != nil {
		t.Fatalf("inactive top-up offered: %v", d)
	}

	// disbursement line: by its source link
	dg, err := RecordLoanDisbursementGross(ctx, itGoldLoan, number, []SplitPart{{Mode: "Cash", Amount: 900}}, nil, itBranch, daysAgo(5), 0)
	if err != nil {
		t.Fatal(err)
	}
	cleanupGroups = append(cleanupGroups, dg)
	if d := infoOf(t, firstLine(dg)); d["loan_entry"] != "disbursement" || num(d["loan_id"]) != float64(itGoldLoan) {
		t.Fatalf("disbursement: %v", d)
	}

	// bank pledge (cash-in) and its release (cash-out)
	pid, err := RecordBankPledgeCashIn(ctx, itGoldLoan, number, "IT Pledge Bank", 800, 800, 0, 0, 0, nil, daysAgo(3))
	if err != nil {
		t.Fatal(err)
	}
	pg := groupOf(pid)
	cleanupGroups = append(cleanupGroups, pg)
	rid, err := RecordBankPledgeCashOut(ctx, itGoldLoan, number, "IT Pledge Bank", 800, 800, 0, 0, 0, nil, daysAgo(1), itBranch)
	if err != nil {
		t.Fatal(err)
	}
	rg := groupOf(rid)
	cleanupGroups = append(cleanupGroups, rg)
	var pledgeID uint
	config.BaseDB.Raw(`INSERT INTO bank_pledge_records (tenant_id, loan_id, bank_name, pledged_amount, pledge_date, status, cash_transaction_group_id, release_cash_transaction_group_id, created_at) VALUES (?, ?, 'IT Pledge Bank', 800, now(), 'Released', ?, ?, now()) RETURNING id`, itTenant, itGoldLoan, pg, rg).Row().Scan(&pledgeID)
	linkRows.pledge = append(linkRows.pledge, pledgeID)
	if d := infoOf(t, pid); d["loan_entry"] != "bank_pledge" || num(d["bank_pledge_id"]) != float64(pledgeID) || num(d["loan_id"]) != float64(itGoldLoan) {
		t.Fatalf("pledge line: %v", d)
	}
	if d := infoOf(t, rid); d["loan_entry"] != "bank_pledge_release" || num(d["bank_pledge_id"]) != float64(pledgeID) {
		t.Fatalf("pledge release line: %v", d)
	}
	// a voided pledge is not offered
	config.BaseDB.Exec(`UPDATE bank_pledge_records SET status = 'Voided' WHERE id = ?`, pledgeID)
	if d := infoOf(t, pid); d["loan_entry"] != nil {
		t.Fatalf("voided pledge offered: %v", d)
	}

	// auction: surplus settlement and expense, both by the loan number
	sid, err := RecordAuctionSurplusCashOut(ctx, itGoldLoan, number, 120, itBranch, daysAgo(1), "Cash", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	cleanupIDs = append(cleanupIDs, sid)
	if d := infoOf(t, sid); d["loan_entry"] != "auction_surplus" || num(d["loan_id"]) != float64(itGoldLoan) {
		t.Fatalf("auction surplus: %v", d)
	}
	eid, err := RecordAuctionExpense(ctx, number, 30, "Cash", nil, itBranch, daysAgo(1))
	if err != nil {
		t.Fatal(err)
	}
	var expLine uint
	config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE expense_id = ?`, eid).Row().Scan(&expLine)
	cleanupIDs = append(cleanupIDs, expLine)
	config.BaseDB.Exec(`UPDATE expenses SET remarks = ? WHERE id = ?`, mark("auction"), eid)
	if d := infoOf(t, expLine); d["loan_entry"] != "auction_expense" || num(d["loan_id"]) != float64(itGoldLoan) {
		t.Fatalf("auction expense: %v", d)
	}
	_ = http.StatusOK
}

func joinIDs(ids []uint) string {
	s := make([]string, len(ids))
	for i, v := range ids {
		s[i] = strconv.FormatUint(uint64(v), 10)
	}
	return strings.Join(s, ",")
}

func TestIntegration_ConvertAndLenderTransfer(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t, "IT Bank G")
	bank2 := itBank(t, "IT Bank H")
	rem := mark("convert")
	rec := itCashIn(t, ctx, "IT Misc Income", rem, daysAgo(2), []SplitPart{{Mode: "Cash", Amount: 400}})
	// cash-in -> debit
	code, out := call(t, UpdateMovement, "PATCH", rec.ID, map[string]any{"kind": "debit", "category": "IT Convert", "amount": 400, "remarks": rem})
	if code != 200 {
		t.Fatalf("cash-in to debit: %d %v", code, out)
	}
	id := uint(num(dataOf(out)["id"]))
	if exists(rec.ID) {
		t.Fatal("old cash-in left")
	}
	var exp int
	config.BaseDB.Raw(`SELECT count(*) FROM expenses WHERE tenant_id = ? AND remarks = ? AND amount = 400`, itTenant, rem).Row().Scan(&exp)
	if exp != 1 {
		t.Fatalf("expected an expense after conversion, got %d", exp)
	}
	var line uint
	config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE tenant_id = ? AND remarks = ?`, itTenant, rem).Row().Scan(&line)
	if d := infoOf(t, line); d["kind"] != "debit" {
		t.Fatalf("converted entry: %v", d)
	}
	// debit -> self transfer between banks
	code, out = call(t, UpdateMovement, "PATCH", line, map[string]any{"kind": "self_transfer", "category": "IT Convert", "amount": 400, "from_bank_id": bank, "to_bank_id": bank2, "mode": "Bank Transfer", "remarks": rem})
	if code != 200 {
		t.Fatalf("debit to transfer: %d %v", code, out)
	}
	config.BaseDB.Raw(`SELECT count(*) FROM expenses WHERE tenant_id = ? AND remarks = ?`, itTenant, rem).Row().Scan(&exp)
	var n int
	var sum float64
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE tenant_id = ? AND remarks = ?`, itTenant, rem).Row().Scan(&n, &sum)
	if exp != 0 || n != 2 || sum != 800 {
		t.Fatalf("after debit->transfer: %d expenses, %d lines sum %v", exp, n, sum)
	}
	// a refused conversion (same banks) puts the transfer back untouched
	var tid uint
	config.BaseDB.Raw(`SELECT min(id) FROM cash_movements WHERE tenant_id = ? AND remarks = ?`, itTenant, rem).Row().Scan(&tid)
	before := snapshot()
	if code, _ := call(t, UpdateMovement, "PATCH", tid, map[string]any{"kind": "cash_in", "category": "", "amount": 400, "remarks": rem}); code != 400 {
		t.Fatalf("convert without category: %d", code)
	}
	if code, _ := call(t, UpdateMovement, "PATCH", tid, map[string]any{"kind": "debit", "category": "IT Convert", "amount": 400, "remarks": rem, "payments": []map[string]any{{"mode": "UPI", "amount": 400}}}); code != 400 {
		t.Fatalf("convert with bad parts: %d", code)
	}
	if snapshot() != before {
		t.Fatalf("refused conversion changed data:\n%s\n--\n%s", before, snapshot())
	}
	_ = id
	if code, _ := call(t, DeleteMovement, "DELETE", tid, nil); code != 200 || snapshot() != "" {
		t.Fatal("delete transfer")
	}

	// transfer to a lender: one debit leg only; editable and deletable like the rest
	_, err := SaveMovementParts(ctx, RecordMovementInput{Type: "in", Source: "Loan IT Lender2", Amount: 5000, BranchID: func() *uint { b := itBranch; return &b }(), OccurredOn: daysAgo(3), Remarks: rem + " draw", Manual: true},
		&LoanSourceInput{LoanNumber: "ITL-2", PrincipalAmount: 10000}, []SplitPart{{Mode: "Cash", Amount: 5000}})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := recordSelfTransfer(ctx, RecordSelfTransferInput{Category: "Loan IT Lender2", Amount: 1000, FromBankID: bank, FromBank: "IT Bank G", Mode: "Bank Transfer", BranchID: func() *uint { b := itBranch; return &b }(), OccurredOn: daysAgo(1), Remarks: rem + " repay"})
	if err != nil || len(rows) != 1 {
		t.Fatalf("lender transfer: %v %d", err, len(rows))
	}
	code, out = call(t, UpdateMovement, "PATCH", rows[0].ID, map[string]any{"category": "Loan IT Lender2", "amount": 1200, "from_bank_id": bank, "from_bank": "IT Bank G", "mode": "Bank Transfer", "remarks": rem + " repay"})
	if code != 200 {
		t.Fatalf("edit lender transfer: %d %v", code, out)
	}
	var cnt int
	var amt float64
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE tenant_id = ? AND remarks = ?`, itTenant, rem+" repay").Row().Scan(&cnt, &amt)
	if cnt != 1 || amt != 1200 {
		t.Fatalf("lender leg: %d lines sum %v", cnt, amt)
	}
	newID := uint(num(dataOf(out)["id"]))
	if code, out := call(t, DeleteMovement, "DELETE", newID, nil); code != 200 || num(dataOf(out)["deleted"]) != 1 {
		t.Fatalf("delete lender leg: %d %v", code, out)
	}
}

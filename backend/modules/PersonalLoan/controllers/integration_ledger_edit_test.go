package controllers

// Personal-loan payment/disbursement edits and deletes against the scratch database. Loans are created with
// SavePersonalLoan / SavePersonalLoanPayment and cleaned up afterwards:
//
//	DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations go test ./modules/PersonalLoan/controllers/ -run Integration -v
//
// Refuses to run on any database not named ambikagold_scratch.

import (
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/labstack/echo/v4"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/PersonalLoan/models"
)

const (
	itTenant   = uint(5)
	itBranch   = uint(6)
	itCustomer = uint(190)
)

var itOnce sync.Once

func itCtx(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("DB_NAME") != "ambikagold_scratch" {
		t.Skip("integration test: set DB_NAME=ambikagold_scratch")
	}
	itOnce.Do(func() { config.InitDB() })
	return config.WithTenant(context.Background(), itTenant)
}

func statusOf(err error) int {
	var se common.StatusedError
	if errors.As(err, &se) {
		return se.Status()
	}
	return 0
}

func expectStatus(t *testing.T, what string, err error, want int) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected HTTP %d, got no error", what, want)
	}
	if got := statusOf(err); got != want {
		t.Fatalf("%s: expected HTTP %d, got %d (%v)", what, want, got, err)
	}
}

func itBank(t *testing.T) uint {
	t.Helper()
	var id uint
	if err := config.BaseDB.Raw(`INSERT INTO banks (name, tenant_id, branch_id, created_at, updated_at) VALUES ('IT Bank', ?, ?, now(), now()) RETURNING id`, itTenant, itBranch).Row().Scan(&id); err != nil {
		t.Fatal(err)
	}
	config.BaseDB.Exec(`INSERT INTO cash_movements (type, source, purpose, mode, amount, status, occurred_on, created_at, branch_id, tenant_id, bank_id, is_manual) VALUES ('in', 'Other', 'IT seed', 'Bank Transfer', 100000, 'Approved', now() - interval '30 days', now(), ?, ?, ?, false)`, itBranch, itTenant, id)
	t.Cleanup(func() {
		config.BaseDB.Exec(`DELETE FROM cash_movements WHERE bank_id = ?`, id)
		config.BaseDB.Exec(`DELETE FROM banks WHERE id = ?`, id)
	})
	return id
}

// itLoan creates a loan (principal 1200 = 1000 paid out + 200 interest, 4 monthly instalments of 300) opened
// 10 days ago, then makes one payment per amount, dated 8, 5, 3... days ago.
func itLoan(t *testing.T, ctx context.Context, amounts ...float64) *models.PersonalLoan {
	t.Helper()
	l, err := SavePersonalLoan(ctx, CreateInput{BranchID: itBranch, CustomerID: itCustomer, PrincipalAmount: 1200, InterestType: "Flat", InterestValue: 200,
		Frequency: "Monthly", TenureCount: 4, CashAmount: 1000})
	if err != nil {
		t.Fatalf("create loan: %v", err)
	}
	t.Cleanup(func() { itPurge(l.ID, l.LoanNumber) })
	if l.Status != models.StatusActive {
		t.Skipf("tenant workflow requires approval (status %s); cannot build an active loan", l.Status)
	}
	days := []int{8, 5, 3, 2, 1}
	for i, a := range amounts {
		if _, err := SavePersonalLoanPayment(ctx, l.ID, nil, PaymentInput{Amount: a, CashAmount: a, Reference: fmt.Sprintf("ref%d", i)}); err != nil {
			t.Fatalf("payment %d: %v", i, err)
		}
	}
	config.BaseDB.Exec(`UPDATE personal_loans SET opened_date = now() - interval '10 days', disbursed_at = now() - interval '10 days' WHERE id = ?`, l.ID)
	config.BaseDB.Exec(`UPDATE cash_movements SET occurred_on = now() - interval '10 days' WHERE transaction_group_id = (SELECT disbursement_cash_group_id FROM personal_loans WHERE id = ?)`, l.ID)
	var ids []uint
	config.BaseDB.Raw(`SELECT id FROM personal_loan_payments WHERE personal_loan_id = ? ORDER BY id`, l.ID).Scan(&ids)
	for i, id := range ids {
		d := fmt.Sprintf("%d days", days[i])
		config.BaseDB.Exec(`UPDATE personal_loan_payments SET paid_on = now() - ?::interval WHERE id = ?`, d, id)
		config.BaseDB.Exec(`UPDATE cash_movements SET occurred_on = now() - ?::interval WHERE transaction_group_id = (SELECT cash_transaction_group_id FROM personal_loan_payments WHERE id = ?)`, d, id)
	}
	return itGet(t, ctx, l.ID)
}

func itPurge(id uint, number string) {
	config.BaseDB.Exec(`DELETE FROM cash_movements WHERE purpose LIKE ?`, "%"+number)
	config.BaseDB.Exec(`DELETE FROM personal_loan_payments WHERE personal_loan_id = ?`, id)
	config.BaseDB.Exec(`DELETE FROM personal_loan_installments WHERE personal_loan_id = ?`, id)
	config.BaseDB.Exec(`DELETE FROM personal_loan_history WHERE personal_loan_id = ?`, id)
	config.BaseDB.Exec(`DELETE FROM audit_log_entries WHERE entity_type = 'personal_loan' AND entity_id = ?`, id)
	config.BaseDB.Exec(`DELETE FROM personal_loans WHERE id = ?`, id)
}

func itGet(t *testing.T, ctx context.Context, id uint) *models.PersonalLoan {
	t.Helper()
	l, err := findPersonalLoanByID(ctx, id, nil)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func itPays(t *testing.T, ctx context.Context, id uint) []models.PersonalLoanPayment {
	t.Helper()
	p, _, err := loadPersonalReplay(ctx, config.BaseDB, id)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func itInsts(t *testing.T, ctx context.Context, id uint) []models.PersonalLoanInstallment {
	t.Helper()
	_, i, err := loadPersonalReplay(ctx, config.BaseDB, id)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

// itLines is every cash line of the loan: count and signed net (in positive, out negative).
func itLines(number string) (n int, net float64) {
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(CASE WHEN type='in' THEN amount ELSE -amount END),0) FROM cash_movements WHERE purpose LIKE ?`, "%"+number).Row().Scan(&n, &net)
	return
}

func itGroup(g string) (n int, sum float64) {
	if g == "" {
		return
	}
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE transaction_group_id = ?`, g).Row().Scan(&n, &sum)
	return
}

// itFingerprint captures everything an edit could touch, to prove a refused edit changed nothing.
func itFingerprint(t *testing.T, ctx context.Context, id uint, number string) string {
	t.Helper()
	l := itGet(t, ctx, id)
	s := fmt.Sprintf("loan[%v %v %s %v %v %s] ", l.OutstandingAmount, l.TotalPaid, l.Status, l.DisbursedAt.Format(time.RFC3339), l.ClosedAt, l.DisbursementCashGroupID)
	for _, p := range itPays(t, ctx, id) {
		s += fmt.Sprintf("pay[%d %v %s %v %v %v %v %s %v %s] ", p.ID, p.Amount, p.PaidOn.Format(time.RFC3339), p.RunningBalance, p.CashAmount, p.UpiAmount, p.BankID, p.CashTransactionGroupID, p.Method, p.Reference)
	}
	for _, i := range itInsts(t, ctx, id) {
		s += fmt.Sprintf("inst[%d %v %s] ", i.SequenceNo, i.PaidAmount, i.Status)
	}
	var rows []cashModels.CashMovement
	config.BaseDB.Raw(`SELECT * FROM cash_movements WHERE purpose LIKE ? ORDER BY id`, "%"+number).Scan(&rows)
	for _, r := range rows {
		s += fmt.Sprintf("cm[%d %v %s %s %v] ", r.ID, r.Amount, r.TransactionGroupID, r.Source, r.OccurredOn.Format(time.RFC3339))
	}
	return s
}

func f(v float64) *float64 { return &v }
func sp(v string) *string  { return &v }
func dayAgo(n int) time.Time {
	return time.Now().AddDate(0, 0, -n)
}

// checkConsistent asserts the loan's stored figures equal a fresh replay and every payment has exactly its
// own cash group, so cash lines match payments.
func checkConsistent(t *testing.T, ctx context.Context, id uint) {
	t.Helper()
	l := itGet(t, ctx, id)
	pays := itPays(t, ctx, id)
	insts := itInsts(t, ctx, id)
	run, out, err := replayBalances(l.PrincipalAmount, pays)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	for i := range pays {
		if math.Abs(pays[i].RunningBalance-run[i]) > 0.001 {
			t.Fatalf("payment %d running balance %v want %v", pays[i].ID, pays[i].RunningBalance, run[i])
		}
	}
	if math.Abs(out-l.OutstandingAmount) > 0.001 || math.Abs(sumPayments(pays)-l.TotalPaid) > 0.001 {
		t.Fatalf("totals: outstanding %v/%v paid %v/%v", l.OutstandingAmount, out, l.TotalPaid, sumPayments(pays))
	}
	if d := sameInstallments(insts, replayInstallments(insts, l.TotalPaid)); d != "" {
		t.Fatalf("instalments: %s", d)
	}
	if out <= 0.01 && l.Status != models.StatusClosed {
		t.Fatalf("should be Closed, is %s", l.Status)
	}
	if out > 0.01 && l.Status == models.StatusClosed {
		t.Fatalf("still Closed with outstanding %v", out)
	}
	totalIn := 0.0
	for _, p := range pays {
		n, sum := itGroup(p.CashTransactionGroupID)
		if p.CashTransactionGroupID == "" || n == 0 || math.Abs(sum-p.Amount) > 0.001 {
			t.Fatalf("payment %d cash group %q has %d lines sum %v, want %v", p.ID, p.CashTransactionGroupID, n, sum, p.Amount)
		}
		totalIn += p.Amount
	}
	_, net := itLines(l.LoanNumber)
	if math.Abs(net-(totalIn-l.DisbursedAmount)) > 0.001 {
		t.Fatalf("cash net of loan lines %v, want %v (stray or missing lines)", net, totalIn-l.DisbursedAmount)
	}
	dn, dsum := itGroup(l.DisbursementCashGroupID)
	if dn == 0 || math.Abs(dsum-l.DisbursedAmount) > 0.001 {
		t.Fatalf("disbursement group %q: %d lines sum %v want %v", l.DisbursementCashGroupID, dn, dsum, l.DisbursedAmount)
	}
}

func TestIntegration_PL_EditPayments(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t)
	l := itLoan(t, ctx, 300, 250, 400)
	checkConsistent(t, ctx, l.ID)
	if l.OutstandingAmount != 250 || l.TotalPaid != 950 {
		t.Fatalf("setup: %v %v", l.OutstandingAmount, l.TotalPaid)
	}
	pays := itPays(t, ctx, l.ID)
	first, mid, last := pays[0].ID, pays[1].ID, pays[2].ID

	// middle: amount 250 -> 300
	if _, _, err := editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{Amount: f(300), CashAmount: f(300)}, "", false); err != nil {
		t.Fatalf("edit middle: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	got := itGet(t, ctx, l.ID)
	if got.OutstandingAmount != 200 || got.TotalPaid != 1000 {
		t.Fatalf("after middle edit: %v %v", got.OutstandingAmount, got.TotalPaid)
	}
	p := itPays(t, ctx, l.ID)
	if p[0].RunningBalance != 900 || p[1].RunningBalance != 600 || p[2].RunningBalance != 200 {
		t.Fatalf("running balances %v %v %v", p[0].RunningBalance, p[1].RunningBalance, p[2].RunningBalance)
	}
	insts := itInsts(t, ctx, l.ID)
	if insts[0].Status != "Paid" || insts[1].Status != "Paid" || insts[2].Status != "Paid" || insts[3].Status == "Paid" || insts[3].PaidAmount != 100 {
		t.Fatalf("instalments: %+v", insts)
	}

	// first: date, UPI split with bank, reference
	d7 := dayAgo(7)
	if _, _, err := editPersonalPayment(ctx, l.ID, first, nil, &PersonalPaymentEdit{PaidOn: &d7,
		CashAmount: f(100), UpiAmount: f(200), BankID: &bank, Reference: sp("NEWREF")}, "", false); err != nil {
		t.Fatalf("edit first: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	p = itPays(t, ctx, l.ID)
	if p[0].ID != first || p[0].Reference != "NEWREF" || p[0].Method == "Cash" || p[0].BankID == nil || *p[0].BankID != bank || p[0].UpiAmount != 200 {
		t.Fatalf("first payment not updated: %+v", p[0])
	}
	var bankLines int
	config.BaseDB.Raw(`SELECT count(*) FROM cash_movements WHERE transaction_group_id = ? AND bank_id = ?`, p[0].CashTransactionGroupID, bank).Row().Scan(&bankLines)
	if bankLines != 1 {
		t.Fatalf("expected 1 bank line for the UPI part, got %d", bankLines)
	}
	if p[0].PaidOn.Format("2006-01-02") != d7.Format("2006-01-02") {
		t.Fatalf("date %v", p[0].PaidOn)
	}
	var occ time.Time
	config.BaseDB.Raw(`SELECT occurred_on FROM cash_movements WHERE transaction_group_id = ? LIMIT 1`, p[0].CashTransactionGroupID).Row().Scan(&occ)
	if occ.Format("2006-01-02") != d7.Format("2006-01-02") {
		t.Fatalf("cash line date %v", occ)
	}

	// last: amount 400 -> 600 closes the loan (300+300+600 = 1200)
	if _, _, err := editPersonalPayment(ctx, l.ID, last, nil, &PersonalPaymentEdit{Amount: f(600), CashAmount: f(600)}, "", false); err != nil {
		t.Fatalf("edit last: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	got = itGet(t, ctx, l.ID)
	if got.Status != models.StatusClosed || got.OutstandingAmount != 0 || got.ClosedAt == nil {
		t.Fatalf("expected Closed: %+v", got)
	}
	// reopen: back to 400
	if _, _, err := editPersonalPayment(ctx, l.ID, last, nil, &PersonalPaymentEdit{Amount: f(400), CashAmount: f(400)}, "", false); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	got = itGet(t, ctx, l.ID)
	if got.Status == models.StatusClosed || got.ClosedAt != nil || got.OutstandingAmount != 200 {
		t.Fatalf("expected reopened: status %s closedAt %v out %v", got.Status, got.ClosedAt, got.OutstandingAmount)
	}
}

func TestIntegration_PL_DeletePayments(t *testing.T) {
	ctx := itCtx(t)
	l := itLoan(t, ctx, 300, 250, 400)
	pays := itPays(t, ctx, l.ID)
	oldGroups := []string{pays[0].CashTransactionGroupID, pays[1].CashTransactionGroupID, pays[2].CashTransactionGroupID}
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[1].ID, nil, nil, "x", false); err != nil {
		t.Fatalf("delete middle: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	if n, _ := itGroup(oldGroups[1]); n != 0 {
		t.Fatal("middle cash lines left")
	}
	got := itGet(t, ctx, l.ID)
	if got.OutstandingAmount != 500 || got.TotalPaid != 700 || len(itPays(t, ctx, l.ID)) != 2 {
		t.Fatalf("after middle delete: %v %v", got.OutstandingAmount, got.TotalPaid)
	}
	if itPays(t, ctx, l.ID)[1].RunningBalance != 500 {
		t.Fatal("last running balance not recomputed")
	}
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[0].ID, nil, nil, "", false); err != nil {
		t.Fatalf("delete first: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[2].ID, nil, nil, "", false); err != nil {
		t.Fatalf("delete last: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	got = itGet(t, ctx, l.ID)
	if got.OutstandingAmount != 1200 || got.TotalPaid != 0 {
		t.Fatalf("back to untouched: %v %v", got.OutstandingAmount, got.TotalPaid)
	}
	for _, i := range itInsts(t, ctx, l.ID) {
		if i.PaidAmount != 0 || i.Status == "Paid" {
			t.Fatalf("instalment not reset: %+v", i)
		}
	}
	for _, g := range oldGroups {
		if n, _ := itGroup(g); n != 0 {
			t.Fatalf("group %s left", g)
		}
	}
	// delete from a Closed loan reopens it
	l2 := itLoan(t, ctx, 700, 500)
	if itGet(t, ctx, l2.ID).Status != models.StatusClosed {
		t.Fatal("setup: should be closed")
	}
	p2 := itPays(t, ctx, l2.ID)
	if _, _, err := editPersonalPayment(ctx, l2.ID, p2[1].ID, nil, nil, "", false); err != nil {
		t.Fatalf("delete from closed: %v", err)
	}
	checkConsistent(t, ctx, l2.ID)
	if g := itGet(t, ctx, l2.ID); g.Status == models.StatusClosed || g.ClosedAt != nil || g.OutstandingAmount != 500 {
		t.Fatalf("not reopened: %+v", g)
	}
}

func TestIntegration_PL_DryRunChangesNothing(t *testing.T) {
	ctx := itCtx(t)
	l := itLoan(t, ctx, 300, 250, 400)
	pays := itPays(t, ctx, l.ID)
	before := itFingerprint(t, ctx, l.ID, l.LoanNumber)
	res, _, err := editPersonalPayment(ctx, l.ID, pays[1].ID, nil, &PersonalPaymentEdit{Amount: f(450), CashAmount: f(450)}, "", true)
	if err != nil || !res.DryRun || res.After.Outstanding != 50 || res.Before.Outstanding != 250 {
		t.Fatalf("dry edit: %v %+v", err, res)
	}
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[0].ID, nil, nil, "", true); err != nil {
		t.Fatalf("dry delete: %v", err)
	}
	d := dayAgo(9)
	if _, _, err := editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{DisbursedAt: &d}, "", true); err != nil {
		t.Fatalf("dry disbursement: %v", err)
	}
	if after := itFingerprint(t, ctx, l.ID, l.LoanNumber); after != before {
		t.Fatalf("dry run changed data:\n%s\n%s", before, after)
	}
}

func TestIntegration_PL_Refusals(t *testing.T) {
	ctx := itCtx(t)
	l := itLoan(t, ctx, 300, 250, 400)
	pays := itPays(t, ctx, l.ID)
	mid := pays[1].ID
	fp := func() string { return itFingerprint(t, ctx, l.ID, l.LoanNumber) }
	before := fp()
	chk := func(name string, err error, want int) {
		t.Helper()
		expectStatus(t, name, err, want)
		if fp() != before {
			t.Fatalf("%s: refused edit changed data", name)
		}
	}
	fut := time.Now().AddDate(0, 0, 3)
	_, _, err := editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{PaidOn: &fut}, "", false)
	chk("future date", err, http.StatusBadRequest)
	old := time.Now().AddDate(0, 0, -30)
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{PaidOn: &old}, "", false)
	chk("before disbursement", err, http.StatusBadRequest)
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{Amount: f(250), CashAmount: f(100)}, "", false)
	chk("bad split", err, http.StatusBadRequest)
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{Amount: f(250), CashAmount: f(0), UpiAmount: f(250)}, "", false)
	chk("upi without bank", err, http.StatusBadRequest)
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{Amount: f(0)}, "", false)
	chk("zero amount", err, http.StatusBadRequest)
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{Amount: f(900), CashAmount: f(900)}, "", false)
	chk("overpay", err, http.StatusBadRequest)
	_, _, err = editPersonalPayment(ctx, l.ID, 99999999, nil, nil, "", false)
	chk("unknown payment", err, http.StatusNotFound)
	_, _, err = editPersonalPayment(ctx, 99999999, mid, nil, nil, "", false)
	expectStatus(t, "unknown loan", err, http.StatusNotFound)
	other := uint(999)
	_, _, err = editPersonalPayment(ctx, l.ID, mid, &other, nil, "", false)
	chk("other branch scope", err, http.StatusNotFound)

	fd := time.Now().AddDate(0, 0, 2)
	_, _, err = editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{DisbursedAt: &fd}, "", false)
	chk("future disbursement", err, http.StatusBadRequest)
	ad := dayAgo(4)
	_, _, err = editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{DisbursedAt: &ad}, "", false)
	chk("disbursement after first payment", err, http.StatusBadRequest)
	_, _, err = editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{CashAmount: f(500)}, "", false)
	chk("disbursement bad split", err, http.StatusBadRequest)
	_, _, err = editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{CashAmount: f(0), UpiAmount: f(1000)}, "", false)
	chk("disbursement upi without bank", err, http.StatusBadRequest)

	config.BaseDB.Exec(`UPDATE personal_loans SET penal_cycle_count = 1 WHERE id = ?`, l.ID)
	before = fp()
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, nil, "", false)
	chk("penal delete", err, http.StatusConflict)
	_, _, err = editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{CashAmount: f(1000)}, "", false)
	chk("penal disbursement", err, http.StatusConflict)
	config.BaseDB.Exec(`UPDATE personal_loans SET penal_cycle_count = 0, total_penal_interest_charged = 5 WHERE id = ?`, l.ID)
	before = fp()
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, &PersonalPaymentEdit{Amount: f(200), CashAmount: f(200)}, "", false)
	chk("penal charged", err, http.StatusConflict)
	config.BaseDB.Exec(`UPDATE personal_loans SET total_penal_interest_charged = 0 WHERE id = ?`, l.ID)

	other2 := itLoan(t, ctx)
	config.BaseDB.Exec(`UPDATE personal_loans SET renewed_to_loan_id = ? WHERE id = ?`, other2.ID, l.ID)
	before = fp()
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, nil, "", false)
	chk("renewed payment", err, http.StatusConflict)
	_, _, err = editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{CashAmount: f(1000)}, "", false)
	chk("renewed disbursement", err, http.StatusConflict)
	config.BaseDB.Exec(`UPDATE personal_loans SET renewed_to_loan_id = NULL WHERE id = ?`, l.ID)

	config.BaseDB.Exec(`UPDATE personal_loans SET renewed_from_loan_id = ? WHERE id = ?`, other2.ID, l.ID)
	before = fp()
	_, _, err = editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{CashAmount: f(1000)}, "", false)
	chk("renewed-from disbursement", err, http.StatusConflict)
	config.BaseDB.Exec(`UPDATE personal_loans SET renewed_from_loan_id = NULL WHERE id = ?`, l.ID)

	config.BaseDB.Exec(`UPDATE personal_loan_payments SET method = ? WHERE id = ?`, rolloverMethod, pays[0].ID)
	before = fp()
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, nil, "", false)
	chk("rollover entry", err, http.StatusConflict)
	config.BaseDB.Exec(`UPDATE personal_loan_payments SET method = 'Cash' WHERE id = ?`, pays[0].ID)

	config.BaseDB.Exec(`UPDATE personal_loans SET outstanding_amount = outstanding_amount + 5 WHERE id = ?`, l.ID)
	before = fp()
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, nil, "", false)
	chk("unreproducible totals", err, http.StatusConflict)
	config.BaseDB.Exec(`UPDATE personal_loans SET outstanding_amount = outstanding_amount - 5 WHERE id = ?`, l.ID)

	config.BaseDB.Exec(`UPDATE personal_loans SET status = 'Rejected' WHERE id = ?`, l.ID)
	before = fp()
	_, _, err = editPersonalPayment(ctx, l.ID, mid, nil, nil, "", false)
	chk("rejected loan", err, http.StatusConflict)
	config.BaseDB.Exec(`UPDATE personal_loans SET status = 'Active' WHERE id = ?`, l.ID)
	checkConsistent(t, ctx, l.ID)
}

func TestIntegration_PL_Disbursement(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t)
	l := itLoan(t, ctx, 300, 250)
	oldGroup := l.DisbursementCashGroupID

	d := dayAgo(9)
	if _, _, err := editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{DisbursedAt: &d, CashAmount: f(400), UpiAmount: f(600), BankID: &bank}, "r", false); err != nil {
		t.Fatalf("edit disbursement: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	got := itGet(t, ctx, l.ID)
	if got.DisbursementCashGroupID == oldGroup || got.DisbursementCashGroupID == "" {
		t.Fatalf("group not rewritten: %q", got.DisbursementCashGroupID)
	}
	if n, _ := itGroup(oldGroup); n != 0 {
		t.Fatal("old disbursement lines left")
	}
	if got.DisbursementCashAmount != 400 || got.DisbursementUpiAmount != 600 || got.DisbursementBankID == nil || *got.DisbursementBankID != bank {
		t.Fatalf("split not saved: %+v", got)
	}
	if got.DisbursedAt.Format("2006-01-02") != d.Format("2006-01-02") {
		t.Fatalf("date %v", got.DisbursedAt)
	}
	var occ time.Time
	config.BaseDB.Raw(`SELECT occurred_on FROM cash_movements WHERE transaction_group_id = ? LIMIT 1`, got.DisbursementCashGroupID).Row().Scan(&occ)
	if occ.Format("2006-01-02") != d.Format("2006-01-02") {
		t.Fatalf("cash line date %v", occ)
	}
	if got.OutstandingAmount != 650 || got.TotalPaid != 550 || got.PrincipalAmount != 1200 {
		t.Fatalf("figures moved: %+v", got)
	}
	if _, _, err := editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{CashAmount: f(1000), UpiAmount: f(0)}, "", false); err != nil {
		t.Fatalf("back to cash: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	got = itGet(t, ctx, l.ID)
	if got.DisbursementBankID != nil || got.DisbursementUpiAmount != 0 {
		t.Fatalf("bank not cleared: %+v", got)
	}
}

func TestIntegration_PL_FallbackLegacyRows(t *testing.T) {
	ctx := itCtx(t)
	l := itLoan(t, ctx, 300, 250)
	pays := itPays(t, ctx, l.ID)
	// older rows carry no saved group id
	config.BaseDB.Exec(`UPDATE personal_loan_payments SET cash_transaction_group_id = '' WHERE personal_loan_id = ?`, l.ID)
	config.BaseDB.Exec(`UPDATE personal_loans SET disbursement_cash_group_id = '' WHERE id = ?`, l.ID)
	oldGroup := pays[0].CashTransactionGroupID
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[0].ID, nil, &PersonalPaymentEdit{Amount: f(350), CashAmount: f(350)}, "", false); err != nil {
		t.Fatalf("legacy payment edit: %v", err)
	}
	if n, _ := itGroup(oldGroup); n != 0 {
		t.Fatal("legacy payment lines not deleted")
	}
	d := dayAgo(9)
	if _, _, err := editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{DisbursedAt: &d}, "", false); err != nil {
		t.Fatalf("legacy disbursement edit: %v", err)
	}
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[1].ID, nil, nil, "", false); err != nil {
		t.Fatalf("legacy delete: %v", err)
	}
	checkConsistent(t, ctx, l.ID)

	// ambiguous: two identical groups -> refused, nothing changes
	l2 := itLoan(t, ctx, 300)
	p2 := itPays(t, ctx, l2.ID)
	config.BaseDB.Exec(`INSERT INTO cash_movements (tenant_id, branch_id, type, amount, purpose, source, mode, occurred_on, transaction_group_id, status, created_at)
		SELECT tenant_id, branch_id, type, amount, purpose, source, mode, occurred_on, 'dup-group-it', status, created_at FROM cash_movements WHERE transaction_group_id = ?`, p2[0].CashTransactionGroupID)
	t.Cleanup(func() { config.BaseDB.Exec(`DELETE FROM cash_movements WHERE transaction_group_id = 'dup-group-it'`) })
	config.BaseDB.Exec(`UPDATE personal_loan_payments SET cash_transaction_group_id = '' WHERE id = ?`, p2[0].ID)
	before := itFingerprint(t, ctx, l2.ID, l2.LoanNumber)
	_, _, err := editPersonalPayment(ctx, l2.ID, p2[0].ID, nil, nil, "", false)
	expectStatus(t, "ambiguous legacy group", err, http.StatusConflict)
	if itFingerprint(t, ctx, l2.ID, l2.LoanNumber) != before {
		t.Fatal("ambiguous refusal changed data")
	}
}

// infoOf runs the cash book's info popup handler for a movement, as the router would.
func infoOf(t *testing.T, id uint) map[string]any {
	t.Helper()
	req := httptest.NewRequest("GET", "/", strings.NewReader(""))
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set("tenantId", itTenant)
	c.Set("singleBranchHeadOffice", itBranch)
	c.SetParamNames("id")
	c.SetParamValues(strconv.FormatUint(uint64(id), 10))
	if err := cashbook.GetMovementEntry(c); err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	d, _ := out["data"].(map[string]any)
	if rec.Code != 200 || d == nil {
		t.Fatalf("info %d: HTTP %d %s", id, rec.Code, rec.Body.String())
	}
	return d
}

func itGroupIDs(group string) []uint {
	var ids []uint
	config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE transaction_group_id = ? ORDER BY id`, group).Scan(&ids)
	return ids
}

func TestIntegration_PL_CashInfoLookups(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t)
	l := itLoan(t, ctx, 300, 250)
	check := func(stage string) {
		t.Helper()
		l = itGet(t, ctx, l.ID)
		lines := itGroupIDs(l.DisbursementCashGroupID)
		if len(lines) == 0 {
			t.Fatalf("%s: no disbursement lines", stage)
		}
		for _, id := range lines {
			d := infoOf(t, id)
			if d["loan_entry"] != "personal_disbursement" || num(d["loan_id"]) != float64(l.ID) || d["editable"] != false {
				t.Fatalf("%s: disbursement line %d: %v", stage, id, d)
			}
		}
		for _, p := range itPays(t, ctx, l.ID) {
			lines := itGroupIDs(p.CashTransactionGroupID)
			if len(lines) == 0 {
				t.Fatalf("%s: payment %d has no lines", stage, p.ID)
			}
			for _, id := range lines {
				d := infoOf(t, id)
				if d["loan_entry"] != "personal_payment" || num(d["loan_id"]) != float64(l.ID) || num(d["loan_payment_id"]) != float64(p.ID) {
					t.Fatalf("%s: payment %d line %d: %v", stage, p.ID, id, d)
				}
			}
		}
	}
	check("created")
	pays := itPays(t, ctx, l.ID)
	d := dayAgo(7)
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[0].ID, nil, &PersonalPaymentEdit{PaidOn: &d, CashAmount: f(100), UpiAmount: f(200), BankID: &bank}, "", false); err != nil {
		t.Fatal(err)
	}
	check("after payment edit (two lines)")
	dd := dayAgo(9)
	if _, _, err := editPersonalDisbursement(ctx, l.ID, nil, PersonalDisbursementEdit{DisbursedAt: &dd, CashAmount: f(400), UpiAmount: f(600), BankID: &bank}, "", false); err != nil {
		t.Fatal(err)
	}
	check("after disbursement edit (two lines)")
	// a line of a deleted payment no longer exists, so there is nothing to look up
	old := itPays(t, ctx, l.ID)[1]
	oldLines := itGroupIDs(old.CashTransactionGroupID)
	if _, _, err := editPersonalPayment(ctx, l.ID, old.ID, nil, nil, "", false); err != nil {
		t.Fatal(err)
	}
	for _, id := range oldLines {
		var n int
		config.BaseDB.Raw(`SELECT count(*) FROM cash_movements WHERE id = ?`, id).Row().Scan(&n)
		if n != 0 {
			t.Fatalf("line %d of a deleted payment is still in the cash book", id)
		}
	}
	check("after delete")
}

func num(v any) float64 { f, _ := v.(float64); return f }

// Moving a payment's date past another reorders the ledger; balances, instalments and cash dates follow.
func TestIntegration_PL_ReorderByDate(t *testing.T) {
	ctx := itCtx(t)
	l := itLoan(t, ctx, 300, 250, 400) // dated 8, 5 and 3 days ago
	pays := itPays(t, ctx, l.ID)
	d := dayAgo(9) // before the first payment
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[2].ID, nil, &PersonalPaymentEdit{PaidOn: &d}, "", false); err != nil {
		t.Fatalf("move last payment first: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
	got := itPays(t, ctx, l.ID)
	if got[0].ID != pays[2].ID || got[0].RunningBalance != 800 || got[1].RunningBalance != 500 || got[2].RunningBalance != 250 {
		t.Fatalf("order/balances after reorder: %v %v %v", got[0].RunningBalance, got[1].RunningBalance, got[2].RunningBalance)
	}
	// and the loan's paid-on-the-same-day ordering falls back to id
	same := dayAgo(5)
	if _, _, err := editPersonalPayment(ctx, l.ID, pays[0].ID, nil, &PersonalPaymentEdit{PaidOn: &same}, "", false); err != nil {
		t.Fatalf("same day: %v", err)
	}
	checkConsistent(t, ctx, l.ID)
}

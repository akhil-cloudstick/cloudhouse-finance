package cash

import (
	"context"
	"regexp"
	"sort"
	"time"

	"gorm.io/gorm"
)

// LedgerRow is one normalized row of the universal bank/customer ledger
// drill-down (GET /banks/:id/ledger, GET /cash-movements/transactions/
// customer/:customerId) — field names/shapes mirror loan.LoanLedgerRow
// exactly, so the frontend renders every ledger type (single-loan,
// bank, customer) with the same shared table component.
type LedgerRow struct {
	ID             uint      `json:"id"`
	Date           time.Time `json:"date"`
	Description    string    `json:"description"`
	Type           string    `json:"type"`
	Method         string    `json:"method"`
	Reference      string    `json:"reference"`
	DebitOrCredit  string    `json:"debitOrCredit"` // "debit" | "credit"
	Amount         float64   `json:"amount"`
	RunningBalance float64   `json:"runningBalance"`
	BankID         *uint     `json:"bankId"`
	BankName       string    `json:"bankName,omitempty"`
	CustomerID     uint      `json:"customerId"`
	CustomerName   string    `json:"customerName"`
}

// ledgerSourceRow is the flat shape every raw query below scans into before
// being normalized into a LedgerRow — one struct wide enough to cover
// CashMovement/LoanPayment/PersonalLoanPayment/GoldSale's differing columns,
// with a Kind tag saying which table the row actually came from.
type ledgerSourceRow struct {
	Kind           string // "cash_movement" | "loan_payment" | "personal_loan_payment" | "gold_sale"
	ID             uint
	Date           time.Time
	Description    string
	Type           string
	Method         string
	Reference      string
	Amount         float64
	RunningBalance float64
	BankID         *uint
	BankName       string
	CustomerID     uint
	CustomerName   string
	// IsOut distinguishes a cash-OUT CashMovement row (debit) from a cash-IN
	// one (credit) — the other three source tables are always credits
	// (a payment/collection/sale received), so this only matters for
	// cash_movement rows.
	IsOut bool
}

// ledgerCreditPaymentTypes mirrors loan.ledgerCreditTypes/personalloan's
// equivalent notion of "this payment type represents money actually
// received" — duplicated here (rather than imported) because cash cannot
// import loan/personalloan without an import cycle (see loan.Service's
// cashRecorder-shaped interface: loan/personalloan already depend on cash).
// Every LoanPayment/PersonalLoanPayment row reaching this ledger already
// passed through RecordLoanPaymentCashIn (a real cash collection), so in
// practice every one of them is a credit; this guards against ever showing a
// no-cash-moved row (Waiver/Adjustment/Discount/renewal rollover) as if
// money came in, on the off chance one is ever queried in without the WHERE
// clauses below excluding it.
var ledgerNonCashPaymentTypes = map[string]bool{
	"Waiver":            true,
	"Adjustment":        true,
	"Discount":          true,
	"Auction Write-Off": true,
	"Renewal Rollover":  true,
}

// bankLedgerQuery/customerLedgerQuery build the four component queries (one
// per source table) that make up the combined ledger — factored out so
// ListCombinedLedgerByBank/ByCustomer only differ in which WHERE clause and
// customer-lookup they apply.

// combinedLedgerByBank returns the normalized, deduplicated ledger for one
// bank: every CashMovement/LoanPayment/PersonalLoanPayment/GoldSale row whose
// BankID matches, newest first.
//
// Dedup rule (judgment call, not a spec): a loan/personal-loan repayment
// collected in cash ALSO writes a CashMovement row via
// MovementService.RecordLoanPaymentCashIn (Source "Collection", same
// TransactionGroupID) — the same rupees would otherwise appear twice, once as
// a plain CashMovement and once as the richer LoanPayment/PersonalLoanPayment
// row. This ledger keeps the richer row (it carries Principal/Interest/Penal
// breakdown and an actual payment Type) and excludes the CashMovement side of
// that same event by filtering out CashMovement rows with Source =
// "Collection" — the one Source value RecordLoanPaymentCashIn always uses.
// Every other CashMovement Source (GoldSale, Bank, Auction, Savings, Loan
// top-up, Investment, plain expenses/withdrawals, …) has no richer
// counterpart row anywhere else, so those pass through unchanged.
func (r *MovementRepository) combinedLedgerByBank(ctx context.Context, bankID uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	db := r.db.WithContext(ctx)
	var rows []ledgerSourceRow

	cmRows, err := scanCashMovementsForLedger(db, "bank_id = ?", bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, cmRows...)

	lpRows, err := scanLoanPaymentsForLedger(db, "p.bank_id = ?", bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, lpRows...)

	plpRows, err := scanPersonalLoanPaymentsForLedger(db, "p.bank_id = ?", bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, plpRows...)

	gsRows, err := scanGoldSalesForLedger(db, "bank_id = ?", bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, gsRows...)

	return rows, nil
}

// combinedLedgerByCustomer is combinedLedgerByBank's counterpart for a
// customer: CashMovement rows tagged PartyCustomerID, LoanPayment rows whose
// parent Loan.CustomerID matches, PersonalLoanPayment rows whose parent
// PersonalLoan.CustomerID matches. GoldSale is intentionally excluded — gold
// sales are walk-in, with no CustomerID column to match against. Same dedup
// rule as combinedLedgerByBank (exclude CashMovement Source "Collection").
func (r *MovementRepository) combinedLedgerByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	db := r.db.WithContext(ctx)
	var rows []ledgerSourceRow

	cmRows, err := scanCashMovementsForLedger(db, "party_customer_id = ?", customerID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, cmRows...)

	lpRows, err := scanLoanPaymentsForLedger(db, "l.customer_id = ?", customerID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, lpRows...)

	plpRows, err := scanPersonalLoanPaymentsForLedger(db, "pl.customer_id = ?", customerID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, plpRows...)

	return rows, nil
}

// scanCashMovementsForLedger reads cash_movements matching whereCol = whereArg
// (either "bank_id = ?"/bankID or "party_customer_id = ?"/customerID),
// EXCLUDING Source = "Collection" rows — see combinedLedgerByBank's doc
// comment for why. whereCol is always one of the two fixed literals above
// (never caller/user-supplied), so this is not a SQL-injection surface.
func scanCashMovementsForLedger(db *gorm.DB, whereCol string, whereArg uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID              uint
		OccurredOn      time.Time
		Type            string
		Source          string
		Purpose         string
		Mode            string
		Amount          float64
		BankID          *uint
		BankName        string
		PartyCustomerID uint
		CustomerName    string
		LoanNumber      string
	}
	q := db.Table("cash_movements m").
		Select(`m.id, m.occurred_on, m.type, m.source, m.purpose, m.mode, m.amount,
			m.bank_id, bk.name as bank_name, m.party_customer_id, c.name as customer_name,
			lcs.loan_number as loan_number`).
		Joins("LEFT JOIN banks bk ON bk.id = m.bank_id").
		Joins("LEFT JOIN customers c ON c.id = m.party_customer_id").
		Joins("LEFT JOIN loan_cash_sources lcs ON lcs.cash_movement_id = m.id").
		Where("m."+whereCol, whereArg).
		Where("m.source IS DISTINCT FROM ?", "Collection").
		// A gold sale's proceeds come in through its richer gold_sales row
		// (scanGoldSalesForLedger) — drop the movement echo of the same sale.
		Where("m.source IS DISTINCT FROM ?", "GoldSale")
	if !fromDate.IsZero() {
		q = q.Where("m.occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("m.occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, len(raw))
	for i, m := range raw {
		desc := m.Purpose
		if desc == "" {
			desc = m.Source
		}
		out[i] = ledgerSourceRow{
			Kind:         "cash_movement",
			ID:           m.ID,
			Date:         m.OccurredOn,
			Description:  desc,
			Type:         m.Source,
			Method:       m.Mode,
			Reference:    refOrPurpose(m.LoanNumber, m.Purpose),
			Amount:       m.Amount,
			BankID:       m.BankID,
			BankName:     m.BankName,
			CustomerID:   m.PartyCustomerID,
			CustomerName: m.CustomerName,
			IsOut:        m.Type == "out",
		}
		if m.Type == "out" && m.Source == "" {
			out[i].Type = "Expense"
		}
	}
	return out, nil
}

// purposeRefRe matches the "… — LN-00049" / "… — INV-00003" suffix every
// loan/investment movement's Purpose carries (see RecordLoan*/
// RecordInvestment*/RecordAuction*), which has no dedicated column.
var purposeRefRe = regexp.MustCompile(`—\s*((?:LN|INV)-\S+)\s*$`)

// refOrPurpose returns loanNumber (a loan-sourced Add Cash entry's linked
// loan) when set, else the loan/investment number pulled back out of
// purpose, or "" when it carries none (expenses, manual top-ups, …).
func refOrPurpose(loanNumber, purpose string) string {
	if loanNumber != "" {
		return loanNumber
	}
	if m := purposeRefRe.FindStringSubmatch(purpose); m != nil {
		return m[1]
	}
	return ""
}

// scanLoanPaymentsForLedger reads loan_payments (joined to loans/customers)
// matching whereCol/whereArg — either "p.bank_id = ?"/bankID (bank ledger) or
// "l.customer_id = ?"/customerID (customer ledger). whereCol is always one of
// those two fixed literals (never caller/user-supplied).
func scanLoanPaymentsForLedger(db *gorm.DB, whereCol string, whereArg uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID             uint
		PaidOn         time.Time
		Description    string
		Type           string
		Method         string
		Reference      string
		Amount         float64
		RunningBalance float64
		BankID         *uint
		BankName       string
		CustomerID     uint
		CustomerName   string
	}
	q := db.Table("loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.type, p.method, p.reference, p.amount, p.running_balance,
			p.bank_id, bk.name as bank_name, l.customer_id, c.name as customer_name`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Joins("LEFT JOIN banks bk ON bk.id = p.bank_id").
		Where(whereCol, whereArg)
	if !fromDate.IsZero() {
		q = q.Where("p.paid_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("p.paid_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, 0, len(raw))
	for _, p := range raw {
		if ledgerNonCashPaymentTypes[p.Type] {
			continue
		}
		out = append(out, ledgerSourceRow{
			Kind:           "loan_payment",
			ID:             p.ID,
			Date:           p.PaidOn,
			Description:    p.Description,
			Type:           p.Type,
			Method:         p.Method,
			Reference:      p.Reference,
			Amount:         p.Amount,
			RunningBalance: p.RunningBalance,
			BankID:         p.BankID,
			BankName:       p.BankName,
			CustomerID:     p.CustomerID,
			CustomerName:   p.CustomerName,
		})
	}
	return out, nil
}

// scanPersonalLoanPaymentsForLedger is scanLoanPaymentsForLedger's
// counterpart for personal_loan_payments/personal_loans. whereCol is always
// one of "p.bank_id = ?" (bank ledger) or "pl.customer_id = ?" (customer
// ledger) — never caller/user-supplied.
func scanPersonalLoanPaymentsForLedger(db *gorm.DB, whereCol string, whereArg uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID             uint
		PaidOn         time.Time
		Description    string
		Method         string
		Reference      string
		Amount         float64
		RunningBalance float64
		BankID         *uint
		BankName       string
		CustomerID     uint
		CustomerName   string
	}
	q := db.Table("personal_loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.method, p.reference, p.amount, p.running_balance,
			p.bank_id, bk.name as bank_name, pl.customer_id, c.name as customer_name`).
		Joins("LEFT JOIN personal_loans pl ON pl.id = p.personal_loan_id").
		Joins("LEFT JOIN customers c ON c.id = pl.customer_id").
		Joins("LEFT JOIN banks bk ON bk.id = p.bank_id").
		Where(whereCol, whereArg)
	if !fromDate.IsZero() {
		q = q.Where("p.paid_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("p.paid_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, 0, len(raw))
	for _, p := range raw {
		if ledgerNonCashPaymentTypes[p.Method] {
			continue
		}
		out = append(out, ledgerSourceRow{
			Kind:           "personal_loan_payment",
			ID:             p.ID,
			Date:           p.PaidOn,
			Description:    p.Description,
			Type:           "Collection",
			Method:         p.Method,
			Reference:      p.Reference,
			Amount:         p.Amount,
			RunningBalance: p.RunningBalance,
			BankID:         p.BankID,
			BankName:       p.BankName,
			CustomerID:     p.CustomerID,
			CustomerName:   p.CustomerName,
		})
	}
	return out, nil
}

// scanGoldSalesForLedger reads gold_sales matching bank_id = bankID — bank
// ledger only, since a GoldSale has no CustomerID to match against for the
// customer ledger.
func scanGoldSalesForLedger(db *gorm.DB, whereCol string, whereArg uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID           uint
		SoldOn       time.Time
		OrnamentType string
		Mode         string
		SoldAmount   float64
		BankID       *uint
		BankName     string
	}
	q := db.Table("gold_sales g").
		Select(`g.id, g.sold_on, g.ornament_type, g.mode, g.sold_amount, g.bank_id, bk.name as bank_name`).
		Joins("LEFT JOIN banks bk ON bk.id = g.bank_id").
		Where("g."+whereCol, whereArg)
	if !fromDate.IsZero() {
		q = q.Where("g.sold_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("g.sold_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, len(raw))
	for i, g := range raw {
		out[i] = ledgerSourceRow{
			Kind:        "gold_sale",
			ID:          g.ID,
			Date:        g.SoldOn,
			Description: "Gold sale — " + g.OrnamentType,
			Type:        "GoldSale",
			Method:      g.Mode,
			Amount:      g.SoldAmount,
			BankID:      g.BankID,
			BankName:    g.BankName,
		}
	}
	return out, nil
}

// toLedgerRow normalizes one ledgerSourceRow into the public LedgerRow shape.
// Every source is a credit (money received) except a cash-out CashMovement
// row, which is a debit — see ledgerSourceRow.IsOut's doc comment.
func toLedgerRow(r ledgerSourceRow) LedgerRow {
	debitOrCredit := "credit"
	if r.Kind == "cash_movement" && r.IsOut {
		debitOrCredit = "debit"
	}
	return LedgerRow{
		ID:             r.ID,
		Date:           r.Date,
		Description:    r.Description,
		Type:           r.Type,
		Method:         r.Method,
		Reference:      r.Reference,
		DebitOrCredit:  debitOrCredit,
		Amount:         r.Amount,
		RunningBalance: r.RunningBalance,
		BankID:         r.BankID,
		BankName:       r.BankName,
		CustomerID:     r.CustomerID,
		CustomerName:   r.CustomerName,
	}
}

// ListCombinedLedgerByBank returns the combined, deduplicated, paginated
// ledger for bankID — backs GET /banks/:id/ledger. Sorted newest first
// (unlike loan.GetLoanLedger's oldest-first: none of the four source rows
// here carry a meaningful running balance across each other, since they come
// from unrelated loans/customers/sales that only share a bank in common — so
// there's no "read top to bottom to watch the balance move" expectation to
// preserve, and newest-first matches every other Party Transactions
// drill-down on this page).
func (s *MovementService) ListCombinedLedgerByBank(ctx context.Context, bankID uint, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := s.repo.combinedLedgerByBank(ctx, bankID, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return paginateLedgerRows(rows, limit, offset)
}

// ListCombinedLedgerByCustomer is ListCombinedLedgerByBank's counterpart for
// a customer — replaces ListCashMovementsByCustomer's plain-CashMovement
// result on GET /cash-movements/transactions/customer/:customerId in place
// (same URL, richer payload).
func (s *MovementService) ListCombinedLedgerByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := s.repo.combinedLedgerByCustomer(ctx, customerID, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return paginateLedgerRows(rows, limit, offset)
}

// paginateLedgerRows sorts every source's combined rows newest-first, then
// applies limit/offset in Go — the four component queries above already ran
// separately in SQL (one per source table), so a single SQL-level ORDER BY/
// LIMIT across all of them isn't available without a much heavier UNION
// query; row counts per bank/customer are small enough (a bank's or
// customer's own transactions) that sorting/paging this set in Go is not a
// concern the way it would be for an unscoped table-wide list.
//
// Totals cover every row matching the filters, not just the returned page —
// the ledger footer's Total Debit/Total Credit.
func paginateLedgerRows(rows []ledgerSourceRow, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	sortLedgerSourceRows(rows)
	total := int64(len(rows))
	var totals LedgerTotals
	for _, r := range rows {
		if toLedgerRow(r).DebitOrCredit == "debit" {
			totals.TotalDebit += r.Amount
		} else {
			totals.TotalCredit += r.Amount
		}
	}
	if offset < 0 {
		offset = 0
	}
	if offset > len(rows) {
		offset = len(rows)
	}
	end := len(rows)
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	page := rows[offset:end]
	out := make([]LedgerRow, len(page))
	for i, r := range page {
		out[i] = toLedgerRow(r)
	}
	return out, total, totals, nil
}

// LedgerTotals is the debit/credit sum across every row matching a ledger's
// filters (see paginateLedgerRows).
type LedgerTotals struct {
	TotalDebit  float64 `json:"totalDebit"`
	TotalCredit float64 `json:"totalCredit"`
}

func sortLedgerSourceRows(rows []ledgerSourceRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].Date.After(rows[j].Date)
	})
}

// ListCashModeLedger returns every transaction across CashMovement/
// LoanPayment/PersonalLoanPayment/GoldSale whose Mode/Method was "Cash" —
// the "Cash Ledger" sub-ledger drill-down off the Cash entity (as opposed to
// the bank/customer/loan ledgers, which show every mode). Kept as its own
// entry point (rather than callers passing mode="Cash" into ListModeLedger)
// since it's the one mode with no bank of record — see ListModeLedger's own
// doc comment for why a bankID makes sense for every other mode but this one.
func (s *MovementService) ListCashModeLedger(ctx context.Context, branchID *uint, branchIDs []uint, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	return s.ListModeLedger(ctx, "Cash", nil, branchID, branchIDs, fromDate, toDate, limit, offset)
}

// ListModeLedger returns every transaction across CashMovement/LoanPayment/
// PersonalLoanPayment/GoldSale whose Mode/Method equals mode — the "Ledger"
// drill-down per payment mode (Cash/UPI/Bank Transfer/Cheque), as opposed to
// the bank/customer/loan ledgers which show every mode mixed together.
// Optionally narrowed to one bankID (meaningless for "Cash", which never has
// a bank of record — pass nil there). Branch-scoped the same way
// MovementRepository.FindAllFiltered is: branchID pins a non-cross-branch
// role (e.g. Branch Manager) to their own branch server-side; branchIDs
// additionally narrows a cross-branch role's (e.g. Administrator) view when
// they've picked specific branches, and is ignored entirely for a scoped
// caller (branchID takes precedence — a Branch Manager's own branch can
// never be widened by a client-supplied filter).
func (s *MovementService) ListModeLedger(ctx context.Context, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := s.repo.modeLedger(ctx, mode, bankID, branchID, branchIDs, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return paginateLedgerRows(rows, limit, offset)
}

// modeLedger is ListModeLedger's repository half — one query per source
// table (same "no cheap UNION across differently-shaped tables" rationale as
// combinedLedgerByBank/ByCustomer), each filtered to its own Mode/Method =
// mode column (and bankID, when given), then combined. No dedup rule is
// needed here unlike the bank/customer ledgers: a loan/personal-loan payment
// recorded in a single mode books exactly one CashMovement row (Source
// "Collection", recordSplitCashMovement's single-component case), and that
// CashMovement's OWN Mode column matches too — so excluding CashMovement rows
// with Source "Collection" here (the same filter combinedLedgerByBank/
// ByCustomer apply) is still correct: the richer LoanPayment/
// PersonalLoanPayment row is kept, its own CashMovement echo is dropped,
// exactly as before.
func (r *MovementRepository) modeLedger(ctx context.Context, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	db := r.db.WithContext(ctx)
	var rows []ledgerSourceRow

	cmRows, err := scanCashMovementsForModeLedger(db, mode, bankID, branchID, branchIDs, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, cmRows...)

	lpRows, err := scanLoanPaymentsForModeLedger(db, mode, bankID, branchID, branchIDs, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, lpRows...)

	plpRows, err := scanPersonalLoanPaymentsForModeLedger(db, mode, bankID, branchID, branchIDs, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, plpRows...)

	gsRows, err := scanGoldSalesForModeLedger(db, mode, bankID, branchID, branchIDs, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, gsRows...)

	return rows, nil
}

// applyBranchScope applies the same branchID/branchIDs precedence every
// cash-mode-ledger scan below needs — factored out so each stays a plain
// linear list of .Where calls instead of repeating this branching four
// times.
func applyBranchScope(q *gorm.DB, col string, branchID *uint, branchIDs []uint) *gorm.DB {
	if branchID != nil {
		return q.Where(col+" = ?", *branchID)
	}
	if len(branchIDs) > 0 {
		return q.Where(col+" IN ?", branchIDs)
	}
	return q
}

func scanCashMovementsForModeLedger(db *gorm.DB, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID              uint
		OccurredOn      time.Time
		Type            string
		Source          string
		Purpose         string
		Mode            string
		Amount          float64
		BankID          *uint
		BankName        string
		PartyCustomerID uint
		CustomerName    string
		LoanNumber      string
	}
	q := db.Table("cash_movements m").
		Select(`m.id, m.occurred_on, m.type, m.source, m.purpose, m.mode, m.amount,
			m.bank_id, bk.name as bank_name, m.party_customer_id, c.name as customer_name,
			lcs.loan_number as loan_number`).
		Joins("LEFT JOIN banks bk ON bk.id = m.bank_id").
		Joins("LEFT JOIN customers c ON c.id = m.party_customer_id").
		Joins("LEFT JOIN loan_cash_sources lcs ON lcs.cash_movement_id = m.id").
		Where("m.mode = ?", mode).
		Where("m.source IS DISTINCT FROM ?", "Collection").
		// Same gold-sale dedup as scanCashMovementsForLedger.
		Where("m.source IS DISTINCT FROM ?", "GoldSale")
	if bankID != nil {
		q = q.Where("m.bank_id = ?", *bankID)
	}
	q = applyBranchScope(q, "m.branch_id", branchID, branchIDs)
	if !fromDate.IsZero() {
		q = q.Where("m.occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("m.occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, len(raw))
	for i, m := range raw {
		desc := m.Purpose
		if desc == "" {
			desc = m.Source
		}
		out[i] = ledgerSourceRow{
			Kind:         "cash_movement",
			ID:           m.ID,
			Date:         m.OccurredOn,
			Description:  desc,
			Type:         m.Source,
			Method:       m.Mode,
			Reference:    refOrPurpose(m.LoanNumber, m.Purpose),
			Amount:       m.Amount,
			BankID:       m.BankID,
			BankName:     m.BankName,
			CustomerID:   m.PartyCustomerID,
			CustomerName: m.CustomerName,
			IsOut:        m.Type == "out",
		}
		if m.Type == "out" && m.Source == "" {
			out[i].Type = "Expense"
		}
	}
	return out, nil
}

func scanLoanPaymentsForModeLedger(db *gorm.DB, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID             uint
		PaidOn         time.Time
		Description    string
		Type           string
		Method         string
		Reference      string
		Amount         float64
		RunningBalance float64
		BankID         *uint
		BankName       string
		CustomerID     uint
		CustomerName   string
		LoanNumber     string
	}
	q := db.Table("loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.type, p.method, p.reference, p.amount, p.running_balance,
			p.bank_id, bk.name as bank_name, l.customer_id, c.name as customer_name, l.loan_number`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Joins("LEFT JOIN banks bk ON bk.id = p.bank_id").
		Where("p.method = ?", mode)
	if bankID != nil {
		q = q.Where("p.bank_id = ?", *bankID)
	}
	q = applyBranchScope(q, "l.branch_id", branchID, branchIDs)
	if !fromDate.IsZero() {
		q = q.Where("p.paid_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("p.paid_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, 0, len(raw))
	for _, p := range raw {
		if ledgerNonCashPaymentTypes[p.Type] {
			continue
		}
		reference := p.Reference
		if reference == "" {
			reference = p.LoanNumber
		}
		out = append(out, ledgerSourceRow{
			Kind:           "loan_payment",
			ID:             p.ID,
			Date:           p.PaidOn,
			Description:    p.Description,
			Type:           p.Type,
			Method:         p.Method,
			Reference:      reference,
			Amount:         p.Amount,
			RunningBalance: p.RunningBalance,
			BankID:         p.BankID,
			BankName:       p.BankName,
			CustomerID:     p.CustomerID,
			CustomerName:   p.CustomerName,
		})
	}
	return out, nil
}

func scanPersonalLoanPaymentsForModeLedger(db *gorm.DB, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID             uint
		PaidOn         time.Time
		Description    string
		Method         string
		Reference      string
		Amount         float64
		RunningBalance float64
		BankID         *uint
		BankName       string
		CustomerID     uint
		CustomerName   string
		LoanNumber     string
	}
	q := db.Table("personal_loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.method, p.reference, p.amount, p.running_balance,
			p.bank_id, bk.name as bank_name, pl.customer_id, c.name as customer_name, pl.loan_number`).
		Joins("LEFT JOIN personal_loans pl ON pl.id = p.personal_loan_id").
		Joins("LEFT JOIN customers c ON c.id = pl.customer_id").
		Joins("LEFT JOIN banks bk ON bk.id = p.bank_id").
		Where("p.method = ?", mode)
	if bankID != nil {
		q = q.Where("p.bank_id = ?", *bankID)
	}
	q = applyBranchScope(q, "pl.branch_id", branchID, branchIDs)
	if !fromDate.IsZero() {
		q = q.Where("p.paid_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("p.paid_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, 0, len(raw))
	for _, p := range raw {
		if ledgerNonCashPaymentTypes[p.Method] {
			continue
		}
		reference := p.Reference
		if reference == "" {
			reference = p.LoanNumber
		}
		out = append(out, ledgerSourceRow{
			Kind:           "personal_loan_payment",
			ID:             p.ID,
			Date:           p.PaidOn,
			Description:    p.Description,
			Type:           "Collection",
			Method:         p.Method,
			Reference:      reference,
			Amount:         p.Amount,
			BankID:         p.BankID,
			BankName:       p.BankName,
			RunningBalance: p.RunningBalance,
			CustomerID:     p.CustomerID,
			CustomerName:   p.CustomerName,
		})
	}
	return out, nil
}

func scanGoldSalesForModeLedger(db *gorm.DB, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID           uint
		SoldOn       time.Time
		OrnamentType string
		Mode         string
		SoldAmount   float64
		BankID       *uint
		BankName     string
	}
	q := db.Table("gold_sales g").
		Select(`g.id, g.sold_on, g.ornament_type, g.mode, g.sold_amount, g.bank_id, bk.name as bank_name`).
		Joins("LEFT JOIN banks bk ON bk.id = g.bank_id").
		Where("g.mode = ?", mode)
	if bankID != nil {
		q = q.Where("g.bank_id = ?", *bankID)
	}
	q = applyBranchScope(q, "g.branch_id", branchID, branchIDs)
	if !fromDate.IsZero() {
		q = q.Where("g.sold_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("g.sold_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, len(raw))
	for i, g := range raw {
		out[i] = ledgerSourceRow{
			Kind:        "gold_sale",
			ID:          g.ID,
			Date:        g.SoldOn,
			Description: "Gold sale — " + g.OrnamentType,
			Type:        "GoldSale",
			Method:      g.Mode,
			Amount:      g.SoldAmount,
			BankID:      g.BankID,
			BankName:    g.BankName,
		}
	}
	return out, nil
}

// ListLedgerByCategory returns every Expense recorded under categoryName,
// normalized into the same LedgerRow shape as the bank/customer ledgers —
// backs GET /expense-categories/:id/ledger.
//
// Expense.Category is still a free-text column today (no CategoryID FK on
// Expense yet — ExpenseCategory only exists as a find-or-create picker list,
// see ExpenseCategoryService.FindOrCreate), so this groups by exact
// case-insensitive name match rather than a numeric join. The handler
// resolves :id to its category NAME first (see ExpenseCategoryService.
// FindByID below) and passes that name in here. Once Expense gains a real
// CategoryID column, this should switch to filtering "category_id = ?" —
// the LedgerRow shape returned to the frontend does not need to change.
func (s *MovementService) ListLedgerByCategory(ctx context.Context, categoryName string, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := s.repo.expenseLedgerByCategory(ctx, categoryName, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return paginateLedgerRows(rows, limit, offset)
}

// expenseLedgerByCategory reads expenses.category ILIKE categoryName —
// every expense is a debit (money spent), so this source never needs the
// cash_movement dedup rule the other ledgers apply.
func (r *MovementRepository) expenseLedgerByCategory(ctx context.Context, categoryName string, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID         uint
		OccurredOn time.Time
		Category   string
		Payee      string
		Mode       string
		Amount     float64
		Remarks    string
	}
	q := r.db.WithContext(ctx).Table("expenses e").
		Select(`e.id, e.occurred_on, e.category, e.payee, e.mode, e.amount, e.remarks`).
		Where("e.category ILIKE ?", categoryName)
	if !fromDate.IsZero() {
		q = q.Where("e.occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("e.occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	var raw []row
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]ledgerSourceRow, len(raw))
	for i, e := range raw {
		desc := e.Payee
		if e.Remarks != "" {
			desc = e.Payee + " — " + e.Remarks
		}
		out[i] = ledgerSourceRow{
			Kind:        "expense",
			ID:          e.ID,
			Date:        e.OccurredOn,
			Description: desc,
			Type:        e.Category,
			Method:      e.Mode,
			Amount:      e.Amount,
			IsOut:       true,
		}
	}
	return out, nil
}

package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
)

var ledgerNonCashPaymentTypes = map[string]bool{
	"Waiver":            true,
	"Adjustment":        true,
	"Discount":          true,
	"Auction Write-Off": true,
	"Renewal Rollover":  true,
}

var purposeRefRe = regexp.MustCompile(`—\s*((?:LN|PL|INV)-\S+)\s*$`)

type LedgerRow struct {
	ID             uint      `json:"id"`
	Date           time.Time `json:"date"`
	Description    string    `json:"description"`
	Type           string    `json:"type"`
	Method         string    `json:"method"`
	Reference      string    `json:"reference"`
	DebitOrCredit  string    `json:"debit_or_credit"`
	Amount         float64   `json:"amount"`
	RunningBalance float64   `json:"running_balance"`
	BankID         *uint     `json:"bank_id"`
	BankName       string    `json:"bank_name,omitempty"`
	CustomerID     uint      `json:"customer_id"`
	CustomerName   string    `json:"customer_name"`
	ReceiptImage   string    `json:"receipt_image,omitempty"`
	// Memo marks a row that records how money was applied rather than money moving (an auction's proceeds
	// applied to the loan): shown, but left out of the running balance and the totals.
	Memo bool `json:"memo,omitempty"`
}

type ledgerSourceRow struct {
	Kind           string
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
	IsOut          bool
	Memo           bool
}

type splitParts struct {
	Cash, Upi, BankTransfer, Cheque float64
}

type LedgerTotals struct {
	TotalDebit  float64 `json:"total_debit"`
	TotalCredit float64 `json:"total_credit"`
}

func (s splitParts) components() []splitComponent {
	var out []splitComponent
	for _, c := range []splitComponent{
		{models.CashModeCash, s.Cash},
		{models.CashModeUPI, s.Upi},
		{models.CashModeBankTransfer, s.BankTransfer},
		{models.CashModeCheque, s.Cheque},
	} {
		if c.amount > 0 {
			out = append(out, c)
		}
	}
	return out
}

func splitModeColumn(mode string) string {
	switch mode {
	case models.CashModeCash:
		return "cash_amount"
	case models.CashModeUPI:
		return "upi_amount"
	case models.CashModeBankTransfer:
		return "bank_transfer_amount"
	case models.CashModeCheque:
		return "cheque_amount"
	}
	return ""
}

func modePaymentFilter(mode string) string {
	col := splitModeColumn(mode)
	if col == "" {
		return "p.method = ?"
	}
	return "(p.method = ? OR (p.method = 'Split' AND p." + col + " > 0))"
}

func expandSplitPayment(r ledgerSourceRow, parts splitParts) []ledgerSourceRow {
	comps := parts.components()
	if len(comps) < 2 {
		return []ledgerSourceRow{r}
	}
	out := make([]ledgerSourceRow, len(comps))
	later := 0.0
	for i := len(comps) - 1; i >= 0; i-- {
		p := r
		p.Method = comps[i].mode
		p.Amount = comps[i].amount
		p.RunningBalance = r.RunningBalance + later
		if comps[i].mode == models.CashModeCash {
			p.BankID = nil
			p.BankName = ""
		}
		later += comps[i].amount
		out[i] = p
	}
	return out
}

func onlyMode(rows []ledgerSourceRow, mode string) []ledgerSourceRow {
	out := rows[:0]
	for _, r := range rows {
		if r.Method == mode {
			out = append(out, r)
		}
	}
	return out
}

func withoutCashParts(rows []ledgerSourceRow) []ledgerSourceRow {
	out := rows[:0]
	for _, r := range rows {
		if (r.Kind == "loan_payment" || r.Kind == "personal_loan_payment") && r.Method == models.CashModeCash && r.BankID == nil {
			continue
		}
		out = append(out, r)
	}
	return out
}

func combinedLedgerByBank(ctx context.Context, bankID uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	db := config.DB.
		WithContext(ctx)
	var rows []ledgerSourceRow
	cmRows, err := scanCashMovementsForLedger(db, "bank_id = ? AND m.mode IN "+bankModeSQL, bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, cmRows...)
	lpRows, err := scanLoanPaymentsForLedger(db, "p.bank_id = ?", bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, withoutCashParts(lpRows)...)
	plpRows, err := scanPersonalLoanPaymentsForLedger(db, "p.bank_id = ?", bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, withoutCashParts(plpRows)...)
	gsRows, err := scanGoldSalesForLedger(db, "bank_id = ? AND g.mode IN "+bankModeSQL, bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, gsRows...)
	drawRows, err := scanLoanDrawsForLenderBank(db, bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, drawRows...)
	repayRows, err := scanLoanRepaymentsForLenderBank(db, bankID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, repayRows...)
	return rows, nil
}

func scanLoanDrawsForLenderBank(db *gorm.DB, bankID uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type src struct {
		Name         string
		LoanNumber   string
		LoanOpenedAt *time.Time
		CreatedAt    time.Time
		BankName     string
	}
	var srcs []src
	if err := db.Table("categories c").
		Select("c.name, c.loan_number, c.loan_opened_at, c.created_at, b.name AS bank_name").
		Joins("LEFT JOIN banks b ON b.id = c.bank_id").
		Where("c.bank_id = ? AND c.loan_number <> ?", bankID, "").
		Scan(&srcs).Error; err != nil {
		return nil, err
	}
	var out []ledgerSourceRow
	for _, s := range srcs {
		since := s.CreatedAt
		if s.LoanOpenedAt != nil {
			since = *s.LoanOpenedAt
		}
		type draw struct {
			ID         uint
			OccurredOn time.Time
			Mode       string
			Amount     float64
			ToBank     string
		}
		q := db.Table("cash_movements m").
			Select("m.id, m.occurred_on, m.mode, m.amount, COALESCE(b.name, '') AS to_bank").
			Joins("LEFT JOIN banks b ON b.id = m.bank_id").
			Where("m.type = ? AND m.source ILIKE ? AND m.created_at >= ?", "in", s.Name, since).
			Where("m.bank_id IS DISTINCT FROM ?", bankID)
		if !fromDate.IsZero() {
			q = q.Where("m.occurred_on >= ?", fromDate)
		}
		if !toDate.IsZero() {
			q = q.Where("m.occurred_on < ?", toDate.AddDate(0, 0, 1))
		}
		var draws []draw
		if err := q.Scan(&draws).Error; err != nil {
			return nil, err
		}
		for _, d := range draws {
			desc := "Loan disbursed — " + s.Name
			if d.ToBank != "" && d.ToBank != s.BankName {
				desc += " → " + d.ToBank
			}
			id := bankID
			out = append(out, ledgerSourceRow{
				Kind: "loan_draw", ID: d.ID, Date: d.OccurredOn, Description: desc, Type: s.Name,
				Method: d.Mode, Reference: s.LoanNumber, Amount: d.Amount, IsOut: true,
				BankID: &id, BankName: s.BankName,
			})
		}
	}
	return out, nil
}

func combinedLedgerByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	db := config.DB.
		WithContext(ctx)
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
	accRows, err := scanLoanAccrualsForCustomerLedger(db, customerID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	rows = append(rows, accRows...)
	return rows, nil
}

func scanLoanAccrualsForCustomerLedger(db *gorm.DB, customerID uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	inRange := func(t time.Time) bool {
		return (fromDate.IsZero() || !t.Before(fromDate)) && (toDate.IsZero() || t.Before(toDate.AddDate(0, 0, 1)))
	}
	var out []ledgerSourceRow
	add := func(id uint, on time.Time, loanNumber, label string, amount float64) {
		if amount <= 0.01 || !inRange(on) {
			return
		}
		out = append(out, ledgerSourceRow{
			Kind: "loan_accrual", ID: id, Date: on, Description: label + " — " + loanNumber,
			Type: "Loan", Reference: loanNumber, Amount: amount, IsOut: true,
		})
	}
	type accrual struct {
		ID            uint
		LoanID        uint
		AccruedOn     time.Time
		CreatedAt     time.Time
		Interest      float64
		PenalInterest float64
		LoanNumber    string
	}
	var accs []accrual
	if err := db.Table("loan_accruals a").
		Select("a.id, a.loan_id, a.accrued_on, a.created_at, a.interest, a.penal_interest, l.loan_number").
		Joins("JOIN loans l ON l.id = a.loan_id").
		Where("l.customer_id = ?", customerID).
		Scan(&accs).Error; err != nil {
		return nil, err
	}
	type loanPay struct {
		LoanID    uint
		PaidOn    time.Time
		CreatedAt time.Time
	}
	var pays []loanPay
	if err := db.Table("loan_payments p").
		Select("p.loan_id, p.paid_on, p.created_at").
		Joins("JOIN loans l ON l.id = p.loan_id").
		Where("l.customer_id = ? AND p.type <> ?", customerID, "Disbursement").
		Scan(&pays).Error; err != nil {
		return nil, err
	}
	for _, a := range accs {
		on := a.AccruedOn
		var trig *loanPay
		for i := range pays {
			p := &pays[i]
			if p.LoanID != a.LoanID || a.CreatedAt.IsZero() || p.CreatedAt.Before(a.CreatedAt) || p.CreatedAt.Sub(a.CreatedAt) > 10*time.Second {
				continue
			}
			if trig == nil || p.CreatedAt.Before(trig.CreatedAt) {
				trig = p
			}
		}
		if trig != nil {
			on = a.CreatedAt
			if !on.Before(trig.PaidOn) {
				on = trig.PaidOn.Add(-time.Millisecond) // ...never later than its payment
			}
		} else if now := time.Now(); on.After(now) {
			// interest charged ahead (the first month of a new loan): shown from when it was charged, not skipped
			on = now
			if !a.CreatedAt.IsZero() && a.CreatedAt.Before(now) {
				on = a.CreatedAt
			}
		}
		add(a.ID, on, a.LoanNumber, "Interest Charged", a.Interest)
		add(a.ID, on, a.LoanNumber, "Penal Interest Charged", a.PenalInterest)
	}
	type totals struct {
		ID                   uint
		LoanNumber           string
		AccruedInterest      float64
		AccruedPenalInterest float64
		LastAccrualDate      time.Time
		LoanCreatedAt        time.Time
		RecordedInterest     float64
		RecordedPenal        float64
		FirstInterestPaid    *time.Time
		FirstPenalPaid       *time.Time
	}
	var tot []totals
	if err := db.Table("loans l").
		Select(`l.id, l.loan_number, l.accrued_interest, l.accrued_penal_interest, l.last_accrual_date, l.created_at AS loan_created_at,
			(SELECT MIN(p.paid_on) FROM loan_payments p WHERE p.loan_id = l.id AND p.type <> 'Disbursement' AND p.interest_applied > 0) AS first_interest_paid,
			(SELECT MIN(p.paid_on) FROM loan_payments p WHERE p.loan_id = l.id AND p.type <> 'Disbursement' AND p.penal_interest_applied > 0) AS first_penal_paid,
			COALESCE((SELECT SUM(a.interest) FROM loan_accruals a WHERE a.loan_id = l.id), 0) AS recorded_interest,
			COALESCE((SELECT SUM(a.penal_interest) FROM loan_accruals a WHERE a.loan_id = l.id), 0) AS recorded_penal`).
		Where("l.customer_id = ?", customerID).
		Scan(&tot).Error; err != nil {
		return nil, err
	}
	for _, t := range tot {
		last := t.LastAccrualDate
		if now := time.Now(); last.After(now) {
			last = now
			if !t.LoanCreatedAt.IsZero() && t.LoanCreatedAt.Before(now) {
				last = t.LoanCreatedAt
			}
		}
		interestAt, penalAt := last, last
		if t.FirstInterestPaid != nil && t.FirstInterestPaid.Add(-time.Millisecond).Before(interestAt) {
			interestAt = t.FirstInterestPaid.Add(-time.Millisecond)
		}
		if t.FirstPenalPaid != nil && t.FirstPenalPaid.Add(-time.Millisecond).Before(penalAt) {
			penalAt = t.FirstPenalPaid.Add(-time.Millisecond)
		}
		add(t.ID, interestAt, t.LoanNumber, "Interest Charged", t.AccruedInterest-t.RecordedInterest)
		add(t.ID, penalAt, t.LoanNumber, "Penal Interest Charged", t.AccruedPenalInterest-t.RecordedPenal)
	}
	return out, nil
}

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
			out[i].Type = cashOutLabel(m.Purpose)
		}
	}
	return out, nil
}

func refOrPurpose(loanNumber, purpose string) string {
	if loanNumber != "" {
		return loanNumber
	}
	if m := purposeRefRe.FindStringSubmatch(purpose); m != nil {
		return m[1]
	}
	return ""
}

func personalLoanRef(loanNumber, reference string) string {
	if loanNumber != "" {
		return loanNumber
	}
	return reference
}

func personalLoanDescription(description, loanNumber string) string {
	if description != "" {
		return description
	}
	if loanNumber == "" {
		return "Personal Loan Payment"
	}
	return "Personal Loan Payment — " + loanNumber
}

func scanLoanPaymentsForLedger(db *gorm.DB, whereCol string, whereArg uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID                                                                            uint
		PaidOn                                                                        time.Time
		Description                                                                   string
		Type                                                                          string
		Method                                                                        string
		Reference                                                                     string
		Amount                                                                        float64
		RunningBalance                                                                float64
		BankID                                                                        *uint
		BankName                                                                      string
		CustomerID                                                                    uint
		CustomerName                                                                  string
		CashAmount                                                                    float64
		UpiAmount                                                                     float64
		BankTransferAmount                                                            float64
		ChequeAmount                                                                  float64
		InterestApplied, PenalInterestApplied, PrincipalApplied, ProcessingFeeApplied float64
		CashTransactionGroupID                                                        string
	}
	q := db.Table("loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.type, p.method, p.reference, p.amount, p.running_balance,
			p.cash_amount, p.upi_amount, p.bank_transfer_amount, p.cheque_amount,
			p.interest_applied, p.penal_interest_applied, p.principal_applied, p.processing_fee_applied, p.cash_transaction_group_id,
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
		if ledgerNonCashPaymentTypes[p.Type] || p.Type == "Disbursement" {
			continue
		}
		out = append(out, expandPaymentRows(ledgerSourceRow{
			Kind: "loan_payment",
			// an auction payment saved with no cash lines of its own (older sales) only records how the sale was
			// applied, so it is shown without moving the balance; newer ones are ordinary repayments
			Memo:           p.Type == "Auction Sale" && p.CashTransactionGroupID == "",
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
		}, splitParts{p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount}, paymentComponents(p.Type, p.PenalInterestApplied, p.InterestApplied, p.PrincipalApplied, p.ProcessingFeeApplied, p.Amount))...)
	}
	return out, nil
}

func scanPersonalLoanPaymentsForLedger(db *gorm.DB, whereCol string, whereArg uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID                 uint
		PaidOn             time.Time
		Description        string
		Method             string
		Reference          string
		Amount             float64
		RunningBalance     float64
		BankID             *uint
		BankName           string
		CustomerID         uint
		CustomerName       string
		CashAmount         float64
		UpiAmount          float64
		BankTransferAmount float64
		ChequeAmount       float64
		LoanNumber         string
	}
	q := db.Table("personal_loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.method, p.reference, p.amount, p.running_balance,
			p.cash_amount, p.upi_amount, p.bank_transfer_amount, p.cheque_amount,
			p.bank_id, bk.name as bank_name, pl.customer_id, c.name as customer_name, pl.loan_number`).
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
		out = append(out, expandSplitPayment(ledgerSourceRow{
			Kind:           "personal_loan_payment",
			ID:             p.ID,
			Date:           p.PaidOn,
			Description:    personalLoanDescription(p.Description, p.LoanNumber),
			Type:           "Collection",
			Method:         p.Method,
			Reference:      personalLoanRef(p.LoanNumber, p.Reference),
			Amount:         p.Amount,
			RunningBalance: p.RunningBalance,
			BankID:         p.BankID,
			BankName:       p.BankName,
			CustomerID:     p.CustomerID,
			CustomerName:   p.CustomerName,
		}, splitParts{p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount})...)
	}
	return out, nil
}

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

func toLedgerRow(r ledgerSourceRow) LedgerRow {
	debitOrCredit := "credit"
	if (r.Kind == "cash_movement" || r.Kind == "loan_accrual" || r.Kind == "loan_draw") && r.IsOut {
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
		Memo:           r.Memo,
	}
}

func listCombinedLedgerByBank(ctx context.Context, bankID uint, modes []string, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := combinedLedgerByBank(ctx, bankID, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	if len(modes) > 0 {
		kept := rows[:0]
		for _, r := range rows {
			for _, m := range modes {
				if strings.EqualFold(r.Method, m) {
					kept = append(kept, r)
					break
				}
			}
		}
		rows = kept
	}
	return paginateLedgerRows(ctx, rows, limit, offset)
}

func listCombinedLedgerByCustomer(ctx context.Context, customerID uint, loanNumbers []string, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := combinedLedgerByCustomer(ctx, customerID, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	if len(loanNumbers) > 0 {
		kept := rows[:0]
		for _, r := range rows {
			for _, n := range loanNumbers {
				if strings.EqualFold(r.Reference, n) || strings.Contains(strings.ToLower(r.Description), strings.ToLower(n)) {
					kept = append(kept, r)
					break
				}
			}
		}
		rows = kept
	}
	return paginateLedgerRows(ctx, rows, limit, offset)
}

func paginateLedgerRows(ctx context.Context, rows []ledgerSourceRow, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	sortLedgerSourceRows(rows)
	total := int64(len(rows))
	var totals LedgerTotals
	for _, r := range rows {
		if r.Memo {
			continue
		}
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
	balances := make([]float64, len(rows))
	acc := 0.0
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].Memo {
			balances[i] = acc
			continue
		}
		if toLedgerRow(rows[i]).DebitOrCredit == "debit" {
			acc -= rows[i].Amount
		} else {
			acc += rows[i].Amount
		}
		balances[i] = acc
	}
	page := rows[offset:end]
	out := make([]LedgerRow, len(page))
	for i, r := range page {
		out[i] = toLedgerRow(r)
		out[i].RunningBalance = balances[offset+i]
	}
	if err := attachReceipts(ctx, page, out); err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return out, total, totals, nil
}

func attachReceipts(ctx context.Context, src []ledgerSourceRow, out []LedgerRow) error {
	tables := map[string]string{"cash_movement": "cash_movements", "expense": "expenses", "gold_sale": "gold_sales"}
	ids := map[string][]uint{}
	for _, row := range src {
		if _, ok := tables[row.Kind]; ok {
			ids[row.Kind] = append(ids[row.Kind], row.ID)
		}
	}
	found := map[string]map[uint]string{}
	for kind, list := range ids {
		var recs []struct {
			ID           uint
			ReceiptImage string
		}
		if err := config.DB.
			WithContext(ctx).Table(tables[kind]).Select("id, receipt_image").
			Where("id IN ? AND receipt_image <> ''", list).Scan(&recs).Error; err != nil {
			return err
		}
		m := make(map[uint]string, len(recs))
		for _, rec := range recs {
			m[rec.ID] = rec.ReceiptImage
		}
		found[kind] = m
	}
	for i, row := range src {
		out[i].ReceiptImage = found[row.Kind][row.ID]
	}
	return nil
}

func sortLedgerSourceRows(rows []ledgerSourceRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].Date.Equal(rows[j].Date) {
			return rows[i].Date.After(rows[j].Date)
		}
		return !rows[i].IsOut && rows[j].IsOut
	})
}

func listCashModeLedger(ctx context.Context, branchID *uint, branchIDs []uint, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	return listModeLedger(ctx, "Cash", nil, branchID, branchIDs, nil, fromDate, toDate, limit, offset)
}

func listModeLedger(ctx context.Context, mode string, bankID *uint, branchID *uint, branchIDs []uint, types []string, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := modeLedger(ctx, mode, bankID, branchID, branchIDs, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	rows = filterLedgerRowsByType(rows, types)
	return paginateLedgerRows(ctx, rows, limit, offset)
}

func modeLedger(ctx context.Context, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	db := config.DB.
		WithContext(ctx)
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
			out[i].Type = cashOutLabel(m.Purpose)
		}
	}
	return out, nil
}

func scanLoanPaymentsForModeLedger(db *gorm.DB, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID                                                                            uint
		PaidOn                                                                        time.Time
		Description                                                                   string
		Type                                                                          string
		Method                                                                        string
		Reference                                                                     string
		Amount                                                                        float64
		RunningBalance                                                                float64
		BankID                                                                        *uint
		BankName                                                                      string
		CustomerID                                                                    uint
		CustomerName                                                                  string
		CashAmount                                                                    float64
		UpiAmount                                                                     float64
		BankTransferAmount                                                            float64
		ChequeAmount                                                                  float64
		LoanNumber                                                                    string
		InterestApplied, PenalInterestApplied, PrincipalApplied, ProcessingFeeApplied float64
		CashTransactionGroupID                                                        string
	}
	q := db.Table("loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.type, p.method, p.reference, p.amount, p.running_balance,
			p.cash_amount, p.upi_amount, p.bank_transfer_amount, p.cheque_amount,
			p.interest_applied, p.penal_interest_applied, p.principal_applied, p.processing_fee_applied, p.cash_transaction_group_id,
			p.bank_id, bk.name as bank_name, l.customer_id, c.name as customer_name, l.loan_number`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Joins("LEFT JOIN banks bk ON bk.id = p.bank_id").
		// an auction payment saved before it kept its modes has no split on the row: it is matched here and
		// given the sale's modes below
		Where("("+modePaymentFilter(mode)+" OR (p.type = 'Auction Sale' AND p.cash_amount + p.upi_amount + p.bank_transfer_amount + p.cheque_amount = 0))", mode)
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
		if ledgerNonCashPaymentTypes[p.Type] || p.Type == "Disbursement" {
			continue
		}
		if p.Type == "Auction Sale" && p.CashAmount+p.UpiAmount+p.BankTransferAmount+p.ChequeAmount == 0 {
			if parts, bank, ok := legacyAuctionSplit(db, p.LoanNumber, p.Amount); ok {
				p.CashAmount, p.UpiAmount, p.BankTransferAmount = parts.Cash, parts.Upi, parts.BankTransfer
				if parts.Upi+parts.BankTransfer > 0 {
					p.BankID = bank
				}
			}
		}
		reference := p.Reference
		if reference == "" {
			reference = p.LoanNumber
		}
		out = append(out, expandPaymentRows(ledgerSourceRow{
			Kind: "loan_payment",
			// an auction payment saved with no cash lines of its own (older sales) only records how the sale was
			// applied, so it is shown without moving the balance; newer ones are ordinary repayments
			Memo:           p.Type == "Auction Sale" && p.CashTransactionGroupID == "",
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
		}, splitParts{p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount}, paymentComponents(p.Type, p.PenalInterestApplied, p.InterestApplied, p.PrincipalApplied, p.ProcessingFeeApplied, p.Amount))...)
	}
	return onlyMode(out, mode), nil
}

func scanPersonalLoanPaymentsForModeLedger(db *gorm.DB, mode string, bankID *uint, branchID *uint, branchIDs []uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID                 uint
		PaidOn             time.Time
		Description        string
		Method             string
		Reference          string
		Amount             float64
		RunningBalance     float64
		BankID             *uint
		BankName           string
		CustomerID         uint
		CustomerName       string
		CashAmount         float64
		UpiAmount          float64
		BankTransferAmount float64
		ChequeAmount       float64
		LoanNumber         string
	}
	q := db.Table("personal_loan_payments p").
		Select(`p.id, p.paid_on, p.description, p.method, p.reference, p.amount, p.running_balance,
			p.cash_amount, p.upi_amount, p.bank_transfer_amount, p.cheque_amount,
			p.bank_id, bk.name as bank_name, pl.customer_id, c.name as customer_name, pl.loan_number`).
		Joins("LEFT JOIN personal_loans pl ON pl.id = p.personal_loan_id").
		Joins("LEFT JOIN customers c ON c.id = pl.customer_id").
		Joins("LEFT JOIN banks bk ON bk.id = p.bank_id").
		Where(modePaymentFilter(mode), mode)
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
		out = append(out, expandSplitPayment(ledgerSourceRow{
			Kind:           "personal_loan_payment",
			ID:             p.ID,
			Date:           p.PaidOn,
			Description:    personalLoanDescription(p.Description, p.LoanNumber),
			Type:           "Collection",
			Method:         p.Method,
			Reference:      personalLoanRef(p.LoanNumber, p.Reference),
			Amount:         p.Amount,
			BankID:         p.BankID,
			BankName:       p.BankName,
			RunningBalance: p.RunningBalance,
			CustomerID:     p.CustomerID,
			CustomerName:   p.CustomerName,
		}, splitParts{p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount})...)
	}
	return onlyMode(out, mode), nil
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

func listLedgerByCategory(ctx context.Context, categoryName string, branchID *uint, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := expenseLedgerByCategory(ctx, categoryName, branchID, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return paginateLedgerRows(ctx, rows, limit, offset)
}

func expenseLedgerByCategory(ctx context.Context, categoryName string, branchID *uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID         uint
		OccurredOn time.Time
		Category   string
		Payee      string
		Mode       string
		Amount     float64
		Remarks    string
	}
	q := config.DB.
		WithContext(ctx).Table("expenses e").
		Select(`e.id, e.occurred_on, e.category, e.payee, e.mode, e.amount, e.remarks`).
		Where("e.category ILIKE ?", categoryName)
	q = applyBranchScope(q, "e.branch_id", branchID, nil)
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
		if desc == "" {
			desc = e.Category
		}
		if e.Remarks != "" {
			desc += " — " + e.Remarks
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

func listLoanSourceLedger(ctx context.Context, src *models.CashSource, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := loanSourceLedgerRows(ctx, src)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	all := make([]LedgerRow, 0, len(rows))
	balance := 0.0
	for _, r := range rows {
		if r.DebitOrCredit == "debit" {
			balance -= r.Amount
		} else {
			balance += r.Amount
		}
		r.RunningBalance = balance
		all = append(all, r)
	}
	var page []LedgerRow
	var totals LedgerTotals
	for _, r := range all {
		day := r.Date
		if !fromDate.IsZero() && day.Before(fromDate) {
			continue
		}
		if !toDate.IsZero() && !day.Before(toDate.AddDate(0, 0, 1)) {
			continue
		}
		if r.DebitOrCredit == "debit" {
			totals.TotalDebit += r.Amount
		} else {
			totals.TotalCredit += r.Amount
		}
		page = append(page, r)
	}
	for i, j := 0, len(page)-1; i < j; i, j = i+1, j-1 {
		page[i], page[j] = page[j], page[i]
	}
	total := int64(len(page))
	if offset > len(page) {
		offset = len(page)
	}
	end := len(page)
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return page[offset:end], total, totals, nil
}

func loanSourceLedgerRows(ctx context.Context, src *models.CashSource) ([]LedgerRow, error) {
	since := src.CreatedAt
	if src.LoanOpenedAt != nil {
		since = *src.LoanOpenedAt
	}
	lendingBank := ""
	if src.Bank != nil {
		lendingBank = src.Bank.Name
	}
	type draw struct {
		ID         uint
		OccurredOn time.Time
		CreatedAt  time.Time
		Mode       string
		Amount     float64
		ToBank     string
		Receipt    string
	}
	var draws []draw
	if err := config.DB.
		WithContext(ctx).Table("cash_movements m").
		Select("m.id, m.occurred_on, m.created_at, m.mode, m.amount, COALESCE(b.name, '') AS to_bank, m.receipt_image AS receipt").
		Joins("LEFT JOIN banks b ON b.id = m.bank_id").
		Where("m.type = ? AND m.source ILIKE ? AND m.created_at >= ?", "in", src.Name, since).
		Scan(&draws).Error; err != nil {
		return nil, err
	}
	type repayment struct {
		ID         uint
		OccurredOn time.Time
		CreatedAt  time.Time
		Mode       string
		Amount     float64
		Payee      string
		Remarks    string
		FromBankID *uint
		FromBank   string
		Receipt    string
	}
	var repays []repayment
	if err := config.DB.
		WithContext(ctx).Table("expenses e").
		Select("e.id, e.occurred_on, e.created_at, e.mode, e.amount, e.payee, e.remarks, e.from_bank_id, COALESCE(b.name, '') AS from_bank, e.receipt_image AS receipt").
		Joins("LEFT JOIN banks b ON b.id = e.from_bank_id").
		Where("e.category ILIKE ? AND e.status = ? AND e.created_at >= ?", src.Name, "Approved", since).
		Scan(&repays).Error; err != nil {
		return nil, err
	}
	type keyed struct {
		row     LedgerRow
		created time.Time
	}
	merged := make([]keyed, 0, len(draws)+len(repays))
	for _, d := range draws {
		desc := "Cash drawn from loan"
		if d.ToBank != "" && d.ToBank != lendingBank && d.Mode != models.CashModeCash {
			desc += " → " + d.ToBank
		}
		merged = append(merged, keyed{created: d.CreatedAt, row: LedgerRow{
			ID: d.ID, Date: d.OccurredOn, Description: desc, Type: src.Name, Method: d.Mode,
			Reference: src.LoanNumber, DebitOrCredit: "credit", Amount: d.Amount,
			BankID: src.BankID, BankName: lendingBank, ReceiptImage: d.Receipt,
		}})
	}
	for _, e := range repays {
		desc := "Repayment"
		if e.Payee != "" {
			desc += " — " + e.Payee
		}
		if e.Remarks != "" {
			desc += " — " + e.Remarks
		}
		merged = append(merged, keyed{created: e.CreatedAt, row: LedgerRow{
			ID: e.ID, Date: e.OccurredOn, Description: desc, Type: src.Name, Method: e.Mode,
			Reference: src.LoanNumber, DebitOrCredit: "debit", Amount: e.Amount,
			BankID: e.FromBankID, BankName: e.FromBank, ReceiptImage: e.Receipt,
		}})
	}
	type transfer struct {
		ID         uint
		OccurredOn time.Time
		CreatedAt  time.Time
		Mode       string
		Amount     float64
		BankID     *uint
		FromBank   string
		Receipt    string
	}
	var transfers []transfer
	if err := config.DB.
		WithContext(ctx).Table("cash_movements m").
		Select("m.id, m.occurred_on, m.created_at, m.mode, m.amount, m.bank_id, COALESCE(b.name, '') AS from_bank, m.receipt_image AS receipt").
		Joins("LEFT JOIN banks b ON b.id = m.bank_id").
		Where("m.type = ? AND m.source = ? AND LOWER(m.purpose) = LOWER(?) AND m.created_at >= ?",
			"out", SelfTransferSource, "Self transfer — "+src.Name, since).
		Scan(&transfers).Error; err != nil {
		return nil, err
	}
	for _, t := range transfers {
		merged = append(merged, keyed{created: t.CreatedAt, row: LedgerRow{
			ID: t.ID, Date: t.OccurredOn, Description: "Repayment — self transfer", Type: src.Name, Method: t.Mode,
			Reference: src.LoanNumber, DebitOrCredit: "debit", Amount: t.Amount,
			BankID: t.BankID, BankName: t.FromBank, ReceiptImage: t.Receipt,
		}})
	}
	sort.SliceStable(merged, func(i, j int) bool {
		if !merged[i].row.Date.Equal(merged[j].row.Date) {
			return merged[i].row.Date.Before(merged[j].row.Date)
		}
		return merged[i].created.Before(merged[j].created)
	})
	out := make([]LedgerRow, len(merged))
	for i := range merged {
		out[i] = merged[i].row
	}
	return out, nil
}

func listLedgerByCashInCategory(ctx context.Context, name string, branchID *uint, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	rows, err := cashInLedgerByCategory(ctx, name, branchID, fromDate, toDate)
	if err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return paginateLedgerRows(ctx, rows, limit, offset)
}

func cashInLedgerByCategory(ctx context.Context, name string, branchID *uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type row struct {
		ID         uint
		OccurredOn time.Time
		Purpose    string
		Mode       string
		Amount     float64
		BankID     *uint
		BankName   string
	}
	q := config.DB.
		WithContext(ctx).Table("cash_movements m").
		Select("m.id, m.occurred_on, m.purpose, m.mode, m.amount, m.bank_id, COALESCE(bk.name, '') AS bank_name").
		Joins("LEFT JOIN banks bk ON bk.id = m.bank_id").
		Where("m.type = ? AND m.source ILIKE ?", "in", name)
	q = applyBranchScope(q, "m.branch_id", branchID, nil)
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
			desc = "Cash added — " + name
		}
		out[i] = ledgerSourceRow{
			Kind: "cash_movement", ID: m.ID, Date: m.OccurredOn, Description: desc, Type: name,
			Method: m.Mode, Amount: m.Amount, BankID: m.BankID, BankName: m.BankName,
		}
	}
	return out, nil
}

func splitCSV(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func ledgerRowTypeBuckets(r ledgerSourceRow) []string {
	switch r.Kind {
	case "loan_payment":
		return []string{"collection"}
	case "personal_loan_payment":
		return []string{"personal loan"}
	case "cash_movement":
		isPL := strings.Contains(r.Description, "PL-") || strings.Contains(r.Reference, "PL-")
		var out []string
		switch {
		case r.Type == "Personal Loan":
			out = append(out, "personal loan")
		case r.Type == "Investment" || strings.Contains(r.Description, "INV-"):
			out = append(out, "investment")
		case r.Type == "Auction" || strings.HasPrefix(r.Description, "Auction surplus settlement"):
			out = append(out, "auction")
		case (r.Type == "Loan" || r.Type == "Collection") && isPL:
			out = append(out, "personal loan")
		case strings.HasPrefix(r.Type, "Loan") || strings.HasPrefix(r.Description, "Loan disbursement — "):
			out = append(out, "loan")
		case r.IsOut && !strings.HasPrefix(r.Description, "Bank pledge release — "):
			out = append(out, "expenses")
		}
		return out
	}
	return nil
}

func filterLedgerRowsByType(rows []ledgerSourceRow, types []string) []ledgerSourceRow {
	if len(types) == 0 {
		return rows
	}
	want := make(map[string]bool, len(types))
	for _, t := range types {
		want[strings.ToLower(strings.TrimSpace(t))] = true
	}
	kept := rows[:0:0]
	for _, r := range rows {
		for _, b := range ledgerRowTypeBuckets(r) {
			if want[b] {
				kept = append(kept, r)
				break
			}
		}
	}
	return kept
}

// payComponent is one part of a repayment: what the money was applied to.
type payComponent struct {
	label  string
	amount float64
}

// paymentComponents lists what a repayment was applied to (penal interest, interest, principal,
// processing fee). It returns nil when the payment is not a repayment or the parts do not add up to the
// amount (an older row with nothing recorded), so the caller falls back to one line for the payment.
func paymentComponents(paymentType string, penal, interest, principal, fee, amount float64) []payComponent {
	switch paymentType {
	case "Interest", "Penal Interest", "Principal", "Partial", "Full Settlement", "Auction Sale":
	default:
		return nil
	}
	var comps []payComponent
	var sum float64
	feeLabel := "Processing Fee"
	if paymentType == "Auction Sale" {
		feeLabel = "Service Charge"
	}
	for _, c := range []payComponent{{"Penal Interest", penal}, {"Interest", interest}, {"Principal", principal}, {feeLabel, fee}} {
		if c.amount > 0.004 {
			comps = append(comps, c)
			sum += c.amount
		}
	}
	if len(comps) == 0 || sum < amount-0.01 || sum > amount+0.01 {
		return nil
	}
	return comps
}

// expandPaymentRows shows a repayment in the main ledger as one credit row per component, each in the
// mode the customer paid it by. The components are met from the modes in order, so a ₹10,000 payment
// of ₹1,000 interest and ₹9,000 principal paid half in cash and half by UPI gives an Interest row and
// two Principal rows. Without components it is the usual one row per mode.
func expandPaymentRows(r ledgerSourceRow, parts splitParts, comps []payComponent) []ledgerSourceRow {
	if len(comps) == 0 {
		return expandSplitPayment(r, parts)
	}
	modes := parts.components()
	if len(modes) == 0 {
		modes = []splitComponent{{r.Method, r.Amount}}
	}
	var out []ledgerSourceRow
	mi, left := 0, modes[0].amount
	for _, c := range comps {
		need := c.amount
		for need > 0.004 && mi < len(modes) {
			take := need
			if left < take {
				take = left
			}
			row := r
			row.Type = c.label
			row.Description = c.label + " payment"
			if r.Type == "Auction Sale" {
				row.Description = c.label + " — Auction Sale"
				if r.Memo {
					// an older sale: how it was applied to the loan, shown but not counted (its own cash line carries the money)
					row.Description += " (applied to loan)"
				}
			}
			row.Method = modes[mi].mode
			row.Amount = math.Round(take*100) / 100
			if row.Method == models.CashModeCash {
				row.BankID, row.BankName = nil, ""
			}
			out = append(out, row)
			need -= take
			left -= take
			if left <= 0.004 {
				mi++
				if mi < len(modes) {
					left = modes[mi].amount
				}
			}
		}
	}
	return out
}

// cashOutLabel names a cash-out line that has no source from its purpose, so loan, investment, auction and
// pledge money does not read as an "Expense". Anything else stays an expense.
func cashOutLabel(purpose string) string {
	switch {
	case strings.Contains(purpose, "— INV-"):
		return "Investment"
	case strings.Contains(purpose, "— PL-"):
		return "Personal Loan"
	case strings.HasPrefix(purpose, "Loan disbursement — "), strings.HasPrefix(purpose, "Loan top-up — "):
		return "Loan"
	case strings.HasPrefix(purpose, "Auction surplus settlement"), strings.HasPrefix(purpose, "Auction expenses"):
		return "Auction"
	case strings.HasPrefix(purpose, "Bank pledge release — "):
		return "Bank Pledge"
	}
	return "Expense"
}

// scanLoanRepaymentsForLenderBank lists the repayments made to a lender's loan by transfer from one of our
// banks, so the lender's ledger shows what was drawn and what was paid back. A transfer made before the
// credit leg was dropped already shows through that leg, so only transfers without one are listed here.
func scanLoanRepaymentsForLenderBank(db *gorm.DB, bankID uint, fromDate, toDate time.Time) ([]ledgerSourceRow, error) {
	type src struct {
		Name         string
		LoanNumber   string
		LoanOpenedAt *time.Time
		CreatedAt    time.Time
		BankName     string
	}
	var srcs []src
	if err := db.Table("categories c").
		Select("c.name, c.loan_number, c.loan_opened_at, c.created_at, b.name AS bank_name").
		Joins("LEFT JOIN banks b ON b.id = c.bank_id").
		Where("c.bank_id = ? AND c.loan_number <> ?", bankID, "").
		Scan(&srcs).Error; err != nil {
		return nil, err
	}
	var out []ledgerSourceRow
	for _, s := range srcs {
		since := s.CreatedAt
		if s.LoanOpenedAt != nil {
			since = *s.LoanOpenedAt
		}
		type repay struct {
			ID         uint
			OccurredOn time.Time
			Mode       string
			Amount     float64
		}
		q := db.Table("cash_movements m").
			Select("m.id, m.occurred_on, m.mode, m.amount").
			Where("m.type = ? AND m.source = ? AND LOWER(m.purpose) = LOWER(?) AND m.created_at >= ?",
				"out", SelfTransferSource, "Self transfer — "+s.Name, since).
			Where("NOT EXISTS (SELECT 1 FROM cash_movements c2 WHERE c2.transaction_group_id = m.transaction_group_id AND c2.type = 'in')")
		if !fromDate.IsZero() {
			q = q.Where("m.occurred_on >= ?", fromDate)
		}
		if !toDate.IsZero() {
			q = q.Where("m.occurred_on < ?", toDate.AddDate(0, 0, 1))
		}
		var rows []repay
		if err := q.Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			id := bankID
			out = append(out, ledgerSourceRow{
				Kind: "loan_repayment", ID: r.ID, Date: r.OccurredOn, Description: "Loan repaid — " + s.Name, Type: s.Name,
				Method: r.Mode, Reference: s.LoanNumber, Amount: r.Amount, IsOut: false,
				BankID: &id, BankName: s.BankName,
			})
		}
	}
	return out, nil
}

// legacyAuctionSplit gives an auction payment that was saved before it kept its modes the modes the sale was
// received in, read from the sale's own cash lines and spread in proportion to what was applied to the loan.
func legacyAuctionSplit(db *gorm.DB, loanNumber string, applied float64) (splitParts, *uint, bool) {
	var lines []struct {
		Mode   string
		BankID *uint
		Total  float64
	}
	if err := db.Table("cash_movements").
		Select("mode, bank_id, SUM(amount) AS total").
		Where("type = ? AND source = ? AND purpose = ?", "in", "Auction", "Auction sale proceeds — "+loanNumber).
		Group("mode, bank_id").Scan(&lines).Error; err != nil || len(lines) == 0 {
		return splitParts{}, nil, false
	}
	var whole float64
	for _, l := range lines {
		whole += l.Total
	}
	if whole <= 0 {
		return splitParts{}, nil, false
	}
	var parts splitParts
	var bank *uint
	for _, l := range lines {
		share := math.Round(applied*l.Total/whole*100) / 100
		switch l.Mode {
		case models.CashModeUPI:
			parts.Upi += share
			bank = l.BankID
		case models.CashModeBankTransfer:
			parts.BankTransfer += share
			bank = l.BankID
		default:
			parts.Cash += share
		}
	}
	// rounding: the last mode with money takes the remainder so the parts add up to what was applied
	diff := math.Round((applied-parts.Cash-parts.Upi-parts.BankTransfer)*100) / 100
	switch {
	case parts.BankTransfer > 0:
		parts.BankTransfer += diff
	case parts.Upi > 0:
		parts.Upi += diff
	default:
		parts.Cash += diff
	}
	return parts, bank, true
}

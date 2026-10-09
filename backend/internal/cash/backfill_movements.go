package cash

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// headOfficeBranchSQL resolves a tenant's Head Office branch inside SQL: the
// active branch named "Head Office", else the tenant's oldest active branch.
// alias is the table alias whose tenant_id scopes the lookup.
func headOfficeBranchSQL(alias string) string {
	return fmt.Sprintf(`(SELECT b.id FROM branches b
		WHERE b.tenant_id IS NOT DISTINCT FROM %s.tenant_id AND b.is_active AND b.name <> ''
		ORDER BY (b.name = 'Head Office') DESC, b.id LIMIT 1)`, alias)
}

// BackfillBankPledgeBranch re-books every existing bank-pledge cash movement
// (the pledge cash-in, the release cash-out, the void's compensating
// cash-out) and the release expense onto the Head Office branch — new pledges
// are booked there from the start (see MovementService.HeadOfficeBranchID).
// Pledge cash-ins used to carry no branch at all, which hid them from every
// branch-scoped balance and ledger. Must run AFTER AutoMigrate and BEFORE
// BackfillBlankMovementMode (it identifies unlinked legacy pledge-ins by
// their blank mode). Idempotent.
func BackfillBankPledgeBranch(db *gorm.DB) error {
	if !db.Migrator().HasTable("bank_pledge_records") {
		return nil
	}
	ho := headOfficeBranchSQL("m")
	res := db.Exec(`UPDATE cash_movements m SET branch_id = ` + ho + `
		WHERE m.branch_id IS DISTINCT FROM ` + ho + `
		  AND ` + ho + ` IS NOT NULL
		  AND (
			m.id IN (SELECT cash_movement_id FROM bank_pledge_records WHERE cash_movement_id IS NOT NULL)
			OR m.id IN (SELECT release_cash_movement_id FROM bank_pledge_records WHERE release_cash_movement_id IS NOT NULL)
			OR m.id IN (SELECT void_cash_movement_id FROM bank_pledge_records WHERE void_cash_movement_id IS NOT NULL)
			OR (m.source = 'Bank' AND m.type = 'in' AND m.branch_id IS NULL AND (m.mode IS NULL OR m.mode = ''))
			OR m.purpose LIKE 'Bank pledge release — %'
		  )`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("moved %d bank-pledge cash movement(s) to the Head Office branch", res.RowsAffected)
	}

	eho := headOfficeBranchSQL("e")
	res = db.Exec(`UPDATE expenses e SET branch_id = ` + eho + `
		WHERE e.branch_id IS DISTINCT FROM ` + eho + `
		  AND ` + eho + ` IS NOT NULL
		  AND (e.category = 'Bank Pledge Release'
			OR e.id IN (SELECT release_expense_id FROM bank_pledge_records WHERE release_expense_id IS NOT NULL))`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("moved %d bank-pledge release expense(s) to the Head Office branch", res.RowsAffected)
	}
	return nil
}

// BackfillBlankMovementMode gives every movement that has no payment mode the
// "Cash" mode. The balance totals already counted a blank mode as cash, so no
// balance changes — but the mode-filtered Cash ledger only listed mode =
// 'Cash', so those rows (service charges, pledges, investment deposits,
// auction proceeds, …) were missing from it. Idempotent.
func BackfillBlankMovementMode(db *gorm.DB) error {
	res := db.Exec(`UPDATE cash_movements SET mode = ? WHERE mode IS NULL OR mode = ''`, CashModeCash)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("set mode Cash on %d cash movement(s) that had none", res.RowsAffected)
	}
	return nil
}

// splitModesSQL expands one row's cash/upi/bank/cheque columns into one
// (mode, amt) row per mode — the same per-mode rows recordSplitCashMovement
// writes. p is the alias of the row that carries the four *_amount columns.
func splitModesSQL(p string) string {
	return fmt.Sprintf(`CROSS JOIN LATERAL (VALUES
		('%s', %s.cash_amount), ('%s', %s.upi_amount),
		('%s', %s.bank_transfer_amount), ('%s', %s.cheque_amount)) AS s(mode, amt)`,
		CashModeCash, p, CashModeUPI, p, CashModeBankTransfer, p, CashModeCheque, p)
}

// BackfillMissingLoanMovements writes the cash movements that a loan's own
// records say should exist but do not — rows lost when a movement failed to
// save (the failure used to be only logged) or that predate the movement
// being recorded. Covers gold-loan disbursements, withheld service charges,
// customer payments, and personal-loan disbursements. Each insert is guarded
// by a NOT EXISTS on the same purpose (and date, for payments), so existing
// movements are never duplicated and re-running is a no-op. Must run AFTER
// AutoMigrate.
func BackfillMissingLoanMovements(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable("loan_payments") || !m.HasTable("loans") {
		return nil
	}
	steps := []struct{ label, sql string }{
		{"loan disbursement", `
		INSERT INTO cash_movements (tenant_id, type, source, purpose, mode, amount, branch_id, occurred_on, party_customer_id, bank_id, transaction_group_id, created_at)
		SELECT l.tenant_id, 'out', '', 'Loan disbursement — ' || l.loan_number, s.mode, s.amt, l.branch_id, p.paid_on, l.customer_id,
			CASE WHEN s.mode = 'Cash' THEN NULL ELSE p.bank_id END, 'tg-bf-d' || p.id, now()
		FROM loan_payments p JOIN loans l ON l.id = p.loan_id ` + splitModesSQL("p") + `
		WHERE p.type = 'Disbursement' AND s.amt > 0
		  AND NOT EXISTS (SELECT 1 FROM cash_movements x WHERE x.tenant_id IS NOT DISTINCT FROM l.tenant_id
			AND x.purpose = 'Loan disbursement — ' || l.loan_number)`},
		{"loan disbursement (no split)", `
		INSERT INTO cash_movements (tenant_id, type, source, purpose, mode, amount, branch_id, occurred_on, party_customer_id, transaction_group_id, created_at)
		SELECT l.tenant_id, 'out', '', 'Loan disbursement — ' || l.loan_number, 'Cash', p.amount, l.branch_id, p.paid_on, l.customer_id, 'tg-bf-d' || p.id, now()
		FROM loan_payments p JOIN loans l ON l.id = p.loan_id
		WHERE p.type = 'Disbursement' AND p.amount > 0
		  AND p.cash_amount + p.upi_amount + p.bank_transfer_amount + p.cheque_amount = 0
		  AND NOT EXISTS (SELECT 1 FROM cash_movements x WHERE x.tenant_id IS NOT DISTINCT FROM l.tenant_id
			AND x.purpose = 'Loan disbursement — ' || l.loan_number)`},
		{"service charge", `
		INSERT INTO cash_movements (tenant_id, type, source, purpose, mode, amount, branch_id, occurred_on, created_at)
		SELECT l.tenant_id, 'in', 'Service Charge', 'Service charge — ' || l.loan_number, 'Cash', l.service_charge_amount, l.branch_id, l.disbursement_date, now()
		FROM loans l
		WHERE l.service_charge_mode = 'WithheldFromPayout' AND l.service_charge_amount > 0 AND l.disbursement_date IS NOT NULL
		  AND NOT EXISTS (SELECT 1 FROM cash_movements x WHERE x.tenant_id IS NOT DISTINCT FROM l.tenant_id
			AND x.purpose = 'Service charge — ' || l.loan_number)`},
		{"loan payment", `
		INSERT INTO cash_movements (tenant_id, type, source, purpose, mode, amount, branch_id, occurred_on, party_customer_id, bank_id, transaction_group_id, created_at)
		SELECT l.tenant_id, 'in', 'Collection', p.type || ' — ' || l.loan_number, s.mode, s.amt, l.branch_id, p.paid_on, l.customer_id,
			CASE WHEN s.mode = 'Cash' THEN NULL ELSE p.bank_id END, 'tg-bf-p' || p.id, now()
		FROM loan_payments p JOIN loans l ON l.id = p.loan_id ` + splitModesSQL("p") + `
		WHERE p.type IN ('Interest', 'Penal Interest', 'Principal', 'Partial', 'Full Settlement')
		  AND COALESCE(p.cash_transaction_group_id, '') = '' AND s.amt > 0
		  AND NOT EXISTS (SELECT 1 FROM cash_movements x WHERE x.tenant_id IS NOT DISTINCT FROM l.tenant_id
			AND x.type = 'in' AND x.purpose = p.type || ' — ' || l.loan_number AND x.occurred_on::date = p.paid_on::date)`},
	}
	if m.HasTable("personal_loans") {
		steps = append(steps, struct{ label, sql string }{"personal loan disbursement", `
		INSERT INTO cash_movements (tenant_id, type, source, purpose, mode, amount, branch_id, occurred_on, party_customer_id, transaction_group_id, created_at)
		SELECT pl.tenant_id, 'out', '', 'Loan disbursement — ' || pl.loan_number, 'Cash', pl.disbursed_amount, pl.branch_id, pl.disbursed_at, pl.customer_id, 'tg-bf-pl' || pl.id, now()
		FROM personal_loans pl
		WHERE pl.disbursed_amount > 0 AND pl.disbursed_at > '2000-01-01'
		  AND NOT EXISTS (SELECT 1 FROM cash_movements x WHERE x.tenant_id IS NOT DISTINCT FROM pl.tenant_id
			AND x.purpose = 'Loan disbursement — ' || pl.loan_number)`})
	}
	for _, st := range steps {
		res := db.Exec(st.sql)
		if res.Error != nil {
			return fmt.Errorf("backfilling missing cash movements (%s): %w", st.label, res.Error)
		}
		if res.RowsAffected > 0 {
			log.Printf("created %d missing cash movement(s): %s", res.RowsAffected, st.label)
		}
	}
	// Link the payments that just got a movement, so the ledger can trace them.
	return db.Exec(`UPDATE loan_payments p SET cash_transaction_group_id = 'tg-bf-p' || p.id
		WHERE COALESCE(p.cash_transaction_group_id, '') = ''
		  AND EXISTS (SELECT 1 FROM cash_movements x WHERE x.transaction_group_id = 'tg-bf-p' || p.id)`).Error
}

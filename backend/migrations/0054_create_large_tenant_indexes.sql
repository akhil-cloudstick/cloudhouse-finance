-- +migrate Up notransaction
-- Indexes for businesses with a long loan / cash history (hundreds of thousands
-- of rows per tenant). No table, column or data change.

-- Loans list by status (Active / Due Soon / Overdue tabs, due-today, overdue counts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loans_tenant_status_due ON public.loans (tenant_id, status, due_date);
-- Default loans list order (newest first) and date-range reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loans_tenant_opened ON public.loans (tenant_id, opened_date DESC, id DESC);
-- Today's collections, interest collected, dashboard activity, P&L
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_payments_tenant_paid_on ON public.loan_payments (tenant_id, paid_on);
-- Day book / ledgers by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_tenant_occurred ON public.cash_movements (tenant_id, occurred_on);
-- Cash in hand / bank balance totals (run on every payout and the cash summary)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_tenant_mode_occurred ON public.cash_movements (tenant_id, mode, occurred_on) INCLUDE (type, amount, expense_id, to_bank_id, bank_id, branch_id);
-- "expense_id IS NULL" filter in every balance, and expense edits
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_expense_id ON public.cash_movements (expense_id);
-- Locker occupancy and active-packet counts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_packets_tenant_locker_status ON public.packets (tenant_id, current_locker_id, status);

-- +migrate Down notransaction
DROP INDEX CONCURRENTLY IF EXISTS idx_loans_tenant_status_due;
DROP INDEX CONCURRENTLY IF EXISTS idx_loans_tenant_opened;
DROP INDEX CONCURRENTLY IF EXISTS idx_loan_payments_tenant_paid_on;
DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_tenant_occurred;
DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_tenant_mode_occurred;
DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_expense_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_packets_tenant_locker_status;

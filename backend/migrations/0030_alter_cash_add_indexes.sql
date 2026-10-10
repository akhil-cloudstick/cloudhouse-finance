-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_bank_id ON public.cash_movements (bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_branch_id ON public.cash_movements (branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_counter_bank_id ON public.cash_movements (counter_bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_party_customer_id ON public.cash_movements (party_customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_to_bank_id ON public.cash_movements (to_bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_bank_id ON public.categories (bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_branch_id ON public.expenses (branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_from_bank_id ON public.expenses (from_bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_to_bank_id ON public.expenses (to_bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gold_sales_bank_id ON public.gold_sales (bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gold_sales_branch_id ON public.gold_sales (branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gold_sales_cash_movement_id ON public.gold_sales (cash_movement_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gold_sales_cost_cash_movement_id ON public.gold_sales (cost_cash_movement_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_cash_sources_bank_id ON public.loan_cash_sources (bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opening_cash_balances_bank_id ON public.opening_cash_balances (bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opening_cash_balances_from_bank_id ON public.opening_cash_balances (from_bank_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_branch_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_counter_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_party_customer_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_to_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_categories_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_expenses_branch_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_expenses_from_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_expenses_to_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_gold_sales_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_gold_sales_branch_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_gold_sales_cash_movement_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_gold_sales_cost_cash_movement_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_loan_cash_sources_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_opening_cash_balances_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_opening_cash_balances_from_bank_id;

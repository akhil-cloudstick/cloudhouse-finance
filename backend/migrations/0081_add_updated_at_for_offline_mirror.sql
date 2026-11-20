-- +migrate Up

-- A desktop PC keeps a copy of these tables and asks for the rows changed since its last visit, so each needs an
-- updated_at. Rows that exist already take the time of this migration, which only means a PC downloads them once.
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.gold_sales ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.opening_cash_balances ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.loan_cash_sources ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.investment_transactions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.personal_loan_payments ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.personal_loan_history ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.approval_actions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_cash_movements_updated_at ON public.cash_movements USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_expenses_updated_at ON public.expenses USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_gold_sales_updated_at ON public.gold_sales USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_updated_at ON public.opening_cash_balances USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_loan_cash_sources_updated_at ON public.loan_cash_sources USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_updated_at ON public.investment_transactions USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_updated_at ON public.personal_loan_payments USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_history_updated_at ON public.personal_loan_history USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_approval_actions_updated_at ON public.approval_actions USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_loans_updated_at ON public.loans USING btree (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON public.customers USING btree (updated_at, id);

-- +migrate Down

DROP INDEX IF EXISTS public.idx_customers_updated_at;
DROP INDEX IF EXISTS public.idx_loans_updated_at;
DROP INDEX IF EXISTS public.idx_approval_actions_updated_at;
DROP INDEX IF EXISTS public.idx_personal_loan_history_updated_at;
DROP INDEX IF EXISTS public.idx_personal_loan_payments_updated_at;
DROP INDEX IF EXISTS public.idx_investment_transactions_updated_at;
DROP INDEX IF EXISTS public.idx_loan_cash_sources_updated_at;
DROP INDEX IF EXISTS public.idx_opening_cash_balances_updated_at;
DROP INDEX IF EXISTS public.idx_gold_sales_updated_at;
DROP INDEX IF EXISTS public.idx_expenses_updated_at;
DROP INDEX IF EXISTS public.idx_cash_movements_updated_at;
ALTER TABLE public.approval_actions DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.personal_loan_history DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.personal_loan_payments DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.investment_transactions DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.loan_cash_sources DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.opening_cash_balances DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.gold_sales DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.expenses DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS updated_at;

-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_drafts_customer_id ON public.loan_drafts (customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_drafts_scheme_id ON public.loan_drafts (scheme_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_payments_bank_id ON public.loan_payments (bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loans_branch_id ON public.loans (branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loans_customer_id ON public.loans (customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loans_scheme_id ON public.loans (scheme_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_loan_drafts_customer_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_loan_drafts_scheme_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_loan_payments_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_loans_branch_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_loans_customer_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_loans_scheme_id;

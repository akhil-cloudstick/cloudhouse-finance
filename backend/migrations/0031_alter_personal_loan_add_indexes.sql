-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_personal_loan_payments_bank_id ON public.personal_loan_payments (bank_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_personal_loans_branch_id ON public.personal_loans (branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_personal_loans_customer_id ON public.personal_loans (customer_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_personal_loan_payments_bank_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_personal_loans_branch_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_personal_loans_customer_id;

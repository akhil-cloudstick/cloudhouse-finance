-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_investments_branch_id ON public.investments (branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_investments_customer_id ON public.investments (customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_investments_plan_id ON public.investments (plan_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_investments_branch_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_investments_customer_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_investments_plan_id;

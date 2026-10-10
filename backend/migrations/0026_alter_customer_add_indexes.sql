-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_branch_id ON public.customers (branch_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_customers_branch_id;

-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_branch_id ON public.employees (branch_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_employees_branch_id;

-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_schemes_branch_id ON public.schemes (branch_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_schemes_branch_id;

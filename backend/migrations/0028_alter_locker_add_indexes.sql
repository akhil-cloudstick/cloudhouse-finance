-- +migrate Up notransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lockers_branch_id ON public.lockers (branch_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_lockers_branch_id;

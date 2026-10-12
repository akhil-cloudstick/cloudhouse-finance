-- +migrate Up notransaction

-- every cash line points back to the record that produced it, so a reversal or rollback finds all the
-- split lines of a flow by this link instead of by searching the purpose text
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS source_type character varying(40);
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS source_id bigint;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_source ON public.cash_movements (source_type, source_id);

-- +migrate Down notransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_cash_movements_source;

ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS source_id;
ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS source_type;

-- +migrate Up

-- how a gold sale's cost to acquire was paid: shown in the ledgers as a memo row, never moved out of any balance.
ALTER TABLE public.gold_sales ADD COLUMN IF NOT EXISTS cost_mode character varying(20);
ALTER TABLE public.gold_sales ADD COLUMN IF NOT EXISTS cost_bank_id bigint CONSTRAINT fk_gold_sales_cost_bank_ref REFERENCES public.banks(id);

-- +migrate Down

ALTER TABLE public.gold_sales DROP COLUMN IF EXISTS cost_bank_id;
ALTER TABLE public.gold_sales DROP COLUMN IF EXISTS cost_mode;

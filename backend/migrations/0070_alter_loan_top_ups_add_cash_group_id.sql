-- +migrate Up

-- the cash-book lines a top-up booked, so an edit or delete can rewrite exactly those lines
ALTER TABLE public.loan_top_ups ADD COLUMN IF NOT EXISTS cash_transaction_group_id character varying(40);

-- +migrate Down

ALTER TABLE public.loan_top_ups DROP COLUMN IF EXISTS cash_transaction_group_id;

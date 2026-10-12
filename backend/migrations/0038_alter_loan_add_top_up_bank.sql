-- +migrate Up

-- the bank a top-up was paid through, kept on the request so an approved top-up books the right bank
ALTER TABLE public.loan_top_ups ADD COLUMN IF NOT EXISTS bank_id bigint CONSTRAINT fk_loan_top_ups_bank REFERENCES public.banks(id);

-- +migrate Down

ALTER TABLE public.loan_top_ups DROP COLUMN IF EXISTS bank_id;

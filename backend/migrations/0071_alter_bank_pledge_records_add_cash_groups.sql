-- +migrate Up

-- the cash-book lines a bank pledge and its release booked, and how the release was paid,
-- so an edit or delete can rewrite exactly those lines
ALTER TABLE public.bank_pledge_records ADD COLUMN IF NOT EXISTS cash_transaction_group_id character varying(40);
ALTER TABLE public.bank_pledge_records ADD COLUMN IF NOT EXISTS release_cash_transaction_group_id character varying(40);
ALTER TABLE public.bank_pledge_records ADD COLUMN IF NOT EXISTS release_cash_amount numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE public.bank_pledge_records ADD COLUMN IF NOT EXISTS release_upi_amount numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE public.bank_pledge_records ADD COLUMN IF NOT EXISTS release_bank_transfer_amount numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE public.bank_pledge_records ADD COLUMN IF NOT EXISTS release_cheque_amount numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE public.bank_pledge_records ADD COLUMN IF NOT EXISTS release_bank_id bigint;

-- +migrate Down

ALTER TABLE public.bank_pledge_records DROP COLUMN IF EXISTS release_bank_id;
ALTER TABLE public.bank_pledge_records DROP COLUMN IF EXISTS release_cheque_amount;
ALTER TABLE public.bank_pledge_records DROP COLUMN IF EXISTS release_bank_transfer_amount;
ALTER TABLE public.bank_pledge_records DROP COLUMN IF EXISTS release_upi_amount;
ALTER TABLE public.bank_pledge_records DROP COLUMN IF EXISTS release_cash_amount;
ALTER TABLE public.bank_pledge_records DROP COLUMN IF EXISTS release_cash_transaction_group_id;
ALTER TABLE public.bank_pledge_records DROP COLUMN IF EXISTS cash_transaction_group_id;

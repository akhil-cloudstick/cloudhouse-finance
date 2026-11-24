-- +migrate Up

-- the cash-book lines a personal loan's disbursement and each payment booked, so an edit or delete can rewrite exactly those lines
ALTER TABLE public.personal_loan_payments ADD COLUMN IF NOT EXISTS cash_transaction_group_id character varying(40);
ALTER TABLE public.personal_loans ADD COLUMN IF NOT EXISTS disbursement_cash_group_id character varying(40);

-- +migrate Down

ALTER TABLE public.personal_loan_payments DROP COLUMN IF EXISTS cash_transaction_group_id;
ALTER TABLE public.personal_loans DROP COLUMN IF EXISTS disbursement_cash_group_id;

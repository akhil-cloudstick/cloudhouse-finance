-- +migrate Up

-- a loan no longer has a lender bank, so new draws keep no bank on their loan record
ALTER TABLE public.loan_cash_sources ALTER COLUMN bank_id DROP NOT NULL;

-- +migrate Down

ALTER TABLE public.loan_cash_sources ALTER COLUMN bank_id SET NOT NULL;

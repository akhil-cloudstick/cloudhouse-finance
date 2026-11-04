-- +migrate Up

-- How a scheme counts interest: 'daily' (rate / 365 per day) or 'monthly' (rate / 12 per month, rate / 12 / 30 per leftover day)
ALTER TABLE public.schemes ADD COLUMN IF NOT EXISTS accrual_basis varchar(10) DEFAULT 'daily' NOT NULL;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS scheme_accrual_basis varchar(10) DEFAULT 'daily' NOT NULL;

-- +migrate Down

ALTER TABLE public.loans DROP COLUMN IF EXISTS scheme_accrual_basis;
ALTER TABLE public.schemes DROP COLUMN IF EXISTS accrual_basis;

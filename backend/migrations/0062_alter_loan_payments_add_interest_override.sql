-- +migrate Up

-- the interest figure staff typed over the calculated one, kept so a recalculation of the loan reuses it
ALTER TABLE public.loan_payments ADD COLUMN IF NOT EXISTS interest_override numeric(16,2);

-- +migrate Down

ALTER TABLE public.loan_payments DROP COLUMN IF EXISTS interest_override;

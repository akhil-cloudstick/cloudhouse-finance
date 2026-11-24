-- +migrate Up

-- When a loan was closed (gold released, or written off at auction). Shown on the loan and
-- used as the date on the release agreement instead of the day it is printed.
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Loans closed before this was recorded: the best evidence is their last payment.
UPDATE public.loans l SET closed_at = (SELECT max(p.paid_on) FROM public.loan_payments p WHERE p.loan_id = l.id)
WHERE l.status = 'Closed' AND l.closed_at IS NULL;

-- +migrate Down

ALTER TABLE public.loans DROP COLUMN IF EXISTS closed_at;

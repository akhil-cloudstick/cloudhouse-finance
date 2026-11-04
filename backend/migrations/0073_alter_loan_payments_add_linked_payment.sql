-- +migrate Up

-- a Discount saved together with a payment points at that payment, so an edit finds the discount that came with it
ALTER TABLE public.loan_payments ADD COLUMN IF NOT EXISTS linked_payment_id bigint;
CREATE INDEX IF NOT EXISTS idx_loan_payments_linked_payment_id ON public.loan_payments USING btree (linked_payment_id) WHERE linked_payment_id IS NOT NULL;

-- +migrate Down

DROP INDEX IF EXISTS public.idx_loan_payments_linked_payment_id;
ALTER TABLE public.loan_payments DROP COLUMN IF EXISTS linked_payment_id;

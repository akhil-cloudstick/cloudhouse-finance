-- +migrate Up

-- what a Discount row was given against: interest, penal_interest or customer (the default negotiated reduction)
ALTER TABLE public.loan_payments ADD COLUMN IF NOT EXISTS discount_kind character varying(20);

-- +migrate Down

ALTER TABLE public.loan_payments DROP COLUMN IF EXISTS discount_kind;

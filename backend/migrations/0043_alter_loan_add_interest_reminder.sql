-- +migrate Up

-- when the monthly "interest unpaid" WhatsApp reminder was last sent, so it goes out once per month
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS interest_reminded_at timestamp with time zone;

-- +migrate Down

ALTER TABLE public.loans DROP COLUMN IF EXISTS interest_reminded_at;

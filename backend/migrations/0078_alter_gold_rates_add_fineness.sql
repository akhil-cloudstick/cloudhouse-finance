-- +migrate Up

-- The 22K / 18K fineness % set in the Set Gold Rate modal's Auto mode, so a 24K-only publish (the New Gold Loan
-- page) can derive 22K / 18K at that fineness. 0 = not set; the standard karat/24 ratio is used instead.
ALTER TABLE public.gold_rates ADD COLUMN IF NOT EXISTS fineness22 numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.gold_rates ADD COLUMN IF NOT EXISTS fineness18 numeric(5,2) NOT NULL DEFAULT 0;

-- +migrate Down

ALTER TABLE public.gold_rates DROP COLUMN IF EXISTS fineness22;
ALTER TABLE public.gold_rates DROP COLUMN IF EXISTS fineness18;

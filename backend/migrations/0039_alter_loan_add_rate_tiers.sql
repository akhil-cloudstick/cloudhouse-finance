-- +migrate Up

-- Multiple-interest schemes: the rate ladder copied onto the loan, which step the loan is on, and when the unpaid-days count started
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS scheme_rate_tiers text;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS scheme_minimum_days bigint DEFAULT 0 NOT NULL;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS rate_tier_level bigint DEFAULT 0 NOT NULL;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS arrears_since timestamp with time zone;

-- loans already opened on a Multiple interest scheme get the ladder their scheme holds today
UPDATE public.loans l SET scheme_rate_tiers = s.rate_tiers, scheme_minimum_days = s.minimum_days
FROM public.schemes s
WHERE l.scheme_id = s.id AND l.scheme_interest_method = 'Multiple interest' AND l.scheme_rate_tiers IS NULL;

-- +migrate Down

ALTER TABLE public.loans DROP COLUMN IF EXISTS arrears_since;
ALTER TABLE public.loans DROP COLUMN IF EXISTS rate_tier_level;
ALTER TABLE public.loans DROP COLUMN IF EXISTS scheme_minimum_days;
ALTER TABLE public.loans DROP COLUMN IF EXISTS scheme_rate_tiers;

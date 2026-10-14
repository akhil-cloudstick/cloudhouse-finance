-- +migrate Up

-- every scheme now carries a minimum period, whatever its interest method; existing schemes and the loans already opened on them get 30 days
-- (a longer minimum already set on a Multiple-interest scheme or loan is kept)
UPDATE public.schemes SET minimum_days = 30 WHERE minimum_days < 30;
UPDATE public.loans SET scheme_minimum_days = 30 WHERE scheme_minimum_days < 30;

-- +migrate Down

-- the earlier values are not recoverable; the minimum period stays at 30 days

-- +migrate Up

-- false = a scheme whose loans are not limited by the gold's LTV (ltv_percent is then 0).
ALTER TABLE public.schemes ADD COLUMN IF NOT EXISTS ltv_based boolean NOT NULL DEFAULT true;

-- +migrate Down
ALTER TABLE public.schemes DROP COLUMN IF EXISTS ltv_based;

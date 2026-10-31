-- +migrate Up

-- A bank can have several branches (e.g. Canara Bank - Palakkad and Canara Bank - Thrissur),
-- so uniqueness is the name together with the bank's branch, not the name alone.
DROP INDEX IF EXISTS public.uq_banks_tenant_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_banks_tenant_name_branch ON public.banks USING btree (tenant_id, lower(name), lower(coalesce(branch, '')));

-- +migrate Down

DROP INDEX IF EXISTS public.uq_banks_tenant_name_branch;
-- Restoring the name-only index can fail if two branches of one bank now exist; clean those up first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_banks_tenant_name ON public.banks USING btree (tenant_id, name);

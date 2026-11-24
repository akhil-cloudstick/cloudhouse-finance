-- +migrate Up

-- A scheme created on a PC with no connection is addressed by the UUID that PC gave it, so a loan made right after
-- it can point at it before the server has numbered it.
ALTER TABLE public.schemes ADD COLUMN IF NOT EXISTS uuid uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS schemes_tenant_uuid_idx ON public.schemes (tenant_id, uuid);

-- +migrate Down

DROP INDEX IF EXISTS public.schemes_tenant_uuid_idx;
ALTER TABLE public.schemes DROP COLUMN IF EXISTS uuid;

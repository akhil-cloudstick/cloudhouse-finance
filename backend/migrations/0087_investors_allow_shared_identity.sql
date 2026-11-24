-- +migrate Up
-- The same phone number, PAN or Aadhaar may be on more than one investor record: the app asks the user to
-- confirm "are they the same person?" when the name differs, so uniqueness is no longer enforced by the database.
DROP INDEX IF EXISTS public.uq_investors_tenant_phone;
DROP INDEX IF EXISTS public.uq_investors_tenant_pan;
DROP INDEX IF EXISTS public.uq_investors_tenant_aadhaar;
CREATE INDEX IF NOT EXISTS idx_investors_tenant_phone ON public.investors USING btree (tenant_id, phone) WHERE (((phone)::text <> ''::text) AND (deleted_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_investors_tenant_pan ON public.investors USING btree (tenant_id, pan) WHERE ((pan IS NOT NULL) AND ((pan)::text <> ''::text) AND (deleted_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_investors_tenant_aadhaar ON public.investors USING btree (tenant_id, aadhaar_hash) WHERE ((aadhaar_hash IS NOT NULL) AND ((aadhaar_hash)::text <> ''::text) AND (deleted_at IS NULL));

-- +migrate Down
DROP INDEX IF EXISTS public.idx_investors_tenant_phone;
DROP INDEX IF EXISTS public.idx_investors_tenant_pan;
DROP INDEX IF EXISTS public.idx_investors_tenant_aadhaar;
CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_phone ON public.investors USING btree (tenant_id, phone) WHERE (((phone)::text <> ''::text) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_pan ON public.investors USING btree (tenant_id, pan) WHERE ((pan IS NOT NULL) AND ((pan)::text <> ''::text) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_aadhaar ON public.investors USING btree (tenant_id, aadhaar_hash) WHERE ((aadhaar_hash IS NOT NULL) AND ((aadhaar_hash)::text <> ''::text) AND (deleted_at IS NULL));

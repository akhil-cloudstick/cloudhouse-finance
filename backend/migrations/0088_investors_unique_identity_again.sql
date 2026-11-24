-- +migrate Up
-- A phone number, PAN or Aadhaar belongs to one investor again. 0087 relaxed this; the app now asks "same person?"
-- and, when the answer is yes, reuses the existing record instead of adding a second one. Each unique index is
-- only created when the data already satisfies it — if duplicates are on file (added while 0087 was in force)
-- the index is skipped with a notice; the app-level check still blocks new duplicates. Remove the extra record
-- and re-run this statement to get the database-level guarantee back.
-- +migrate StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.investors WHERE phone <> '' AND deleted_at IS NULL GROUP BY tenant_id, phone HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_phone ON public.investors USING btree (tenant_id, phone) WHERE (((phone)::text <> ''::text) AND (deleted_at IS NULL));
  ELSE
    RAISE NOTICE 'uq_investors_tenant_phone skipped: duplicate phone numbers are on file';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investors WHERE pan IS NOT NULL AND pan <> '' AND deleted_at IS NULL GROUP BY tenant_id, pan HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_pan ON public.investors USING btree (tenant_id, pan) WHERE ((pan IS NOT NULL) AND ((pan)::text <> ''::text) AND (deleted_at IS NULL));
  ELSE
    RAISE NOTICE 'uq_investors_tenant_pan skipped: duplicate PANs are on file';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investors WHERE aadhaar_hash IS NOT NULL AND aadhaar_hash <> '' AND deleted_at IS NULL GROUP BY tenant_id, aadhaar_hash HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_aadhaar ON public.investors USING btree (tenant_id, aadhaar_hash) WHERE ((aadhaar_hash IS NOT NULL) AND ((aadhaar_hash)::text <> ''::text) AND (deleted_at IS NULL));
  ELSE
    RAISE NOTICE 'uq_investors_tenant_aadhaar skipped: duplicate Aadhaar numbers are on file';
  END IF;
END
$$;
-- +migrate StatementEnd

-- +migrate Down
DROP INDEX IF EXISTS public.uq_investors_tenant_phone;
DROP INDEX IF EXISTS public.uq_investors_tenant_pan;
DROP INDEX IF EXISTS public.uq_investors_tenant_aadhaar;

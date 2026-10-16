-- +migrate Up

-- "Multiple interest" schemes are now an optional module switched on per business
-- from the superadmin console. A business that already has such a scheme gets the
-- module, so nothing it uses today disappears.
-- schemes force RLS, so each business is checked under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id, enabled_modules FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		IF EXISTS (SELECT 1 FROM schemes WHERE tenant_id = t.id AND interest_method = 'Multiple interest' AND deleted_at IS NULL)
			AND NOT (',' || COALESCE(t.enabled_modules, '') || ',') LIKE '%,multiple_interest,%' THEN
			UPDATE public.tenants
			SET enabled_modules = CASE WHEN COALESCE(enabled_modules, '') = '' THEN 'multiple_interest' ELSE enabled_modules || ',multiple_interest' END
			WHERE id = t.id;
		END IF;
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

UPDATE public.tenants
SET enabled_modules = TRIM(BOTH ',' FROM REPLACE(',' || COALESCE(enabled_modules, '') || ',', ',multiple_interest,', ','))
WHERE (',' || COALESCE(enabled_modules, '') || ',') LIKE '%,multiple_interest,%';

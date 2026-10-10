-- +migrate Up

-- roles and role_permissions force RLS, so orphans are removed under each business's app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		DELETE FROM role_permissions rp WHERE rp.tenant_id = t.id
			AND (NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = rp.role_id)
				OR NOT EXISTS (SELECT 1 FROM permissions p WHERE p.id = rp.permission_id));
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_permissions_role') THEN
		ALTER TABLE ONLY public.role_permissions
	ADD CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_permissions_permission') THEN
		ALTER TABLE ONLY public.role_permissions
	ADD CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

ALTER TABLE ONLY public.role_permissions DROP CONSTRAINT IF EXISTS fk_role_permissions_permission;
ALTER TABLE ONLY public.role_permissions DROP CONSTRAINT IF EXISTS fk_role_permissions_role;

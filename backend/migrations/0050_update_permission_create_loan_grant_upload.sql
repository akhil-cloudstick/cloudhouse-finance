-- +migrate Up

-- "can create upload" is now a parent of "can create loan" (the overall photo is
-- mandatory for TML businesses). Every role that already creates loans gets upload,
-- so no existing grant is left without its parent.
-- roles and role_permissions force RLS, so each business is back-filled under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		INSERT INTO role_permissions (tenant_id, role_id, permission_id, permission)
		SELECT rp.tenant_id, rp.role_id, up.id, TRUE
		FROM role_permissions rp
		JOIN permissions lp ON lp.id = rp.permission_id AND lp.name = 'can create loan'
		CROSS JOIN permissions up
		WHERE up.name = 'can create upload' AND rp.permission AND rp.tenant_id = t.id
		ON CONFLICT (role_id, permission_id) DO UPDATE SET permission = TRUE;
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

-- No-op: which roles held upload before this back-fill is not recorded, and
-- revoking it would break uploads for roles that already had it.
SELECT 1;

-- +migrate Up

-- Business Profile follows the grant-all default: every existing role gets view
-- and update; the administrator revokes per role on the Roles screen.
-- roles and role_permissions force RLS, so each business is back-filled under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		INSERT INTO role_permissions (tenant_id, role_id, permission_id, permission)
		SELECT r.tenant_id, r.id, p.id, TRUE
		FROM roles r CROSS JOIN permissions p
		WHERE p.name IN ('can view business profile module', 'can update business profile') AND r.tenant_id = t.id
		ON CONFLICT (role_id, permission_id) DO UPDATE SET permission = TRUE;
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

-- back to 0048's defaults: view for Administrator/Management, update for Administrator
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		UPDATE role_permissions rp
		SET permission = (r.name IN ('Administrator', 'Management') OR r.is_system)
		FROM roles r, permissions p
		WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.tenant_id = t.id
			AND p.name = 'can view business profile module';
		UPDATE role_permissions rp
		SET permission = (r.name = 'Administrator' OR r.is_system)
		FROM roles r, permissions p
		WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.tenant_id = t.id
			AND p.name = 'can update business profile';
	END LOOP;
END $$;
-- +migrate StatementEnd

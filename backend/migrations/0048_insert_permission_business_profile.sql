-- +migrate Up

INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view business profile module', 'View the business profile (registration no., phone, address, lender particulars)', 'Business Profile', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view business profile module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update business profile', 'Edit the business profile printed on slips, statements and pledge agreements', 'Business Profile', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update business profile');

-- roles and role_permissions force RLS, so each business is back-filled under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		INSERT INTO role_permissions (tenant_id, role_id, permission_id, permission)
		SELECT r.tenant_id, r.id, p.id, (r.name IN ('Administrator', 'Management') OR r.is_system)
		FROM roles r CROSS JOIN permissions p
		WHERE p.name = 'can view business profile module' AND r.tenant_id = t.id
		ON CONFLICT (role_id, permission_id) DO NOTHING;
		INSERT INTO role_permissions (tenant_id, role_id, permission_id, permission)
		SELECT r.tenant_id, r.id, p.id, (r.name = 'Administrator' OR r.is_system)
		FROM roles r CROSS JOIN permissions p
		WHERE p.name = 'can update business profile' AND r.tenant_id = t.id
		ON CONFLICT (role_id, permission_id) DO NOTHING;
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		DELETE FROM role_permissions WHERE tenant_id = t.id AND permission_id IN (SELECT id FROM permissions WHERE name IN ('can view business profile module', 'can update business profile'));
	END LOOP;
END $$;
-- +migrate StatementEnd

DELETE FROM permissions WHERE name IN ('can view business profile module', 'can update business profile');

-- +migrate Up

INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can give discount', 'Give the customer a discount (write-off) when recording a loan payment or gold release', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can give discount');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can edit ledger entry', 'Edit loan ledger entries (payments, discounts, top-ups, auctions, gold release, bank pledges, interest) — the loan is recalculated', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can edit ledger entry');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete ledger entry', 'Delete (void) loan ledger entries — the loan is recalculated', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete ledger entry');

-- roles and role_permissions force RLS, so each business is back-filled under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		INSERT INTO role_permissions (tenant_id, role_id, permission_id, permission)
		SELECT r.tenant_id, r.id, p.id, (r.name IN ('Administrator', 'Management', 'Branch Manager', 'Loan Operator') OR r.is_system)
		FROM roles r CROSS JOIN permissions p
		WHERE p.name = 'can give discount' AND r.tenant_id = t.id
		ON CONFLICT (role_id, permission_id) DO NOTHING;
		INSERT INTO role_permissions (tenant_id, role_id, permission_id, permission)
		SELECT r.tenant_id, r.id, p.id, (r.name = 'Administrator' OR r.is_system)
		FROM roles r CROSS JOIN permissions p
		WHERE p.name IN ('can edit ledger entry', 'can delete ledger entry') AND r.tenant_id = t.id
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
		DELETE FROM role_permissions WHERE tenant_id = t.id AND permission_id IN (SELECT id FROM permissions WHERE name IN ('can give discount', 'can edit ledger entry', 'can delete ledger entry'));
	END LOOP;
END $$;
-- +migrate StatementEnd

DELETE FROM permissions WHERE name IN ('can give discount', 'can edit ledger entry', 'can delete ledger entry');

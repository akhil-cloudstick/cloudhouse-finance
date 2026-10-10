-- +migrate Up

-- roles and role_permissions force RLS, so each business is cleaned under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		DELETE FROM role_permissions WHERE tenant_id = t.id AND permission_id IN (SELECT id FROM permissions WHERE name IN (
			'can verify loan',
			'can approve branch manager stage',
			'can sanction loan',
			'can verify the loan extension',
			'can approve extension branch manager stage',
			'can approve extension management stage',
			'can approve release manager stage',
			'can approve release management stage',
			'can decide auction partial repayment',
			'can decide auction shortfall',
			'can approve expense',
			'can approve top-up branch manager stage',
			'can approve top-up management stage',
			'can approve personal loan branch manager stage',
			'can approve personal loan management stage'
		));
	END LOOP;
END $$;
-- +migrate StatementEnd

DELETE FROM permissions WHERE name IN (
	'can verify loan',
	'can approve branch manager stage',
	'can sanction loan',
	'can verify the loan extension',
	'can approve extension branch manager stage',
	'can approve extension management stage',
	'can approve release manager stage',
	'can approve release management stage',
	'can decide auction partial repayment',
	'can decide auction shortfall',
	'can approve expense',
	'can approve top-up branch manager stage',
	'can approve top-up management stage',
	'can approve personal loan branch manager stage',
	'can approve personal loan management stage'
);

-- +migrate Down

INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can verify loan', 'Verify a loan at the Loan Operator sanction stage', 'Loan Sanction', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can verify loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve branch manager stage', 'Approve a loan at the Branch Manager sanction stage', 'Loan Sanction', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can sanction loan', 'Give final sanction to a loan (Management stage)', 'Loan Sanction', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can sanction loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can verify the loan extension', 'Verify a loan extension request at the Loan Officer stage', 'Loan Extension Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can verify the loan extension');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve extension branch manager stage', 'Approve a loan extension request at the Branch Manager stage', 'Loan Extension Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve extension branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve extension management stage', 'Approve a loan extension request at the Management stage', 'Loan Extension Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve extension management stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve release manager stage', 'Approve a gold release request at the Manager stage', 'Release Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve release manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve release management stage', 'Approve a gold release request at the Management stage', 'Release Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve release management stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can decide auction partial repayment', 'Decide whether a loan stays in or is removed from auction after a partial repayment', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can decide auction partial repayment');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can decide auction shortfall', 'Decide whether an auction shortfall is pursued or written off', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can decide auction shortfall');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve expense', 'Approve or reject a recorded expense before it is posted', 'Expense Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve expense');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve top-up branch manager stage', 'Approve a loan top-up at the Branch Manager stage', 'Top-Up Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve top-up branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve top-up management stage', 'Approve a loan top-up at the Management stage', 'Top-Up Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve top-up management stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve personal loan branch manager stage', 'Approve a personal loan at the Branch Manager stage', 'Personal Loan Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve personal loan branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve personal loan management stage', 'Approve a personal loan at the Management stage', 'Personal Loan Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve personal loan management stage');

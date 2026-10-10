-- +migrate Up

INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view branch module', 'View branches', 'Branch Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view branch module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create branch', 'Create branches', 'Branch Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create branch');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update branch', 'Update branches', 'Branch Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update branch');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete branch', 'Delete branches', 'Branch Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete branch');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view branch ledger', 'View and download a branch''s ledger', 'Branch Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view branch ledger');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view scheme module', 'View loan schemes', 'Scheme Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view scheme module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create scheme', 'Create loan schemes', 'Scheme Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create scheme');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update scheme', 'Update loan schemes', 'Scheme Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update scheme');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete scheme', 'Delete loan schemes', 'Scheme Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete scheme');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view gold rate module', 'View gold rate history', 'Gold Rate Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view gold rate module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create gold rate', 'Record a new gold rate', 'Gold Rate Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create gold rate');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view purity standard module', 'View gold purity standards', 'Purity Standard Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view purity standard module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create purity standard', 'Create purity standards', 'Purity Standard Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create purity standard');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view employee module', 'View employees', 'Employee Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view employee module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create employee', 'Create employees', 'Employee Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create employee');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update employee', 'Update employees', 'Employee Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update employee');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete employee', 'Delete employees', 'Employee Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete employee');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view cash module', 'View cash movements, expenses and opening balance', 'Cash Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view cash module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create cash', 'Record cash movements and expenses', 'Cash Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create cash');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update cash', 'Update cash movements and approve or reject expenses', 'Cash Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update cash');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can export ledger', 'Download ledgers and statements as PDF or Excel', 'Ledger Export', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can export ledger');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view setting module', 'View integration API key settings', 'Settings Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view setting module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update setting', 'Update integration API key settings', 'Settings Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update setting');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete setting', 'Delete integration API key settings', 'Settings Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete setting');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view customer module', 'View customers and KYC', 'Customer Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view customer module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create customer', 'Create customers', 'Customer Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create customer');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update customer', 'Update customers', 'Customer Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update customer');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can hard delete customer', 'Permanently and irreversibly delete a customer and every record tied to them', 'Customer Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can hard delete customer');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view loan module', 'View loans, ornaments, approvals, payments, requests and auctions', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view loan module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create loan', 'Create loans, ornaments, drafts, requests and payments', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update loan', 'Update and act on loans, ornaments, approvals, payments, requests and auctions', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete loan', 'Delete loan drafts', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can top up loan', 'Top up a loan — disburse more against its pledged gold', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can top up loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can hard delete loan', 'Permanently and irreversibly delete a loan and every record tied to it', 'Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can hard delete loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view personal loan module', 'View personal loans, schedules and payments', 'Personal Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view personal loan module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create personal loan', 'Create personal loans', 'Personal Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create personal loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update personal loan', 'Record payments, renew and manage personal loans', 'Personal Loan Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update personal loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view investment module', 'View investment plans, investments, schedules and payouts', 'Investment Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view investment module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create investment', 'Create investment plans and investments', 'Investment Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create investment');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update investment', 'Update investment plans, mark payouts paid and apply maturity decisions', 'Investment Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update investment');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view bank pledge module', 'View bank pledge records', 'Bank Pledge Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view bank pledge module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create bank pledge', 'Re-pledge a loan''s gold to a bank', 'Bank Pledge Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create bank pledge');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update bank pledge', 'Release and void bank pledges', 'Bank Pledge Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update bank pledge');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create upload', 'Upload files (KYC documents, ornament photos, receipts)', 'Upload Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create upload');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view ornament type module', 'View ornament types', 'Ornament Type Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view ornament type module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create ornament type', 'Create ornament types', 'Ornament Type Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create ornament type');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view bank module', 'View banks (gold re-pledging counterparties)', 'Bank Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view bank module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create bank', 'Create banks', 'Bank Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create bank');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update bank', 'Update banks', 'Bank Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update bank');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete bank', 'Delete banks', 'Bank Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete bank');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view locker module', 'View lockers', 'Locker Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view locker module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create locker', 'Create lockers', 'Locker Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create locker');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update locker', 'Update lockers', 'Locker Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update locker');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete locker', 'Delete lockers', 'Locker Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete locker');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view packet module', 'View gold packets', 'Packet Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view packet module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update packet', 'Move gold packets', 'Packet Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update packet');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view reminder module', 'View reminders', 'Reminder Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view reminder module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create reminder', 'Create reminders', 'Reminder Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create reminder');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update reminder', 'Update reminders', 'Reminder Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update reminder');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete reminder', 'Delete reminders', 'Reminder Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete reminder');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view report module', 'View and export management reports', 'Report Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view report module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view audit log module', 'View the record of employee and branch changes', 'Audit Log', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view audit log module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can manage billing', 'Subscribe to or renew this business''s plan, and view billing status', 'Billing', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can manage billing');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view role and permission module', 'View roles and their permission grants', 'Role Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view role and permission module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can create role', 'Create new roles', 'Role Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can create role');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can update role', 'Rename roles, edit their grants and the approval workflow', 'Role Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can update role');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can delete role', 'Delete roles', 'Role Management', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can delete role');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can verify loan', 'Verify a loan at the Loan Operator sanction stage', 'Loan Sanction', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can verify loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve branch manager stage', 'Approve a loan at the Branch Manager sanction stage', 'Loan Sanction', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can sanction loan', 'Give final sanction to a loan (Management stage)', 'Loan Sanction', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can sanction loan');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can verify the loan extension', 'Verify a loan extension request at the Loan Officer stage', 'Loan Extension Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can verify the loan extension');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve extension branch manager stage', 'Approve a loan extension request at the Branch Manager stage', 'Loan Extension Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve extension branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve extension management stage', 'Approve a loan extension request at the Management stage', 'Loan Extension Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve extension management stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can verify release checklist', 'Verify a gold release request''s checklist (payment, packet, bank pledge, customer confirmation) before it goes to the Manager/Management approval stages', 'Release Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can verify release checklist');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve release manager stage', 'Approve a gold release request at the Manager stage', 'Release Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve release manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve release management stage', 'Approve a gold release request at the Management stage', 'Release Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve release management stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can view auction module', 'View auction cases, notices, sales and auction history', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can view auction module');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can decide auction partial repayment', 'Decide whether a loan stays in or is removed from auction after a partial repayment', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can decide auction partial repayment');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can decide auction shortfall', 'Decide whether an auction shortfall is pursued or written off', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can decide auction shortfall');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can mark loan auction eligible', 'Mark a defaulted loan eligible for auction', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can mark loan auction eligible');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can issue auction notice', 'Issue an auction notice to the customer', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can issue auction notice');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can schedule auction', 'Schedule an auction date for a loan', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can schedule auction');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can record auction sale', 'Record the sale amount and expenses of a conducted auction', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can record auction sale');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can settle auction', 'Settle an auction''s surplus disposition', 'Auction Workflow', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can settle auction');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve expense', 'Approve or reject a recorded expense before it is posted', 'Expense Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve expense');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve top-up branch manager stage', 'Approve a loan top-up at the Branch Manager stage', 'Top-Up Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve top-up branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve top-up management stage', 'Approve a loan top-up at the Management stage', 'Top-Up Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve top-up management stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve personal loan branch manager stage', 'Approve a personal loan at the Branch Manager stage', 'Personal Loan Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve personal loan branch manager stage');
INSERT INTO permissions (name, description, module_name, is_active) SELECT 'can approve personal loan management stage', 'Approve a personal loan at the Management stage', 'Personal Loan Approval', TRUE WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'can approve personal loan management stage');

-- +migrate Down

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name IN (
	'can view branch module',
	'can create branch',
	'can update branch',
	'can delete branch',
	'can view branch ledger',
	'can view scheme module',
	'can create scheme',
	'can update scheme',
	'can delete scheme',
	'can view gold rate module',
	'can create gold rate',
	'can view purity standard module',
	'can create purity standard',
	'can view employee module',
	'can create employee',
	'can update employee',
	'can delete employee',
	'can view cash module',
	'can create cash',
	'can update cash',
	'can export ledger',
	'can view setting module',
	'can update setting',
	'can delete setting',
	'can view customer module',
	'can create customer',
	'can update customer',
	'can hard delete customer',
	'can view loan module',
	'can create loan',
	'can update loan',
	'can delete loan',
	'can top up loan',
	'can hard delete loan',
	'can view personal loan module',
	'can create personal loan',
	'can update personal loan',
	'can view investment module',
	'can create investment',
	'can update investment',
	'can view bank pledge module',
	'can create bank pledge',
	'can update bank pledge',
	'can create upload',
	'can view ornament type module',
	'can create ornament type',
	'can view bank module',
	'can create bank',
	'can update bank',
	'can delete bank',
	'can view locker module',
	'can create locker',
	'can update locker',
	'can delete locker',
	'can view packet module',
	'can update packet',
	'can view reminder module',
	'can create reminder',
	'can update reminder',
	'can delete reminder',
	'can view report module',
	'can view audit log module',
	'can manage billing',
	'can view role and permission module',
	'can create role',
	'can update role',
	'can delete role',
	'can verify loan',
	'can approve branch manager stage',
	'can sanction loan',
	'can verify the loan extension',
	'can approve extension branch manager stage',
	'can approve extension management stage',
	'can verify release checklist',
	'can approve release manager stage',
	'can approve release management stage',
	'can view auction module',
	'can decide auction partial repayment',
	'can decide auction shortfall',
	'can mark loan auction eligible',
	'can issue auction notice',
	'can schedule auction',
	'can record auction sale',
	'can settle auction',
	'can approve expense',
	'can approve top-up branch manager stage',
	'can approve top-up management stage',
	'can approve personal loan branch manager stage',
	'can approve personal loan management stage'
));

DELETE FROM permissions WHERE name IN (
	'can view branch module',
	'can create branch',
	'can update branch',
	'can delete branch',
	'can view branch ledger',
	'can view scheme module',
	'can create scheme',
	'can update scheme',
	'can delete scheme',
	'can view gold rate module',
	'can create gold rate',
	'can view purity standard module',
	'can create purity standard',
	'can view employee module',
	'can create employee',
	'can update employee',
	'can delete employee',
	'can view cash module',
	'can create cash',
	'can update cash',
	'can export ledger',
	'can view setting module',
	'can update setting',
	'can delete setting',
	'can view customer module',
	'can create customer',
	'can update customer',
	'can hard delete customer',
	'can view loan module',
	'can create loan',
	'can update loan',
	'can delete loan',
	'can top up loan',
	'can hard delete loan',
	'can view personal loan module',
	'can create personal loan',
	'can update personal loan',
	'can view investment module',
	'can create investment',
	'can update investment',
	'can view bank pledge module',
	'can create bank pledge',
	'can update bank pledge',
	'can create upload',
	'can view ornament type module',
	'can create ornament type',
	'can view bank module',
	'can create bank',
	'can update bank',
	'can delete bank',
	'can view locker module',
	'can create locker',
	'can update locker',
	'can delete locker',
	'can view packet module',
	'can update packet',
	'can view reminder module',
	'can create reminder',
	'can update reminder',
	'can delete reminder',
	'can view report module',
	'can view audit log module',
	'can manage billing',
	'can view role and permission module',
	'can create role',
	'can update role',
	'can delete role',
	'can verify loan',
	'can approve branch manager stage',
	'can sanction loan',
	'can verify the loan extension',
	'can approve extension branch manager stage',
	'can approve extension management stage',
	'can verify release checklist',
	'can approve release manager stage',
	'can approve release management stage',
	'can view auction module',
	'can decide auction partial repayment',
	'can decide auction shortfall',
	'can mark loan auction eligible',
	'can issue auction notice',
	'can schedule auction',
	'can record auction sale',
	'can settle auction',
	'can approve expense',
	'can approve top-up branch manager stage',
	'can approve top-up management stage',
	'can approve personal loan branch manager stage',
	'can approve personal loan management stage'
);

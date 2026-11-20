CREATE TABLE IF NOT EXISTS branches (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  name TEXT,
  code TEXT,
  address TEXT,
  phone TEXT,
  is_active INTEGER,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_branches_updated_at ON branches (updated_at);

CREATE TABLE IF NOT EXISTS schemes (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  uuid TEXT,
  branch_id INTEGER,
  code TEXT,
  name TEXT,
  interest_rate REAL,
  duration_months INTEGER,
  ltv_percent REAL,
  interest_method TEXT,
  penal_rate REAL,
  accrual_basis TEXT,
  rate_tiers TEXT,
  minimum_days INTEGER,
  conditions TEXT,
  is_active INTEGER,
  service_charge_type TEXT,
  service_charge_value REAL,
  service_charge_mode TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_schemes_uuid ON schemes (uuid);
CREATE INDEX IF NOT EXISTS idx_schemes_branch_id ON schemes (branch_id);
CREATE INDEX IF NOT EXISTS idx_schemes_updated_at ON schemes (updated_at);

CREATE TABLE IF NOT EXISTS gold_rates (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  date DATETIME,
  k24 REAL,
  k22 REAL,
  k18 REAL,
  fineness22 REAL,
  fineness18 REAL,
  set_by TEXT,
  set_by_designation TEXT,
  created_at DATETIME
);

CREATE TABLE IF NOT EXISTS employees (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  code TEXT,
  name TEXT,
  role TEXT,
  role_id INTEGER,
  branch_id INTEGER,
  phone TEXT,
  loans_processed INTEGER,
  collections REAL,
  followups INTEGER,
  pending INTEGER,
  username TEXT,
  email TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_employees_role_id ON employees (role_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON employees (branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_updated_at ON employees (updated_at);

CREATE TABLE IF NOT EXISTS banks (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  name TEXT,
  branch_id INTEGER,
  branch TEXT,
  ifsc TEXT,
  account_no TEXT,
  phone TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_banks_branch_id ON banks (branch_id);
CREATE INDEX IF NOT EXISTS idx_banks_updated_at ON banks (updated_at);

CREATE TABLE IF NOT EXISTS customers (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  uuid TEXT,
  code TEXT,
  name TEXT,
  phone TEXT,
  dob DATETIME,
  address TEXT,
  branch_id INTEGER,
  photo_url TEXT,
  identity_proof_url TEXT,
  address_proof_url TEXT,
  kyc_document_url TEXT,
  pan TEXT,
  aadhaar_last4 TEXT,
  nominee_name TEXT,
  nominee_relation TEXT,
  nominee_phone TEXT,
  father_name TEXT,
  district TEXT,
  taluk TEXT,
  village TEXT,
  place TEXT,
  pin_code TEXT,
  age INTEGER,
  customer_type TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  bank_ifsc TEXT,
  kyc_status TEXT,
  pan_status TEXT,
  aadhaar_status TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_customers_uuid ON customers (uuid);
CREATE INDEX IF NOT EXISTS idx_customers_branch_id ON customers (branch_id);
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers (updated_at);

CREATE TABLE IF NOT EXISTS ornament_types (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  name TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_ornament_types_updated_at ON ornament_types (updated_at);

CREATE TABLE IF NOT EXISTS purity_standards (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  karat INTEGER,
  fineness_percent REAL,
  label TEXT,
  is_active INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_purity_standards_updated_at ON purity_standards (updated_at);

CREATE TABLE IF NOT EXISTS roles (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  name TEXT,
  description TEXT,
  is_active INTEGER,
  is_system INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_roles_updated_at ON roles (updated_at);

CREATE TABLE IF NOT EXISTS role_permissions (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  role_id INTEGER,
  permission_id INTEGER,
  permission INTEGER
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions (role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions (permission_id);

CREATE TABLE IF NOT EXISTS permissions (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  name TEXT,
  description TEXT,
  module_name TEXT,
  is_active INTEGER
);

CREATE TABLE IF NOT EXISTS approval_actions (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  flow TEXT,
  entity_id INTEGER,
  stage TEXT,
  action TEXT,
  actor_employee_id INTEGER,
  actor_role TEXT,
  remarks TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_approval_actions_entity_id ON approval_actions (entity_id);
CREATE INDEX IF NOT EXISTS idx_approval_actions_actor_employee_id ON approval_actions (actor_employee_id);
CREATE INDEX IF NOT EXISTS idx_approval_actions_updated_at ON approval_actions (updated_at);

CREATE TABLE IF NOT EXISTS approval_category_modes (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  category TEXT,
  shared INTEGER,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_approval_category_modes_updated_at ON approval_category_modes (updated_at);

CREATE TABLE IF NOT EXISTS approval_chains (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  scope TEXT,
  role_ids TEXT,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_approval_chains_updated_at ON approval_chains (updated_at);

CREATE TABLE IF NOT EXISTS approval_stage_settings (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  flow TEXT,
  stage TEXT,
  enabled INTEGER,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_approval_stage_settings_updated_at ON approval_stage_settings (updated_at);

CREATE TABLE IF NOT EXISTS cash_movements (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  type TEXT,
  source TEXT,
  purpose TEXT,
  mode TEXT,
  bank TEXT,
  amount REAL,
  status TEXT,
  branch_id INTEGER,
  occurred_on DATETIME,
  transaction_group_id TEXT,
  bank_id INTEGER,
  to_bank_id INTEGER,
  counter_bank_id INTEGER,
  party_customer_id INTEGER,
  expense_id INTEGER,
  receipt_image TEXT,
  source_type TEXT,
  source_id INTEGER,
  remarks TEXT,
  is_manual INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_branch_id ON cash_movements (branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_transaction_group_id ON cash_movements (transaction_group_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_bank_id ON cash_movements (bank_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_to_bank_id ON cash_movements (to_bank_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_counter_bank_id ON cash_movements (counter_bank_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_party_customer_id ON cash_movements (party_customer_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_expense_id ON cash_movements (expense_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_source_id ON cash_movements (source_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_updated_at ON cash_movements (updated_at);

CREATE TABLE IF NOT EXISTS categories (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  type TEXT,
  name TEXT,
  is_common INTEGER,
  loan_number TEXT,
  principal_amount REAL,
  loan_opened_at DATETIME,
  created_at DATETIME
);

CREATE TABLE IF NOT EXISTS expenses (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  occurred_on DATETIME,
  category TEXT,
  amount REAL,
  mode TEXT,
  payee TEXT,
  from_bank_id INTEGER,
  to_bank_id INTEGER,
  branch_id INTEGER,
  status TEXT,
  approval_stage TEXT,
  remarks TEXT,
  approved_by TEXT,
  approved_at DATETIME,
  receipt_image TEXT,
  cash_movement_id INTEGER,
  group_id TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_expenses_from_bank_id ON expenses (from_bank_id);
CREATE INDEX IF NOT EXISTS idx_expenses_to_bank_id ON expenses (to_bank_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_id ON expenses (branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_cash_movement_id ON expenses (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group_id ON expenses (group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_updated_at ON expenses (updated_at);

CREATE TABLE IF NOT EXISTS gold_sales (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  ornament_type TEXT,
  sold_amount REAL,
  cost_amount REAL,
  profit REAL,
  sold_on DATETIME,
  branch_id INTEGER,
  cash_movement_id INTEGER,
  cost_cash_movement_id INTEGER,
  mode TEXT,
  bank_id INTEGER,
  cost_mode TEXT,
  cost_bank_id INTEGER,
  remarks TEXT,
  receipt_image TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_gold_sales_branch_id ON gold_sales (branch_id);
CREATE INDEX IF NOT EXISTS idx_gold_sales_cash_movement_id ON gold_sales (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_gold_sales_cost_cash_movement_id ON gold_sales (cost_cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_gold_sales_bank_id ON gold_sales (bank_id);
CREATE INDEX IF NOT EXISTS idx_gold_sales_cost_bank_id ON gold_sales (cost_bank_id);
CREATE INDEX IF NOT EXISTS idx_gold_sales_updated_at ON gold_sales (updated_at);

CREATE TABLE IF NOT EXISTS loan_cash_sources (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  cash_movement_id INTEGER,
  loan_number TEXT,
  principal_amount REAL,
  interest_rate REAL,
  duration_months INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_cash_sources_cash_movement_id ON loan_cash_sources (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_loan_cash_sources_updated_at ON loan_cash_sources (updated_at);

CREATE TABLE IF NOT EXISTS opening_cash_balances (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  branch_id INTEGER,
  balance_date DATETIME,
  mode TEXT,
  bank_id INTEGER,
  from_bank_id INTEGER,
  amount REAL,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_branch_id ON opening_cash_balances (branch_id);
CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_bank_id ON opening_cash_balances (bank_id);
CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_from_bank_id ON opening_cash_balances (from_bank_id);
CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_updated_at ON opening_cash_balances (updated_at);

CREATE TABLE IF NOT EXISTS investments (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  investment_number TEXT,
  branch_id INTEGER,
  customer_id INTEGER,
  plan_id INTEGER,
  created_by_employee_id INTEGER,
  principal_amount REAL,
  interest_rate_type TEXT,
  interest_rate_percent REAL,
  payout_frequency TEXT,
  tenure_months INTEGER,
  engine TEXT,
  outstanding_principal REAL,
  accrued_interest REAL,
  interest_withdrawn REAL,
  last_accrual_date DATETIME,
  start_date DATETIME,
  maturity_date DATETIME,
  status TEXT,
  total_interest_paid REAL,
  closed_at DATETIME,
  renewed_from_investment_id INTEGER,
  renewed_to_investment_id INTEGER,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_investments_branch_id ON investments (branch_id);
CREATE INDEX IF NOT EXISTS idx_investments_customer_id ON investments (customer_id);
CREATE INDEX IF NOT EXISTS idx_investments_plan_id ON investments (plan_id);
CREATE INDEX IF NOT EXISTS idx_investments_created_by_employee_id ON investments (created_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_investments_renewed_from_investment_id ON investments (renewed_from_investment_id);
CREATE INDEX IF NOT EXISTS idx_investments_renewed_to_investment_id ON investments (renewed_to_investment_id);
CREATE INDEX IF NOT EXISTS idx_investments_updated_at ON investments (updated_at);

CREATE TABLE IF NOT EXISTS investment_payouts (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  investment_id INTEGER,
  sequence_no INTEGER,
  due_date DATETIME,
  amount REAL,
  is_principal_return INTEGER,
  status TEXT,
  cash_amount REAL,
  upi_amount REAL,
  bank_transfer_amount REAL,
  cheque_amount REAL,
  paid_at DATETIME,
  paid_by_employee_id INTEGER,
  cash_movement_id INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_investment_payouts_investment_id ON investment_payouts (investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_payouts_paid_by_employee_id ON investment_payouts (paid_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_investment_payouts_cash_movement_id ON investment_payouts (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_investment_payouts_updated_at ON investment_payouts (updated_at);

CREATE TABLE IF NOT EXISTS investment_plans (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  name TEXT,
  interest_rate_type TEXT,
  interest_rate_percent REAL,
  payout_frequency TEXT,
  tenure_months INTEGER,
  engine TEXT,
  product_type TEXT,
  min_principal REAL,
  is_active INTEGER,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_investment_plans_updated_at ON investment_plans (updated_at);

CREATE TABLE IF NOT EXISTS investment_transactions (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  investment_id INTEGER,
  type TEXT,
  amount REAL,
  principal_amount REAL,
  interest_amount REAL,
  cash_amount REAL,
  upi_amount REAL,
  bank_transfer_amount REAL,
  cheque_amount REAL,
  principal_before REAL,
  principal_after REAL,
  interest_before REAL,
  interest_after REAL,
  occurred_on DATETIME,
  recorded_by_employee_id INTEGER,
  reference TEXT,
  cash_movement_id INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_investment_id ON investment_transactions (investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_recorded_by_employee_id ON investment_transactions (recorded_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_cash_movement_id ON investment_transactions (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_updated_at ON investment_transactions (updated_at);

CREATE TABLE IF NOT EXISTS loans (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  uuid TEXT,
  loan_number TEXT,
  branch_id INTEGER,
  customer_id INTEGER,
  scheme_id INTEGER,
  scheme_code TEXT,
  scheme_interest_rate REAL,
  scheme_duration_months INTEGER,
  scheme_ltv_percent REAL,
  scheme_interest_method TEXT,
  scheme_penal_rate REAL,
  scheme_rate_tiers TEXT,
  scheme_minimum_days INTEGER,
  scheme_accrual_basis TEXT,
  rate_tier_level INTEGER,
  arrears_since DATETIME,
  service_charge_type TEXT,
  service_charge_value REAL,
  service_charge_mode TEXT,
  service_charge_amount REAL,
  created_by_employee_id INTEGER,
  created_by_name TEXT,
  opened_date DATETIME,
  due_date DATETIME,
  closed_at DATETIME,
  additional_info TEXT,
  overall_photo_url TEXT,
  total_net_weight REAL,
  total_gold_value REAL,
  eligible_loan_amount REAL,
  principal_amount REAL,
  outstanding_amount REAL,
  outstanding_processing_fee REAL,
  accrued_interest REAL,
  interest_paid REAL,
  accrued_penal_interest REAL,
  penal_interest_paid REAL,
  last_accrual_date DATETIME,
  due_soon_notified_at DATETIME,
  overdue_notified_at DATETIME,
  interest_reminded_at DATETIME,
  status TEXT,
  approval_stage TEXT,
  rejected_by_employee_id INTEGER,
  rejected_by_name TEXT,
  rejected_at DATETIME,
  rejection_remarks TEXT,
  sanctioned_amount REAL,
  disbursed_amount REAL,
  disbursement_date DATETIME,
  bank_pledge_status TEXT,
  auction_date DATETIME,
  auction_amount REAL,
  indemnity_bond_document_id TEXT,
  indemnity_bond_sign_request_id TEXT,
  indemnity_bond_sign_status TEXT,
  indemnity_bond_signed_url TEXT,
  indemnity_bond_signed_at DATETIME,
  pledge_slip_sign_request_id TEXT,
  pledge_slip_sign_status TEXT,
  pledge_slip_signed_url TEXT,
  pledge_slip_signed_at DATETIME,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loans_uuid ON loans (uuid);
CREATE INDEX IF NOT EXISTS idx_loans_branch_id ON loans (branch_id);
CREATE INDEX IF NOT EXISTS idx_loans_customer_id ON loans (customer_id);
CREATE INDEX IF NOT EXISTS idx_loans_scheme_id ON loans (scheme_id);
CREATE INDEX IF NOT EXISTS idx_loans_created_by_employee_id ON loans (created_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_loans_rejected_by_employee_id ON loans (rejected_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_loans_indemnity_bond_document_id ON loans (indemnity_bond_document_id);
CREATE INDEX IF NOT EXISTS idx_loans_indemnity_bond_sign_request_id ON loans (indemnity_bond_sign_request_id);
CREATE INDEX IF NOT EXISTS idx_loans_pledge_slip_sign_request_id ON loans (pledge_slip_sign_request_id);
CREATE INDEX IF NOT EXISTS idx_loans_updated_at ON loans (updated_at);

CREATE TABLE IF NOT EXISTS ornaments (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  name TEXT,
  purity TEXT,
  gross_weight REAL,
  deduction_weight REAL,
  net_weight REAL,
  quantity INTEGER,
  gold_value REAL,
  remarks TEXT,
  released_at DATETIME,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_ornaments_loan_id ON ornaments (loan_id);
CREATE INDEX IF NOT EXISTS idx_ornaments_updated_at ON ornaments (updated_at);

CREATE TABLE IF NOT EXISTS ornament_images (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  ornament_id INTEGER,
  image_url TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_ornament_images_ornament_id ON ornament_images (ornament_id);

CREATE TABLE IF NOT EXISTS ornament_purity_tests (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  ornament_id INTEGER,
  tested_purity TEXT,
  tested_gross_weight REAL,
  tested_deduction_weight REAL,
  tested_net_weight REAL,
  testing_remarks TEXT,
  tested_by TEXT,
  tested_at DATETIME,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_ornament_purity_tests_ornament_id ON ornament_purity_tests (ornament_id);

CREATE TABLE IF NOT EXISTS loan_payments (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  amount REAL,
  type TEXT,
  paid_on DATETIME,
  received_by_employee_id INTEGER,
  description TEXT,
  method TEXT,
  reference TEXT,
  cash_amount REAL,
  upi_amount REAL,
  bank_transfer_amount REAL,
  cheque_amount REAL,
  bank_id INTEGER,
  needs_mode_review INTEGER,
  processing_fee_applied REAL,
  penal_interest_applied REAL,
  interest_applied REAL,
  principal_applied REAL,
  running_balance REAL,
  processing_fee REAL,
  interest_override REAL,
  discount_kind TEXT,
  linked_payment_id INTEGER,
  cash_transaction_group_id TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON loan_payments (loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_received_by_employee_id ON loan_payments (received_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_bank_id ON loan_payments (bank_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_linked_payment_id ON loan_payments (linked_payment_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_cash_transaction_group_id ON loan_payments (cash_transaction_group_id);

CREATE TABLE IF NOT EXISTS loan_top_ups (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  amount REAL,
  eligible_amount_at_top_up REAL,
  cash_amount REAL,
  upi_amount REAL,
  bank_transfer_amount REAL,
  cheque_amount REAL,
  occurred_on DATETIME,
  received_by_employee_id INTEGER,
  reference TEXT,
  status TEXT,
  approval_stage TEXT,
  settle_interest TEXT,
  bank_id INTEGER,
  reversal_of_movement_id INTEGER,
  cash_transaction_group_id TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_top_ups_loan_id ON loan_top_ups (loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_top_ups_received_by_employee_id ON loan_top_ups (received_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_loan_top_ups_bank_id ON loan_top_ups (bank_id);
CREATE INDEX IF NOT EXISTS idx_loan_top_ups_reversal_of_movement_id ON loan_top_ups (reversal_of_movement_id);
CREATE INDEX IF NOT EXISTS idx_loan_top_ups_cash_transaction_group_id ON loan_top_ups (cash_transaction_group_id);

CREATE TABLE IF NOT EXISTS loan_accruals (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  accrued_on DATETIME,
  interest REAL,
  penal_interest REAL,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_accruals_loan_id ON loan_accruals (loan_id);

CREATE TABLE IF NOT EXISTS loan_approvals (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  stage TEXT,
  action TEXT,
  actor_employee_id INTEGER,
  actor_role TEXT,
  remarks TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_approvals_loan_id ON loan_approvals (loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_approvals_actor_employee_id ON loan_approvals (actor_employee_id);

CREATE TABLE IF NOT EXISTS loan_requests (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  type TEXT,
  status TEXT,
  requested_by TEXT,
  detail TEXT,
  amount REAL,
  requested_extension_months INTEGER,
  new_due_date DATETIME,
  approval_stage TEXT,
  is_partial INTEGER,
  payment_verified INTEGER,
  packet_verified INTEGER,
  bank_pledge_verified INTEGER,
  customer_confirmed INTEGER,
  verification_notes TEXT,
  customer_saw_gold INTEGER,
  payment_recorded INTEGER,
  quote_met INTEGER,
  locked INTEGER,
  recorded_discount REAL,
  recorded_payment REAL,
  payment_due_date DATETIME,
  charges REAL,
  charges_applied REAL,
  settlement_amount REAL,
  remarks TEXT,
  requested_at DATETIME,
  decided_at DATETIME,
  decided_by_employee_id INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_requests_loan_id ON loan_requests (loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_requests_decided_by_employee_id ON loan_requests (decided_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_loan_requests_updated_at ON loan_requests (updated_at);

CREATE TABLE IF NOT EXISTS loan_request_ornaments (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  request_id INTEGER,
  ornament_id INTEGER,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_request_ornaments_request_id ON loan_request_ornaments (request_id);
CREATE INDEX IF NOT EXISTS idx_loan_request_ornaments_ornament_id ON loan_request_ornaments (ornament_id);

CREATE TABLE IF NOT EXISTS request_approvals (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  request_id INTEGER,
  stage TEXT,
  action TEXT,
  actor_employee_id INTEGER,
  remarks TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_request_approvals_request_id ON request_approvals (request_id);
CREATE INDEX IF NOT EXISTS idx_request_approvals_actor_employee_id ON request_approvals (actor_employee_id);

CREATE TABLE IF NOT EXISTS auction_records (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  stage TEXT,
  auction_eligible_date DATETIME,
  auction_date DATETIME,
  auction_reference_number TEXT,
  sale_amount REAL,
  auction_expenses REAL,
  surplus_shortfall REAL,
  final_settlement_status TEXT,
  surplus_payable_amount REAL,
  surplus_disposition TEXT,
  surplus_paid_out_movement_id INTEGER,
  surplus_remarks TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_auction_records_loan_id ON auction_records (loan_id);
CREATE INDEX IF NOT EXISTS idx_auction_records_surplus_paid_out_movement_id ON auction_records (surplus_paid_out_movement_id);
CREATE INDEX IF NOT EXISTS idx_auction_records_updated_at ON auction_records (updated_at);

CREATE TABLE IF NOT EXISTS auction_notices (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  auction_record_id INTEGER,
  issued_at DATETIME,
  method TEXT,
  remarks TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_auction_notices_auction_record_id ON auction_notices (auction_record_id);

CREATE TABLE IF NOT EXISTS auction_events (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  auction_record_id INTEGER,
  action TEXT,
  actor_employee_id INTEGER,
  actor_role TEXT,
  remarks TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_auction_events_auction_record_id ON auction_events (auction_record_id);
CREATE INDEX IF NOT EXISTS idx_auction_events_actor_employee_id ON auction_events (actor_employee_id);

CREATE TABLE IF NOT EXISTS auction_decision_requests (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  auction_record_id INTEGER,
  loan_id INTEGER,
  kind TEXT,
  triggered_by_payment_id INTEGER,
  amount_paid REAL,
  outstanding_at_request REAL,
  status TEXT,
  decided_by_employee_id INTEGER,
  decided_by_role TEXT,
  decision_remarks TEXT,
  decided_at DATETIME,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_auction_record_id ON auction_decision_requests (auction_record_id);
CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_loan_id ON auction_decision_requests (loan_id);
CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_triggered_by_payment_id ON auction_decision_requests (triggered_by_payment_id);
CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_decided_by_employee_id ON auction_decision_requests (decided_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_updated_at ON auction_decision_requests (updated_at);

CREATE TABLE IF NOT EXISTS bank_pledge_records (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_id INTEGER,
  bank_id INTEGER,
  bank_name TEXT,
  pledged_amount REAL,
  pledge_date DATETIME,
  release_date DATETIME,
  bank_pledge_due_date DATETIME,
  pledged_gross_weight REAL,
  pledged_net_weight REAL,
  bank_interest_rate REAL,
  reference_number TEXT,
  cash_movement_id INTEGER,
  expense_id INTEGER,
  release_cash_movement_id INTEGER,
  release_expense_id INTEGER,
  cash_treatment TEXT,
  cash_amount REAL,
  upi_amount REAL,
  bank_transfer_amount REAL,
  cheque_amount REAL,
  received_bank_id INTEGER,
  cash_transaction_group_id TEXT,
  release_cash_transaction_group_id TEXT,
  release_cash_amount REAL,
  release_upi_amount REAL,
  release_bank_transfer_amount REAL,
  release_cheque_amount REAL,
  release_bank_id INTEGER,
  ornament_ids TEXT,
  status TEXT,
  voided_at DATETIME,
  void_reason TEXT,
  void_cash_movement_id INTEGER,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_loan_id ON bank_pledge_records (loan_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_bank_id ON bank_pledge_records (bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_cash_movement_id ON bank_pledge_records (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_expense_id ON bank_pledge_records (expense_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_release_cash_movement_id ON bank_pledge_records (release_cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_release_expense_id ON bank_pledge_records (release_expense_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_received_bank_id ON bank_pledge_records (received_bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_cash_transaction_group_id ON bank_pledge_records (cash_transaction_group_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_release_cash_transaction_group_id ON bank_pledge_records (release_cash_transaction_group_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_release_bank_id ON bank_pledge_records (release_bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_void_cash_movement_id ON bank_pledge_records (void_cash_movement_id);

CREATE TABLE IF NOT EXISTS bank_pledge_events (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  bank_pledge_record_id INTEGER,
  action TEXT,
  actor_employee_id INTEGER,
  actor_role TEXT,
  amount REAL,
  remarks TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_events_bank_pledge_record_id ON bank_pledge_events (bank_pledge_record_id);
CREATE INDEX IF NOT EXISTS idx_bank_pledge_events_actor_employee_id ON bank_pledge_events (actor_employee_id);

CREATE TABLE IF NOT EXISTS loan_drafts (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  created_by_employee_id INTEGER,
  branch_id INTEGER,
  customer_id INTEGER,
  scheme_id INTEGER,
  locker_id INTEGER,
  principal_override REAL,
  overall_photo_url TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_loan_drafts_created_by_employee_id ON loan_drafts (created_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_loan_drafts_branch_id ON loan_drafts (branch_id);
CREATE INDEX IF NOT EXISTS idx_loan_drafts_customer_id ON loan_drafts (customer_id);
CREATE INDEX IF NOT EXISTS idx_loan_drafts_scheme_id ON loan_drafts (scheme_id);
CREATE INDEX IF NOT EXISTS idx_loan_drafts_locker_id ON loan_drafts (locker_id);
CREATE INDEX IF NOT EXISTS idx_loan_drafts_updated_at ON loan_drafts (updated_at);

CREATE TABLE IF NOT EXISTS loan_draft_ornaments (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  draft_id INTEGER,
  name TEXT,
  purity TEXT,
  gross_weight REAL,
  quantity INTEGER,
  image_url TEXT,
  image_name TEXT,
  image_urls TEXT,
  position INTEGER
);
CREATE INDEX IF NOT EXISTS idx_loan_draft_ornaments_draft_id ON loan_draft_ornaments (draft_id);

CREATE TABLE IF NOT EXISTS lockers (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  code TEXT,
  branch_id INTEGER,
  capacity INTEGER,
  is_active INTEGER,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_lockers_branch_id ON lockers (branch_id);
CREATE INDEX IF NOT EXISTS idx_lockers_updated_at ON lockers (updated_at);

CREATE TABLE IF NOT EXISTS packets (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  code TEXT,
  loan_id INTEGER,
  status TEXT,
  current_locker_id INTEGER,
  total_gross_weight REAL,
  total_net_weight REAL,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_packets_loan_id ON packets (loan_id);
CREATE INDEX IF NOT EXISTS idx_packets_current_locker_id ON packets (current_locker_id);
CREATE INDEX IF NOT EXISTS idx_packets_updated_at ON packets (updated_at);

CREATE TABLE IF NOT EXISTS packet_movements (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  packet_id INTEGER,
  from_status TEXT,
  to_status TEXT,
  locker_id INTEGER,
  actor_employee_id INTEGER,
  remarks TEXT,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_packet_movements_packet_id ON packet_movements (packet_id);
CREATE INDEX IF NOT EXISTS idx_packet_movements_locker_id ON packet_movements (locker_id);
CREATE INDEX IF NOT EXISTS idx_packet_movements_actor_employee_id ON packet_movements (actor_employee_id);

CREATE TABLE IF NOT EXISTS personal_loans (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  loan_number TEXT,
  branch_id INTEGER,
  customer_id INTEGER,
  created_by_employee_id INTEGER,
  principal_amount REAL,
  interest_type TEXT,
  interest_value REAL,
  interest_amount REAL,
  disbursed_amount REAL,
  disbursement_cash_amount REAL,
  disbursement_upi_amount REAL,
  disbursement_bank_transfer_amount REAL,
  disbursement_cheque_amount REAL,
  disbursement_bank_id INTEGER,
  disbursement_cash_group_id TEXT,
  full_disbursement INTEGER,
  frequency TEXT,
  tenure_count INTEGER,
  installment_amount REAL,
  outstanding_amount REAL,
  total_paid REAL,
  status TEXT,
  approval_stage TEXT,
  opened_date DATETIME,
  disbursed_at DATETIME,
  closed_at DATETIME,
  renewed_from_loan_id INTEGER,
  renewed_to_loan_id INTEGER,
  penal_interest_rate REAL,
  penal_flat_amount REAL,
  grace_period_days INTEGER,
  penal_cycle_count INTEGER,
  total_penal_interest_charged REAL,
  last_penal_applied_at DATETIME,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_personal_loans_branch_id ON personal_loans (branch_id);
CREATE INDEX IF NOT EXISTS idx_personal_loans_customer_id ON personal_loans (customer_id);
CREATE INDEX IF NOT EXISTS idx_personal_loans_created_by_employee_id ON personal_loans (created_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_personal_loans_disbursement_bank_id ON personal_loans (disbursement_bank_id);
CREATE INDEX IF NOT EXISTS idx_personal_loans_disbursement_cash_group_id ON personal_loans (disbursement_cash_group_id);
CREATE INDEX IF NOT EXISTS idx_personal_loans_renewed_from_loan_id ON personal_loans (renewed_from_loan_id);
CREATE INDEX IF NOT EXISTS idx_personal_loans_renewed_to_loan_id ON personal_loans (renewed_to_loan_id);
CREATE INDEX IF NOT EXISTS idx_personal_loans_updated_at ON personal_loans (updated_at);

CREATE TABLE IF NOT EXISTS personal_loan_installments (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  personal_loan_id INTEGER,
  sequence_no INTEGER,
  due_date DATETIME,
  amount REAL,
  status TEXT,
  paid_amount REAL,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_personal_loan_installments_personal_loan_id ON personal_loan_installments (personal_loan_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_installments_updated_at ON personal_loan_installments (updated_at);

CREATE TABLE IF NOT EXISTS personal_loan_payments (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  personal_loan_id INTEGER,
  amount REAL,
  paid_on DATETIME,
  received_by_employee_id INTEGER,
  method TEXT,
  reference TEXT,
  description TEXT,
  cash_amount REAL,
  upi_amount REAL,
  bank_transfer_amount REAL,
  cheque_amount REAL,
  bank_id INTEGER,
  needs_mode_review INTEGER,
  running_balance REAL,
  installment_id INTEGER,
  cash_transaction_group_id TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_personal_loan_id ON personal_loan_payments (personal_loan_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_received_by_employee_id ON personal_loan_payments (received_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_bank_id ON personal_loan_payments (bank_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_installment_id ON personal_loan_payments (installment_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_cash_transaction_group_id ON personal_loan_payments (cash_transaction_group_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_updated_at ON personal_loan_payments (updated_at);

CREATE TABLE IF NOT EXISTS personal_loan_history (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  personal_loan_id INTEGER,
  event TEXT,
  detail TEXT,
  amount REAL,
  related_loan_id INTEGER,
  occurred_at DATETIME,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_personal_loan_history_personal_loan_id ON personal_loan_history (personal_loan_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_history_related_loan_id ON personal_loan_history (related_loan_id);
CREATE INDEX IF NOT EXISTS idx_personal_loan_history_updated_at ON personal_loan_history (updated_at);

CREATE TABLE IF NOT EXISTS reminders (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  customer_id INTEGER,
  loan_id INTEGER,
  type TEXT,
  due_date DATETIME,
  note TEXT,
  status TEXT,
  created_by_employee_id INTEGER,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_reminders_customer_id ON reminders (customer_id);
CREATE INDEX IF NOT EXISTS idx_reminders_loan_id ON reminders (loan_id);
CREATE INDEX IF NOT EXISTS idx_reminders_created_by_employee_id ON reminders (created_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_reminders_updated_at ON reminders (updated_at);

CREATE TABLE IF NOT EXISTS day_book_entries (
  tenant_id INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY,
  branch_id INTEGER,
  entry_date DATETIME,
  particulars TEXT,
  debit REAL,
  credit REAL,
  interest REAL,
  created_by_employee_id INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_day_book_entries_branch_id ON day_book_entries (branch_id);
CREATE INDEX IF NOT EXISTS idx_day_book_entries_created_by_employee_id ON day_book_entries (created_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_day_book_entries_updated_at ON day_book_entries (updated_at);


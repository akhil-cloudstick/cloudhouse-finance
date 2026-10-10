-- +migrate Up

CREATE TABLE IF NOT EXISTS public.loan_accruals (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL,
	accrued_on timestamp with time zone NOT NULL,
	interest numeric(16,2) DEFAULT 0 NOT NULL,
	penal_interest numeric(16,2) DEFAULT 0 NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.loan_accruals ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_approvals (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL,
	stage character varying(30) NOT NULL,
	action character varying(20) NOT NULL,
	actor_employee_id bigint NOT NULL,
	actor_role character varying(40),
	remarks character varying(255),
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.loan_approvals ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_draft_ornaments (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	draft_id bigint NOT NULL,
	name character varying(80),
	purity character varying(10),
	gross_weight numeric,
	quantity bigint,
	image_url character varying(512),
	image_name character varying(255),
	"position" bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.loan_draft_ornaments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_drafts (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	created_by_employee_id bigint NOT NULL,
	branch_id bigint NOT NULL CONSTRAINT fk_loan_drafts_branch REFERENCES public.branches(id),
	customer_id bigint CONSTRAINT fk_loan_drafts_customer REFERENCES public.customers(id),
	scheme_id bigint CONSTRAINT fk_loan_drafts_scheme REFERENCES public.schemes(id),
	locker_id bigint,
	principal_override numeric(16,2),
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.loan_drafts ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_payments (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL,
	amount numeric(16,2) NOT NULL,
	type character varying(30) NOT NULL,
	paid_on timestamp with time zone NOT NULL,
	received_by_employee_id bigint,
	description character varying(255),
	method character varying(30),
	reference character varying(80),
	processing_fee_applied numeric(16,2) DEFAULT 0,
	penal_interest_applied numeric(16,2) DEFAULT 0,
	interest_applied numeric(16,2) DEFAULT 0,
	principal_applied numeric(16,2) DEFAULT 0,
	running_balance numeric(16,2) DEFAULT 0,
	processing_fee numeric(16,2) DEFAULT 0,
	created_at timestamp with time zone,
	cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	cheque_amount numeric(16,2) DEFAULT 0 NOT NULL,
	needs_mode_review boolean DEFAULT false NOT NULL,
	cash_transaction_group_id character varying(40),
	bank_id bigint CONSTRAINT fk_loan_payments_bank_ref REFERENCES public.banks(id)
);

ALTER TABLE ONLY public.loan_payments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_request_ornaments (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	request_id bigint NOT NULL,
	ornament_id bigint NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.loan_request_ornaments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_requests (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL,
	type character varying(20) NOT NULL,
	status character varying(20) NOT NULL,
	requested_by character varying(20) NOT NULL,
	detail character varying(255),
	requested_extension_months bigint,
	new_due_date timestamp with time zone,
	approval_stage character varying(30),
	payment_verified boolean,
	packet_verified boolean,
	bank_pledge_verified boolean,
	customer_confirmed boolean,
	verification_notes character varying(255),
	recorded_discount numeric(16,2) DEFAULT 0,
	recorded_payment numeric(16,2) DEFAULT 0,
	payment_due_date timestamp with time zone,
	charges numeric(16,2) DEFAULT 0,
	charges_applied numeric(16,2) DEFAULT 0,
	settlement_amount numeric(16,2) DEFAULT 0,
	remarks character varying(255),
	requested_at timestamp with time zone NOT NULL,
	decided_at timestamp with time zone,
	decided_by_employee_id bigint,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	is_partial boolean,
	customer_saw_gold boolean,
	payment_recorded boolean,
	locked boolean,
	amount numeric(16,2) DEFAULT 0
);

ALTER TABLE ONLY public.loan_requests ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_top_ups (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL,
	amount numeric(16,2) NOT NULL,
	eligible_amount_at_top_up numeric(16,2) NOT NULL,
	cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	cheque_amount numeric(16,2) DEFAULT 0 NOT NULL,
	occurred_on timestamp with time zone NOT NULL,
	received_by_employee_id bigint,
	reference character varying(80),
	status character varying(15) DEFAULT 'Active'::character varying NOT NULL,
	reversal_of_movement_id bigint,
	created_at timestamp with time zone,
	approval_stage character varying(30) DEFAULT ''::character varying,
	settle_interest character varying(10) DEFAULT ''::character varying
);

ALTER TABLE ONLY public.loan_top_ups ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loans (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_number character varying(20),
	branch_id bigint NOT NULL CONSTRAINT fk_loans_branch REFERENCES public.branches(id),
	customer_id bigint NOT NULL CONSTRAINT fk_loans_customer REFERENCES public.customers(id),
	scheme_id bigint NOT NULL CONSTRAINT fk_loans_scheme REFERENCES public.schemes(id),
	opened_date timestamp with time zone NOT NULL,
	due_date timestamp with time zone NOT NULL,
	additional_info character varying(2000),
	total_net_weight numeric,
	total_gold_value numeric(16,2) DEFAULT 0,
	eligible_loan_amount numeric(16,2) DEFAULT 0,
	principal_amount numeric(16,2) NOT NULL,
	outstanding_amount numeric(16,2) NOT NULL,
	outstanding_processing_fee numeric(16,2) DEFAULT 0,
	accrued_interest numeric(16,2) DEFAULT 0,
	interest_paid numeric(16,2) DEFAULT 0,
	accrued_penal_interest numeric(16,2) DEFAULT 0,
	penal_interest_paid numeric(16,2) DEFAULT 0,
	last_accrual_date timestamp with time zone,
	due_soon_notified_at timestamp with time zone,
	overdue_notified_at timestamp with time zone,
	status character varying(30) NOT NULL,
	approval_stage character varying(30) NOT NULL,
	bank_pledge_status character varying(20) DEFAULT 'Not Pledged'::character varying NOT NULL,
	auction_date timestamp with time zone,
	auction_amount numeric(16,2),
	indemnity_bond_document_id character varying(100),
	indemnity_bond_sign_request_id character varying(100),
	indemnity_bond_sign_status character varying(20),
	indemnity_bond_signed_url character varying(255),
	indemnity_bond_signed_at timestamp with time zone,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	scheme_code character varying(20),
	scheme_interest_rate numeric,
	scheme_duration_months bigint,
	scheme_ltv_percent numeric,
	scheme_interest_method character varying(80),
	scheme_penal_rate numeric,
	service_charge_type character varying(10),
	service_charge_value numeric(16,2) DEFAULT 0,
	service_charge_mode character varying(20),
	service_charge_amount numeric(16,2) DEFAULT 0,
	sanctioned_amount numeric(16,2) DEFAULT 0,
	disbursed_amount numeric(16,2) DEFAULT 0,
	disbursement_date timestamp with time zone,
	rejected_by_employee_id bigint,
	rejected_by_name character varying(120),
	rejected_at timestamp with time zone,
	rejection_remarks character varying(255)
);

ALTER TABLE ONLY public.loans ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ornament_images (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	ornament_id bigint NOT NULL,
	image_url character varying(255) NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.ornament_images ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ornament_purity_tests (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	ornament_id bigint NOT NULL,
	tested_purity character varying(10) NOT NULL,
	tested_gross_weight numeric NOT NULL,
	tested_deduction_weight numeric,
	tested_net_weight numeric,
	testing_remarks character varying(255),
	tested_by character varying(120) NOT NULL,
	tested_at timestamp with time zone NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.ornament_purity_tests ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ornaments (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL CONSTRAINT fk_loans_ornaments REFERENCES public.loans(id),
	name character varying(80) NOT NULL,
	purity character varying(10) NOT NULL,
	gross_weight numeric NOT NULL,
	deduction_weight numeric,
	net_weight numeric,
	quantity bigint DEFAULT 1 NOT NULL,
	gold_value numeric(16,2) DEFAULT 0,
	remarks character varying(255),
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	released_at timestamp with time zone
);

ALTER TABLE ONLY public.ornaments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.request_approvals (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	request_id bigint NOT NULL,
	stage character varying(30) NOT NULL,
	action character varying(20) NOT NULL,
	actor_employee_id bigint NOT NULL,
	remarks character varying(255),
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.request_approvals ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_loan_accruals_loan_id ON public.loan_accruals USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_loan_accruals_tenant_id ON public.loan_accruals USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_approvals_loan_id ON public.loan_approvals USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_loan_approvals_tenant_id ON public.loan_approvals USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_draft_ornaments_draft_id ON public.loan_draft_ornaments USING btree (draft_id);

CREATE INDEX IF NOT EXISTS idx_loan_draft_ornaments_tenant_id ON public.loan_draft_ornaments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_drafts_branch_id ON public.loan_drafts USING btree (branch_id);

CREATE INDEX IF NOT EXISTS idx_loan_drafts_created_by_employee_id ON public.loan_drafts USING btree (created_by_employee_id);

CREATE INDEX IF NOT EXISTS idx_loan_drafts_tenant_id ON public.loan_drafts USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_payments_cash_transaction_group_id ON public.loan_payments USING btree (cash_transaction_group_id);

CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON public.loan_payments USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_loan_payments_tenant_id ON public.loan_payments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_request_ornaments_ornament_id ON public.loan_request_ornaments USING btree (ornament_id);

CREATE INDEX IF NOT EXISTS idx_loan_request_ornaments_request_id ON public.loan_request_ornaments USING btree (request_id);

CREATE INDEX IF NOT EXISTS idx_loan_request_ornaments_tenant_id ON public.loan_request_ornaments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_requests_loan_id ON public.loan_requests USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_loan_requests_tenant_id ON public.loan_requests USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_top_ups_loan_id ON public.loan_top_ups USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_loan_top_ups_tenant_id ON public.loan_top_ups USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loans_deleted_at ON public.loans USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_loans_loan_number ON public.loans USING btree (loan_number);

CREATE INDEX IF NOT EXISTS idx_loans_tenant_id ON public.loans USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ornament_images_ornament_id ON public.ornament_images USING btree (ornament_id);

CREATE INDEX IF NOT EXISTS idx_ornament_images_tenant_id ON public.ornament_images USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ornament_purity_tests_ornament_id ON public.ornament_purity_tests USING btree (ornament_id);

CREATE INDEX IF NOT EXISTS idx_ornament_purity_tests_tenant_id ON public.ornament_purity_tests USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ornaments_loan_id ON public.ornaments USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_ornaments_tenant_id ON public.ornaments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_request_approvals_request_id ON public.request_approvals USING btree (request_id);

CREATE INDEX IF NOT EXISTS idx_request_approvals_tenant_id ON public.request_approvals USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loans_tenant_loan_number ON public.loans USING btree (tenant_id, loan_number);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_accruals' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_accruals USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_approvals' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_approvals USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_draft_ornaments' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_draft_ornaments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_drafts' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_drafts USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_payments' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_payments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_request_ornaments' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_request_ornaments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_requests' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_requests USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_top_ups' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_top_ups USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loans' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loans USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ornament_images' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.ornament_images USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ornament_purity_tests' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.ornament_purity_tests USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ornaments' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.ornaments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'request_approvals' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.request_approvals USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loan_drafts_ornaments') THEN
		ALTER TABLE ONLY public.loan_draft_ornaments
	ADD CONSTRAINT fk_loan_drafts_ornaments FOREIGN KEY (draft_id) REFERENCES public.loan_drafts(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loan_requests_loan') THEN
		ALTER TABLE ONLY public.loan_requests
	ADD CONSTRAINT fk_loan_requests_loan FOREIGN KEY (loan_id) REFERENCES public.loans(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loan_requests_ornament_selections') THEN
		ALTER TABLE ONLY public.loan_request_ornaments
	ADD CONSTRAINT fk_loan_requests_ornament_selections FOREIGN KEY (request_id) REFERENCES public.loan_requests(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loans_approvals') THEN
		ALTER TABLE ONLY public.loan_approvals
	ADD CONSTRAINT fk_loans_approvals FOREIGN KEY (loan_id) REFERENCES public.loans(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loans_payments') THEN
		ALTER TABLE ONLY public.loan_payments
	ADD CONSTRAINT fk_loans_payments FOREIGN KEY (loan_id) REFERENCES public.loans(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ornaments_images') THEN
		ALTER TABLE ONLY public.ornament_images
	ADD CONSTRAINT fk_ornaments_images FOREIGN KEY (ornament_id) REFERENCES public.ornaments(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ornaments_purity_test') THEN
		ALTER TABLE ONLY public.ornament_purity_tests
	ADD CONSTRAINT fk_ornaments_purity_test FOREIGN KEY (ornament_id) REFERENCES public.ornaments(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.request_approvals CASCADE;
DROP TABLE IF EXISTS public.ornaments CASCADE;
DROP TABLE IF EXISTS public.ornament_purity_tests CASCADE;
DROP TABLE IF EXISTS public.ornament_images CASCADE;
DROP TABLE IF EXISTS public.loans CASCADE;
DROP TABLE IF EXISTS public.loan_top_ups CASCADE;
DROP TABLE IF EXISTS public.loan_requests CASCADE;
DROP TABLE IF EXISTS public.loan_request_ornaments CASCADE;
DROP TABLE IF EXISTS public.loan_payments CASCADE;
DROP TABLE IF EXISTS public.loan_drafts CASCADE;
DROP TABLE IF EXISTS public.loan_draft_ornaments CASCADE;
DROP TABLE IF EXISTS public.loan_approvals CASCADE;
DROP TABLE IF EXISTS public.loan_accruals CASCADE;

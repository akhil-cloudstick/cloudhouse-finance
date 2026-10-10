-- +migrate Up

CREATE TABLE IF NOT EXISTS public.personal_loan_history (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	personal_loan_id bigint NOT NULL,
	event character varying(30) NOT NULL,
	detail character varying(200) NOT NULL,
	amount numeric(16,2) DEFAULT 0 NOT NULL,
	related_loan_id bigint,
	occurred_at timestamp with time zone NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.personal_loan_history ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.personal_loan_installments (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	personal_loan_id bigint NOT NULL,
	sequence_no bigint NOT NULL,
	due_date timestamp with time zone NOT NULL,
	amount numeric(16,2) NOT NULL,
	status character varying(15) DEFAULT 'Pending'::character varying NOT NULL,
	paid_amount numeric(16,2) DEFAULT 0 NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.personal_loan_installments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.personal_loan_payments (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	personal_loan_id bigint NOT NULL,
	amount numeric(16,2) NOT NULL,
	paid_on timestamp with time zone NOT NULL,
	received_by_employee_id bigint,
	method character varying(30),
	reference character varying(80),
	description character varying(255),
	running_balance numeric(16,2) NOT NULL,
	installment_id bigint,
	created_at timestamp with time zone,
	cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	cheque_amount numeric(16,2) DEFAULT 0 NOT NULL,
	needs_mode_review boolean DEFAULT false NOT NULL,
	bank_id bigint CONSTRAINT fk_personal_loan_payments_bank_ref REFERENCES public.banks(id)
);

ALTER TABLE ONLY public.personal_loan_payments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.personal_loans (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_number character varying(20),
	branch_id bigint NOT NULL CONSTRAINT fk_personal_loans_branch REFERENCES public.branches(id),
	customer_id bigint NOT NULL CONSTRAINT fk_personal_loans_customer REFERENCES public.customers(id),
	created_by_employee_id bigint,
	principal_amount numeric(16,2) NOT NULL,
	interest_type character varying(20) NOT NULL,
	interest_value numeric(16,2) NOT NULL,
	interest_amount numeric(16,2) NOT NULL,
	disbursed_amount numeric(16,2) NOT NULL,
	frequency character varying(10) NOT NULL,
	tenure_count bigint NOT NULL,
	installment_amount numeric(16,2) NOT NULL,
	outstanding_amount numeric(16,2) NOT NULL,
	total_paid numeric(16,2) DEFAULT 0 NOT NULL,
	status character varying(20) NOT NULL,
	opened_date timestamp with time zone NOT NULL,
	disbursed_at timestamp with time zone,
	closed_at timestamp with time zone,
	renewed_from_loan_id bigint,
	renewed_to_loan_id bigint,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	full_disbursement boolean DEFAULT false NOT NULL,
	penal_interest_rate numeric(16,2) DEFAULT 0 NOT NULL,
	penal_flat_amount numeric(16,2) DEFAULT 0 NOT NULL,
	total_penal_interest_charged numeric(16,2) DEFAULT 0 NOT NULL,
	grace_period_days bigint DEFAULT 0 NOT NULL,
	penal_cycle_count bigint DEFAULT 0 NOT NULL,
	last_penal_applied_at timestamp with time zone,
	approval_stage character varying(30) DEFAULT ''::character varying,
	disbursement_cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	disbursement_upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	disbursement_bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	disbursement_cheque_amount numeric(16,2) DEFAULT 0 NOT NULL,
	disbursement_bank_id bigint
);

ALTER TABLE ONLY public.personal_loans ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_personal_loan_history_personal_loan_id ON public.personal_loan_history USING btree (personal_loan_id);

CREATE INDEX IF NOT EXISTS idx_personal_loan_history_tenant_id ON public.personal_loan_history USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_personal_loan_installments_personal_loan_id ON public.personal_loan_installments USING btree (personal_loan_id);

CREATE INDEX IF NOT EXISTS idx_personal_loan_installments_tenant_id ON public.personal_loan_installments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_personal_loan_id ON public.personal_loan_payments USING btree (personal_loan_id);

CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_tenant_id ON public.personal_loan_payments USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_personal_loans_deleted_at ON public.personal_loans USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_personal_loans_loan_number ON public.personal_loans USING btree (loan_number);

CREATE INDEX IF NOT EXISTS idx_personal_loans_tenant_id ON public.personal_loans USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_loans_tenant_loan_number ON public.personal_loans USING btree (tenant_id, loan_number);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'personal_loan_history' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.personal_loan_history USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'personal_loan_installments' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.personal_loan_installments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'personal_loan_payments' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.personal_loan_payments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'personal_loans' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.personal_loans USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_personal_loans_installments') THEN
		ALTER TABLE ONLY public.personal_loan_installments
	ADD CONSTRAINT fk_personal_loans_installments FOREIGN KEY (personal_loan_id) REFERENCES public.personal_loans(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_personal_loans_payments') THEN
		ALTER TABLE ONLY public.personal_loan_payments
	ADD CONSTRAINT fk_personal_loans_payments FOREIGN KEY (personal_loan_id) REFERENCES public.personal_loans(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.personal_loans CASCADE;
DROP TABLE IF EXISTS public.personal_loan_payments CASCADE;
DROP TABLE IF EXISTS public.personal_loan_installments CASCADE;
DROP TABLE IF EXISTS public.personal_loan_history CASCADE;

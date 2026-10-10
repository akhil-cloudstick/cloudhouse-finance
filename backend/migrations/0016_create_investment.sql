-- +migrate Up

CREATE TABLE IF NOT EXISTS public.investment_payouts (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	investment_id bigint NOT NULL,
	sequence_no bigint NOT NULL,
	due_date timestamp with time zone NOT NULL,
	amount numeric(16,2) NOT NULL,
	is_principal_return boolean DEFAULT false NOT NULL,
	status character varying(15) DEFAULT 'Pending'::character varying NOT NULL,
	paid_at timestamp with time zone,
	paid_by_employee_id bigint,
	cash_movement_id bigint,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	cheque_amount numeric(16,2) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.investment_payouts ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.investment_plans (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	name character varying(120) NOT NULL,
	interest_rate_type character varying(10) NOT NULL,
	interest_rate_percent numeric(6,3) NOT NULL,
	payout_frequency character varying(10) NOT NULL,
	tenure_months bigint NOT NULL,
	min_principal numeric(16,2) DEFAULT 0 NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	engine character varying(10) DEFAULT 'Schedule'::character varying NOT NULL,
	product_type character varying(10) DEFAULT 'Deposit'::character varying NOT NULL
);

ALTER TABLE ONLY public.investment_plans ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.investment_transactions (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	investment_id bigint NOT NULL,
	type character varying(12) NOT NULL,
	amount numeric(16,2) NOT NULL,
	principal_amount numeric(16,2) DEFAULT 0 NOT NULL,
	interest_amount numeric(16,2) DEFAULT 0 NOT NULL,
	cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	cheque_amount numeric(16,2) DEFAULT 0 NOT NULL,
	principal_before numeric(16,2) NOT NULL,
	principal_after numeric(16,2) NOT NULL,
	interest_before numeric(16,2) NOT NULL,
	interest_after numeric(16,2) NOT NULL,
	occurred_on timestamp with time zone NOT NULL,
	recorded_by_employee_id bigint,
	reference character varying(80),
	cash_movement_id bigint,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.investment_transactions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.investments (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	investment_number character varying(20),
	branch_id bigint NOT NULL CONSTRAINT fk_investments_branch REFERENCES public.branches(id),
	customer_id bigint NOT NULL CONSTRAINT fk_investments_customer REFERENCES public.customers(id),
	plan_id bigint NOT NULL CONSTRAINT fk_investments_plan REFERENCES public.investment_plans(id),
	created_by_employee_id bigint,
	principal_amount numeric(16,2) NOT NULL,
	interest_rate_type character varying(10) NOT NULL,
	interest_rate_percent numeric(6,3) NOT NULL,
	payout_frequency character varying(10) NOT NULL,
	tenure_months bigint NOT NULL,
	start_date timestamp with time zone NOT NULL,
	maturity_date timestamp with time zone NOT NULL,
	status character varying(20) NOT NULL,
	total_interest_paid numeric(16,2) DEFAULT 0 NOT NULL,
	closed_at timestamp with time zone,
	renewed_from_investment_id bigint,
	renewed_to_investment_id bigint,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	engine character varying(10) DEFAULT 'Schedule'::character varying NOT NULL,
	outstanding_principal numeric(16,2) DEFAULT 0 NOT NULL,
	accrued_interest numeric(16,2) DEFAULT 0 NOT NULL,
	interest_withdrawn numeric(16,2) DEFAULT 0 NOT NULL,
	last_accrual_date timestamp with time zone
);

ALTER TABLE ONLY public.investments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_investment_payouts_investment_id ON public.investment_payouts USING btree (investment_id);

CREATE INDEX IF NOT EXISTS idx_investment_payouts_tenant_id ON public.investment_payouts USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_investment_plans_deleted_at ON public.investment_plans USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_investment_plans_tenant_id ON public.investment_plans USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_investment_id ON public.investment_transactions USING btree (investment_id);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_tenant_id ON public.investment_transactions USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_investments_deleted_at ON public.investments USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_investments_investment_number ON public.investments USING btree (investment_number);

CREATE INDEX IF NOT EXISTS idx_investments_tenant_id ON public.investments USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_investments_tenant_investment_number ON public.investments USING btree (tenant_id, investment_number);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'investment_payouts' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.investment_payouts USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'investment_plans' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.investment_plans USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'investment_transactions' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.investment_transactions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'investments' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.investments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_investments_payouts') THEN
		ALTER TABLE ONLY public.investment_payouts
	ADD CONSTRAINT fk_investments_payouts FOREIGN KEY (investment_id) REFERENCES public.investments(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_investments_transactions') THEN
		ALTER TABLE ONLY public.investment_transactions
	ADD CONSTRAINT fk_investments_transactions FOREIGN KEY (investment_id) REFERENCES public.investments(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.investments CASCADE;
DROP TABLE IF EXISTS public.investment_transactions CASCADE;
DROP TABLE IF EXISTS public.investment_plans CASCADE;
DROP TABLE IF EXISTS public.investment_payouts CASCADE;

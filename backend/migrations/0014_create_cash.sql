-- +migrate Up

CREATE TABLE IF NOT EXISTS public.cash_movements (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	type character varying(10) NOT NULL,
	source character varying(60),
	purpose character varying(120),
	mode character varying(20),
	bank character varying(120),
	amount numeric(16,2) NOT NULL,
	status character varying(20),
	branch_id bigint NOT NULL CONSTRAINT fk_cash_movements_branch REFERENCES public.branches(id),
	occurred_on timestamp with time zone NOT NULL,
	created_at timestamp with time zone,
	transaction_group_id character varying(40),
	bank_id bigint CONSTRAINT fk_cash_movements_bank_ref REFERENCES public.banks(id),
	party_customer_id bigint CONSTRAINT fk_cash_movements_party_customer REFERENCES public.customers(id),
	to_bank_id bigint CONSTRAINT fk_cash_movements_to_bank_ref REFERENCES public.banks(id),
	counter_bank_id bigint CONSTRAINT fk_cash_movements_counter_bank_ref REFERENCES public.banks(id),
	expense_id bigint,
	receipt_image text
);

ALTER TABLE ONLY public.cash_movements ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cash_sources (
	id bigserial PRIMARY KEY,
	tenant_id bigint NOT NULL,
	name character varying(60) NOT NULL,
	bank_id bigint,
	loan_number character varying(60),
	principal_amount numeric(16,2),
	loan_opened_at timestamp with time zone,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.cash_sources ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.categories (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	type character varying(20) DEFAULT 'cash_in'::character varying NOT NULL,
	name character varying(80) NOT NULL,
	is_common boolean DEFAULT false NOT NULL,
	bank_id bigint CONSTRAINT fk_categories_bank REFERENCES public.banks(id),
	loan_number character varying(60),
	principal_amount numeric(16,2),
	loan_opened_at timestamp with time zone,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.categories ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.expense_categories (
	id bigserial PRIMARY KEY,
	tenant_id bigint NOT NULL,
	name character varying(80) NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.expense_categories ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.expenses (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	occurred_on timestamp with time zone NOT NULL,
	category character varying(80) NOT NULL,
	amount numeric(16,2) NOT NULL,
	mode character varying(20) NOT NULL,
	payee character varying(120) NOT NULL,
	branch_id bigint NOT NULL CONSTRAINT fk_expenses_branch REFERENCES public.branches(id),
	status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
	remarks character varying(500),
	approved_by character varying(120),
	approved_at timestamp with time zone,
	receipt_image text,
	created_at timestamp with time zone,
	from_bank_id bigint CONSTRAINT fk_expenses_from_bank REFERENCES public.banks(id),
	to_bank_id bigint CONSTRAINT fk_expenses_to_bank REFERENCES public.banks(id),
	approval_stage character varying(40),
	cash_movement_id bigint
);

ALTER TABLE ONLY public.expenses ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.gold_sales (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	ornament_type character varying(80) NOT NULL,
	sold_amount numeric(16,2) NOT NULL,
	cost_amount numeric(16,2) NOT NULL,
	profit numeric(16,2) NOT NULL,
	sold_on timestamp with time zone NOT NULL,
	branch_id bigint NOT NULL CONSTRAINT fk_gold_sales_branch REFERENCES public.branches(id),
	cash_movement_id bigint CONSTRAINT fk_gold_sales_cash_movement REFERENCES public.cash_movements(id),
	cost_cash_movement_id bigint CONSTRAINT fk_gold_sales_cost_cash_movement REFERENCES public.cash_movements(id),
	remarks character varying(500),
	created_at timestamp with time zone,
	mode character varying(20) DEFAULT 'Cash'::character varying NOT NULL,
	bank_id bigint CONSTRAINT fk_gold_sales_bank_ref REFERENCES public.banks(id),
	receipt_image text
);

ALTER TABLE ONLY public.gold_sales ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loan_cash_sources (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	cash_movement_id bigint NOT NULL,
	bank_id bigint NOT NULL CONSTRAINT fk_loan_cash_sources_bank REFERENCES public.banks(id),
	loan_number character varying(60) NOT NULL,
	principal_amount numeric(16,2) NOT NULL,
	interest_rate numeric(6,2),
	duration_months bigint,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.loan_cash_sources ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.opening_cash_balances (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	branch_id bigint NOT NULL CONSTRAINT fk_opening_cash_balances_branch REFERENCES public.branches(id),
	balance_date timestamp with time zone NOT NULL,
	amount numeric(16,2) NOT NULL,
	created_at timestamp with time zone,
	mode character varying(20) DEFAULT 'Cash'::character varying NOT NULL,
	bank_id bigint CONSTRAINT fk_opening_cash_balances_bank REFERENCES public.banks(id),
	from_bank_id bigint CONSTRAINT fk_opening_cash_balances_from_bank REFERENCES public.banks(id)
);

ALTER TABLE ONLY public.opening_cash_balances ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cash_movements_tenant_id ON public.cash_movements USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_cash_movements_transaction_group_id ON public.cash_movements USING btree (transaction_group_id);

CREATE INDEX IF NOT EXISTS idx_cash_sources_name ON public.cash_sources USING btree (name);

CREATE INDEX IF NOT EXISTS idx_categories_name ON public.categories USING btree (name);

CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON public.categories USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_categories_type ON public.categories USING btree (type);

CREATE INDEX IF NOT EXISTS idx_expense_categories_name ON public.expense_categories USING btree (name);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id ON public.expenses USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gold_sales_tenant_id ON public.gold_sales USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_loan_cash_sources_cash_movement_id ON public.loan_cash_sources USING btree (cash_movement_id);

CREATE INDEX IF NOT EXISTS idx_loan_cash_sources_tenant_id ON public.loan_cash_sources USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_balance_date ON public.opening_cash_balances USING btree (balance_date);

CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_branch_id ON public.opening_cash_balances USING btree (branch_id);

CREATE INDEX IF NOT EXISTS idx_opening_cash_balances_tenant_id ON public.opening_cash_balances USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_branch_date_mode_bank ON public.opening_cash_balances USING btree (branch_id, balance_date, mode, COALESCE(bank_id, (0)::bigint));

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_movements' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.cash_movements USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_sources' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.cash_sources USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'categories' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.categories USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'expense_categories' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.expense_categories USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'expenses' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.expenses USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gold_sales' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.gold_sales USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_cash_sources' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.loan_cash_sources USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'opening_cash_balances' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.opening_cash_balances USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.opening_cash_balances CASCADE;
DROP TABLE IF EXISTS public.loan_cash_sources CASCADE;
DROP TABLE IF EXISTS public.gold_sales CASCADE;
DROP TABLE IF EXISTS public.expenses CASCADE;
DROP TABLE IF EXISTS public.expense_categories CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.cash_sources CASCADE;
DROP TABLE IF EXISTS public.cash_movements CASCADE;

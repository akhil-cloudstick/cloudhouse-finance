-- +migrate Up

CREATE TABLE IF NOT EXISTS public.banks (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	name character varying(120) NOT NULL,
	branch character varying(120),
	ifsc character varying(20),
	account_no character varying(40),
	phone character varying(20),
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	branch_id bigint NOT NULL CONSTRAINT fk_banks_business_branch REFERENCES public.branches(id)
);

ALTER TABLE ONLY public.banks ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.gold_rates (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	date timestamp with time zone NOT NULL,
	k24 numeric NOT NULL,
	k22 numeric DEFAULT 0 NOT NULL,
	k18 numeric DEFAULT 0 NOT NULL,
	set_by character varying(120) NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.gold_rates ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ornament_types (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	name text NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.ornament_types ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.purity_standards (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	karat bigint,
	fineness_percent numeric,
	label character varying(40) NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.purity_standards ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.schemes (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	branch_id bigint NOT NULL CONSTRAINT fk_schemes_branch REFERENCES public.branches(id),
	code character varying(20),
	name character varying(120) NOT NULL,
	interest_rate numeric NOT NULL,
	duration_months bigint NOT NULL,
	ltv_percent numeric NOT NULL,
	interest_method character varying(80),
	penal_rate numeric,
	conditions text,
	is_active boolean DEFAULT false,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	service_charge_type character varying(10) DEFAULT 'None'::character varying NOT NULL,
	service_charge_value numeric(16,2) DEFAULT 0,
	service_charge_mode character varying(20),
	rate_tiers text,
	minimum_days bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.schemes ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_banks_branch_id ON public.banks USING btree (branch_id);

CREATE INDEX IF NOT EXISTS idx_banks_name ON public.banks USING btree (name);

CREATE INDEX IF NOT EXISTS idx_banks_tenant_id ON public.banks USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gold_rates_date ON public.gold_rates USING btree (date);

CREATE INDEX IF NOT EXISTS idx_gold_rates_tenant_id ON public.gold_rates USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ornament_types_name ON public.ornament_types USING btree (name);

CREATE INDEX IF NOT EXISTS idx_ornament_types_tenant_id ON public.ornament_types USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_purity_standards_tenant_id ON public.purity_standards USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_schemes_code ON public.schemes USING btree (code);

CREATE INDEX IF NOT EXISTS idx_schemes_deleted_at ON public.schemes USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_schemes_tenant_id ON public.schemes USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_banks_tenant_name ON public.banks USING btree (tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ornament_types_tenant_name ON public.ornament_types USING btree (tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_schemes_tenant_code ON public.schemes USING btree (tenant_id, code);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'banks' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.banks USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gold_rates' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.gold_rates USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ornament_types' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.ornament_types USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'purity_standards' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.purity_standards USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'schemes' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.schemes USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.schemes CASCADE;
DROP TABLE IF EXISTS public.purity_standards CASCADE;
DROP TABLE IF EXISTS public.ornament_types CASCADE;
DROP TABLE IF EXISTS public.gold_rates CASCADE;
DROP TABLE IF EXISTS public.banks CASCADE;

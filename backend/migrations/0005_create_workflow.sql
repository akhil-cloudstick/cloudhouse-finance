-- +migrate Up

CREATE TABLE IF NOT EXISTS public.approval_actions (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	flow character varying(40) NOT NULL,
	entity_id bigint NOT NULL,
	stage character varying(40),
	action character varying(20),
	actor_employee_id bigint,
	actor_role character varying(60),
	remarks text,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.approval_actions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.approval_category_modes (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	category character varying(40) NOT NULL,
	shared boolean,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.approval_category_modes ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.approval_chains (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	scope character varying(60) NOT NULL,
	role_ids character varying(500),
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.approval_chains ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.approval_limits (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	role character varying(40) NOT NULL,
	max_amount numeric NOT NULL,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.approval_limits ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.approval_stage_settings (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	flow character varying(40) NOT NULL,
	stage character varying(40) NOT NULL,
	enabled boolean,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.approval_stage_settings ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_approval_actions_entity ON public.approval_actions USING btree (flow, entity_id);

CREATE INDEX IF NOT EXISTS idx_approval_actions_tenant_id ON public.approval_actions USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_category_modes_category ON public.approval_category_modes USING btree (category);

CREATE INDEX IF NOT EXISTS idx_approval_category_modes_tenant_id ON public.approval_category_modes USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_chains_scope ON public.approval_chains USING btree (scope);

CREATE INDEX IF NOT EXISTS idx_approval_chains_tenant_id ON public.approval_chains USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_limits_role ON public.approval_limits USING btree (role);

CREATE INDEX IF NOT EXISTS idx_approval_limits_tenant_id ON public.approval_limits USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_stage_settings_flow_stage ON public.approval_stage_settings USING btree (flow, stage);

CREATE INDEX IF NOT EXISTS idx_approval_stage_settings_tenant_id ON public.approval_stage_settings USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_category_modes_tenant_category ON public.approval_category_modes USING btree (tenant_id, category);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_chains_tenant_scope ON public.approval_chains USING btree (tenant_id, scope);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_limits_tenant_role ON public.approval_limits USING btree (tenant_id, role);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_stage_settings_tenant_flow_stage ON public.approval_stage_settings USING btree (tenant_id, flow, stage);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_actions' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.approval_actions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_category_modes' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.approval_category_modes USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_chains' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.approval_chains USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_limits' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.approval_limits USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_stage_settings' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.approval_stage_settings USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.approval_stage_settings CASCADE;
DROP TABLE IF EXISTS public.approval_limits CASCADE;
DROP TABLE IF EXISTS public.approval_chains CASCADE;
DROP TABLE IF EXISTS public.approval_category_modes CASCADE;
DROP TABLE IF EXISTS public.approval_actions CASCADE;

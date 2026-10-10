-- +migrate Up

CREATE TABLE IF NOT EXISTS public.branches (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	name character varying(120) NOT NULL,
	code character varying(20),
	address character varying(255) NOT NULL,
	phone character varying(20),
	is_active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.branches ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_branches_code ON public.branches USING btree (code);

CREATE INDEX IF NOT EXISTS idx_branches_deleted_at ON public.branches USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_branches_name ON public.branches USING btree (name);

CREATE INDEX IF NOT EXISTS idx_branches_tenant_id ON public.branches USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_tenant_code ON public.branches USING btree (tenant_id, code) WHERE ((code)::text <> ''::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_tenant_name ON public.branches USING btree (tenant_id, name);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.branches USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.branches CASCADE;

-- +migrate Up

CREATE TABLE IF NOT EXISTS public.permissions (
	id bigserial PRIMARY KEY,
	name character varying(120) NOT NULL,
	description text,
	module_name character varying(80) NOT NULL,
	is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	role_id bigint NOT NULL,
	permission_id bigint NOT NULL,
	permission boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.role_permissions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.roles (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	name character varying(60) NOT NULL,
	description text,
	is_active boolean DEFAULT true NOT NULL,
	is_system boolean DEFAULT false NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.roles ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_permissions_module_name ON public.permissions USING btree (module_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_name ON public.permissions USING btree (name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permission ON public.role_permissions USING btree (role_id, permission_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON public.role_permissions USING btree (permission_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON public.role_permissions USING btree (role_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_tenant_id ON public.role_permissions USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_roles_name ON public.roles USING btree (name);

CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON public.roles USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_name ON public.roles USING btree (tenant_id, name);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_permissions' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.role_permissions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roles' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.roles USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.roles CASCADE;
DROP TABLE IF EXISTS public.role_permissions CASCADE;
DROP TABLE IF EXISTS public.permissions CASCADE;

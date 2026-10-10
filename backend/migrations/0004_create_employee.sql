-- +migrate Up

CREATE TABLE IF NOT EXISTS public.employees (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	code character varying(20),
	name character varying(120) NOT NULL,
	role character varying(60) NOT NULL,
	role_id bigint,
	branch_id bigint NOT NULL CONSTRAINT fk_employees_branch REFERENCES public.branches(id),
	phone character varying(20),
	loans_processed bigint,
	collections numeric,
	followups bigint,
	pending bigint,
	username character varying(60),
	email character varying(120),
	password_hash character varying(255),
	password_reset_token_hash character varying(64),
	password_reset_expires_at timestamp with time zone,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	password_reset_attempts bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.employees ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_employees_code ON public.employees USING btree (code);

CREATE INDEX IF NOT EXISTS idx_employees_deleted_at ON public.employees USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_employees_email ON public.employees USING btree (email);

CREATE INDEX IF NOT EXISTS idx_employees_phone ON public.employees USING btree (phone);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_id ON public.employees USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_employees_username ON public.employees USING btree (username);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_code ON public.employees USING btree (tenant_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_email ON public.employees USING btree (tenant_id, email) WHERE ((email)::text <> ''::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_phone ON public.employees USING btree (tenant_id, phone) WHERE ((phone)::text <> ''::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_username ON public.employees USING btree (tenant_id, username) WHERE ((username)::text <> ''::text);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'employees' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.employees USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.employees CASCADE;

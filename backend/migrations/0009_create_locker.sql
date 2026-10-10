-- +migrate Up

CREATE TABLE IF NOT EXISTS public.lockers (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	code character varying(20),
	branch_id bigint NOT NULL CONSTRAINT fk_lockers_branch REFERENCES public.branches(id),
	capacity bigint NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.lockers ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_lockers_code ON public.lockers USING btree (code);

CREATE INDEX IF NOT EXISTS idx_lockers_deleted_at ON public.lockers USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_lockers_tenant_id ON public.lockers USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lockers_tenant_code ON public.lockers USING btree (tenant_id, code);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lockers' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.lockers USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.lockers CASCADE;

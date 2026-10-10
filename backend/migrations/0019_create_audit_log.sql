-- +migrate Up

CREATE TABLE IF NOT EXISTS public.audit_log_entries (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	actor_employee_id bigint NOT NULL,
	actor_name character varying(120) NOT NULL,
	action character varying(60) NOT NULL,
	entity_type character varying(40) NOT NULL,
	entity_id bigint NOT NULL,
	entity_name character varying(160),
	detail text,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.audit_log_entries ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_log_entries_action ON public.audit_log_entries USING btree (action);

CREATE INDEX IF NOT EXISTS idx_audit_log_entries_actor_employee_id ON public.audit_log_entries USING btree (actor_employee_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_entries_entity_id ON public.audit_log_entries USING btree (entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_entries_tenant_id ON public.audit_log_entries USING btree (tenant_id);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log_entries' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.audit_log_entries USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.audit_log_entries CASCADE;

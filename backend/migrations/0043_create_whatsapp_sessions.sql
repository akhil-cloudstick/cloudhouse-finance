-- +migrate Up

-- one OpenWA session per business; the session is created and driven by the
-- business itself from Settings > Integrations > WhatsApp
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	openwa_session_id character varying(80) NOT NULL,
	phone character varying(30) DEFAULT ''::character varying NOT NULL,
	status character varying(20) DEFAULT 'created'::character varying NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.whatsapp_sessions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_sessions_tenant_id ON public.whatsapp_sessions USING btree (tenant_id);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_sessions' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.whatsapp_sessions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.whatsapp_sessions CASCADE;

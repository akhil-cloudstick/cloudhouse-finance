-- +migrate Up

CREATE TABLE IF NOT EXISTS public.communication_logs (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	recipient_name character varying(120),
	recipient_phone character varying(20),
	chat_id character varying(32),
	channel character varying(20) NOT NULL,
	trigger_type character varying(30) NOT NULL,
	message_body text,
	related_entity_type character varying(30),
	related_entity_id bigint,
	status character varying(10) NOT NULL,
	error_message character varying(500),
	triggered_by_employee_id bigint,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.communication_logs ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notifications (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	customer_id bigint NOT NULL,
	type character varying(40) NOT NULL,
	title character varying(120),
	body text,
	related_entity_type character varying(30),
	related_entity_id bigint,
	delivered boolean DEFAULT false NOT NULL,
	delivered_at timestamp with time zone,
	attempts bigint DEFAULT 0 NOT NULL,
	last_attempt_at timestamp with time zone,
	read boolean DEFAULT false NOT NULL,
	read_at timestamp with time zone,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.notifications ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_communication_logs_channel ON public.communication_logs USING btree (channel);

CREATE INDEX IF NOT EXISTS idx_communication_logs_created_at ON public.communication_logs USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_communication_logs_recipient_phone ON public.communication_logs USING btree (recipient_phone);

CREATE INDEX IF NOT EXISTS idx_communication_logs_related_entity_id ON public.communication_logs USING btree (related_entity_id);

CREATE INDEX IF NOT EXISTS idx_communication_logs_related_entity_type ON public.communication_logs USING btree (related_entity_type);

CREATE INDEX IF NOT EXISTS idx_communication_logs_tenant_id ON public.communication_logs USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_communication_logs_trigger_type ON public.communication_logs USING btree (trigger_type);

CREATE INDEX IF NOT EXISTS idx_communication_logs_triggered_by_employee_id ON public.communication_logs USING btree (triggered_by_employee_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_customer_id ON public.notifications USING btree (customer_id);

CREATE INDEX IF NOT EXISTS idx_notifications_delivered ON public.notifications USING btree (delivered);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications USING btree (read);

CREATE INDEX IF NOT EXISTS idx_notifications_related_entity_id ON public.notifications USING btree (related_entity_id);

CREATE INDEX IF NOT EXISTS idx_notifications_related_entity_type ON public.notifications USING btree (related_entity_type);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON public.notifications USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications USING btree (type);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'communication_logs' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.communication_logs USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.notifications USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.communication_logs CASCADE;

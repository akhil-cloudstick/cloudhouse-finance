-- +migrate Up

-- A PC that runs the desktop exe. It is registered on the first online sign-in and from then on proves
-- itself by signing the entries it replays from its outbox. An admin can switch a PC off here.
CREATE TABLE IF NOT EXISTS public.devices (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	name character varying(120) NOT NULL,
	machine_id character varying(120) NOT NULL,
	branch_id bigint,
	secret_encrypted text NOT NULL,
	enabled boolean NOT NULL DEFAULT true,
	registered_by_employee_id bigint,
	last_seen_at timestamp with time zone,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS devices_tenant_machine_idx ON public.devices (tenant_id, machine_id);

ALTER TABLE ONLY public.devices ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'devices' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.devices USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.devices CASCADE;

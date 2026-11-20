-- +migrate Up

-- Offline mode: records created on a PC with no connection are addressed by a UUID the PC generates,
-- so later entries can point at a loan or customer that has no server number yet.
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS uuid uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS loans_tenant_uuid_idx ON public.loans (tenant_id, uuid);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS uuid uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_uuid_idx ON public.customers (tenant_id, uuid);

-- One row per offline entry the server has accepted. A resend of the same client_uuid replays the stored
-- reply instead of running the action twice.
CREATE TABLE IF NOT EXISTS public.sync_receipts (
	tenant_id bigint NOT NULL,
	client_uuid uuid NOT NULL,
	method character varying(10) NOT NULL,
	path character varying(255) NOT NULL,
	status integer,
	response text,
	claimed_at timestamp with time zone NOT NULL DEFAULT now(),
	completed_at timestamp with time zone,
	PRIMARY KEY (tenant_id, client_uuid)
);

ALTER TABLE ONLY public.sync_receipts ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- When an offline create is merged into a record that already exists (same phone, PAN or Aadhaar), later
-- entries still point at the UUID the PC invented; this maps that UUID onto the existing record.
CREATE TABLE IF NOT EXISTS public.sync_aliases (
	tenant_id bigint NOT NULL,
	client_uuid uuid NOT NULL,
	entity character varying(40) NOT NULL,
	entity_id bigint NOT NULL,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY (tenant_id, client_uuid)
);

ALTER TABLE ONLY public.sync_aliases ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Offline entries are recorded, not refused. Anything a manager should look at (cash that went negative,
-- the same customer created on two PCs) is written here and shown in the web admin.
CREATE TABLE IF NOT EXISTS public.sync_flags (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	kind character varying(40) NOT NULL,
	branch_id bigint,
	entity character varying(40),
	entity_id bigint,
	client_uuid uuid,
	message character varying(500) NOT NULL,
	occurred_at timestamp with time zone,
	resolved_at timestamp with time zone,
	resolved_by_employee_id bigint,
	created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_flags_open_idx ON public.sync_flags (tenant_id, branch_id) WHERE resolved_at IS NULL;

ALTER TABLE ONLY public.sync_flags ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sync_receipts' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.sync_receipts USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sync_aliases' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.sync_aliases USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sync_flags' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.sync_flags USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.sync_flags CASCADE;
DROP TABLE IF EXISTS public.sync_aliases CASCADE;
DROP TABLE IF EXISTS public.sync_receipts CASCADE;
DROP INDEX IF EXISTS public.customers_tenant_uuid_idx;
ALTER TABLE public.customers DROP COLUMN IF EXISTS uuid;
DROP INDEX IF EXISTS public.loans_tenant_uuid_idx;
ALTER TABLE public.loans DROP COLUMN IF EXISTS uuid;

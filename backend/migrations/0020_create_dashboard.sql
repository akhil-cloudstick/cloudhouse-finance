-- +migrate Up

CREATE TABLE IF NOT EXISTS public.dashboard_snapshots (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	date timestamp with time zone NOT NULL,
	active_count bigint,
	overdue_count bigint,
	pending_approval_count bigint,
	opened_today_count bigint,
	due_today_count bigint,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.dashboard_snapshots ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_date ON public.dashboard_snapshots USING btree (date);

CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_tenant_id ON public.dashboard_snapshots USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_snapshots_tenant_date ON public.dashboard_snapshots USING btree (tenant_id, date);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dashboard_snapshots' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.dashboard_snapshots USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.dashboard_snapshots CASCADE;

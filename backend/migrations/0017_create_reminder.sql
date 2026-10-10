-- +migrate Up

CREATE TABLE IF NOT EXISTS public.reminders (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	customer_id bigint NOT NULL CONSTRAINT fk_reminders_customer REFERENCES public.customers(id),
	loan_id bigint,
	type character varying(20) NOT NULL,
	due_date timestamp with time zone NOT NULL,
	note character varying(255),
	status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
	created_by_employee_id bigint NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.reminders ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reminders_customer_id ON public.reminders USING btree (customer_id);

CREATE INDEX IF NOT EXISTS idx_reminders_deleted_at ON public.reminders USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON public.reminders USING btree (due_date);

CREATE INDEX IF NOT EXISTS idx_reminders_loan_id ON public.reminders USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_id ON public.reminders USING btree (tenant_id);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reminders' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.reminders USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.reminders CASCADE;

-- +migrate Up

CREATE TABLE IF NOT EXISTS public.bank_pledge_events (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	bank_pledge_record_id bigint NOT NULL,
	action character varying(20) NOT NULL,
	actor_employee_id bigint,
	actor_role character varying(40),
	amount numeric(16,2) DEFAULT 0,
	remarks character varying(255),
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.bank_pledge_events ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bank_pledge_records (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL CONSTRAINT fk_loans_pledges REFERENCES public.loans(id),
	bank_id bigint,
	bank_name character varying(120) NOT NULL,
	pledged_amount numeric(16,2) NOT NULL,
	pledge_date timestamp with time zone NOT NULL,
	release_date timestamp with time zone,
	bank_pledge_due_date timestamp with time zone,
	pledged_gross_weight numeric,
	pledged_net_weight numeric,
	bank_interest_rate numeric,
	reference_number character varying(60),
	cash_movement_id bigint,
	expense_id bigint,
	release_cash_movement_id bigint,
	release_expense_id bigint,
	cash_treatment character varying(20) DEFAULT 'CashIn'::character varying NOT NULL,
	status character varying(20) DEFAULT 'Active'::character varying NOT NULL,
	voided_at timestamp with time zone,
	void_reason character varying(255),
	void_cash_movement_id bigint,
	created_at timestamp with time zone,
	cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	cheque_amount numeric(16,2) DEFAULT 0 NOT NULL,
	release_cash_amount numeric(16,2) DEFAULT 0 NOT NULL,
	release_upi_amount numeric(16,2) DEFAULT 0 NOT NULL,
	release_bank_transfer_amount numeric(16,2) DEFAULT 0 NOT NULL,
	release_cheque_amount numeric(16,2) DEFAULT 0 NOT NULL,
	received_bank_id bigint
);

ALTER TABLE ONLY public.bank_pledge_records ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bank_pledge_events_bank_pledge_record_id ON public.bank_pledge_events USING btree (bank_pledge_record_id);

CREATE INDEX IF NOT EXISTS idx_bank_pledge_events_tenant_id ON public.bank_pledge_events USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_loan_id ON public.bank_pledge_records USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_bank_pledge_records_tenant_id ON public.bank_pledge_records USING btree (tenant_id);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bank_pledge_events' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.bank_pledge_events USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bank_pledge_records' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.bank_pledge_records USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bank_pledge_records_events') THEN
		ALTER TABLE ONLY public.bank_pledge_events
	ADD CONSTRAINT fk_bank_pledge_records_events FOREIGN KEY (bank_pledge_record_id) REFERENCES public.bank_pledge_records(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.bank_pledge_records CASCADE;
DROP TABLE IF EXISTS public.bank_pledge_events CASCADE;

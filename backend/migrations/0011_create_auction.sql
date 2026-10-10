-- +migrate Up

CREATE TABLE IF NOT EXISTS public.auction_decision_requests (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	auction_record_id bigint NOT NULL,
	loan_id bigint NOT NULL,
	kind character varying(20) NOT NULL,
	triggered_by_payment_id bigint,
	amount_paid numeric(16,2) DEFAULT 0,
	outstanding_at_request numeric(16,2) DEFAULT 0,
	status character varying(24) DEFAULT 'Pending'::character varying NOT NULL,
	decided_by_employee_id bigint,
	decided_by_role character varying(40),
	decision_remarks character varying(255),
	decided_at timestamp with time zone,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.auction_decision_requests ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.auction_events (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	auction_record_id bigint NOT NULL,
	action character varying(30) NOT NULL,
	actor_employee_id bigint,
	actor_role character varying(40),
	remarks character varying(255),
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.auction_events ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.auction_notices (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	auction_record_id bigint NOT NULL,
	issued_at timestamp with time zone NOT NULL,
	method character varying(40),
	remarks character varying(255),
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.auction_notices ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.auction_records (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	loan_id bigint NOT NULL,
	stage character varying(20) NOT NULL,
	auction_eligible_date timestamp with time zone NOT NULL,
	auction_date timestamp with time zone,
	auction_reference_number character varying(60),
	sale_amount numeric(16,2) DEFAULT 0,
	auction_expenses numeric(16,2) DEFAULT 0,
	surplus_shortfall numeric(16,2) DEFAULT 0,
	final_settlement_status character varying(24) DEFAULT 'Pending'::character varying NOT NULL,
	surplus_payable_amount numeric(16,2) DEFAULT 0,
	surplus_disposition character varying(24),
	surplus_paid_out_movement_id bigint,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.auction_records ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_auction_record_id ON public.auction_decision_requests USING btree (auction_record_id);

CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_loan_id ON public.auction_decision_requests USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_auction_decision_requests_tenant_id ON public.auction_decision_requests USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_auction_events_auction_record_id ON public.auction_events USING btree (auction_record_id);

CREATE INDEX IF NOT EXISTS idx_auction_events_tenant_id ON public.auction_events USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_auction_notices_auction_record_id ON public.auction_notices USING btree (auction_record_id);

CREATE INDEX IF NOT EXISTS idx_auction_notices_tenant_id ON public.auction_notices USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_auction_records_loan_id ON public.auction_records USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_auction_records_tenant_id ON public.auction_records USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_auction_per_loan ON public.auction_records USING btree (loan_id) WHERE ((stage)::text <> ALL ((ARRAY['Settled'::character varying, 'Withdrawn'::character varying])::text[]));

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_pending_auction_decision ON public.auction_decision_requests USING btree (auction_record_id, kind) WHERE ((status)::text = 'Pending'::text);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auction_decision_requests' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.auction_decision_requests USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auction_events' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.auction_events USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auction_notices' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.auction_notices USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auction_records' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.auction_records USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_auction_records_decision_requests') THEN
		ALTER TABLE ONLY public.auction_decision_requests
	ADD CONSTRAINT fk_auction_records_decision_requests FOREIGN KEY (auction_record_id) REFERENCES public.auction_records(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_auction_records_events') THEN
		ALTER TABLE ONLY public.auction_events
	ADD CONSTRAINT fk_auction_records_events FOREIGN KEY (auction_record_id) REFERENCES public.auction_records(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_auction_records_notices') THEN
		ALTER TABLE ONLY public.auction_notices
	ADD CONSTRAINT fk_auction_records_notices FOREIGN KEY (auction_record_id) REFERENCES public.auction_records(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.auction_records CASCADE;
DROP TABLE IF EXISTS public.auction_notices CASCADE;
DROP TABLE IF EXISTS public.auction_events CASCADE;
DROP TABLE IF EXISTS public.auction_decision_requests CASCADE;

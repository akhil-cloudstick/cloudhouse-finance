-- +migrate Up

CREATE TABLE IF NOT EXISTS public.packet_movements (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	packet_id bigint NOT NULL,
	from_status character varying(30),
	to_status character varying(30) NOT NULL,
	locker_id bigint,
	actor_employee_id bigint,
	remarks character varying(255),
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.packet_movements ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.packets (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	code character varying(30) NOT NULL,
	loan_id bigint NOT NULL CONSTRAINT fk_packets_loan REFERENCES public.loans(id),
	status character varying(30) NOT NULL,
	current_locker_id bigint,
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	total_gross_weight numeric(16,3) DEFAULT 0,
	total_net_weight numeric(16,3) DEFAULT 0
);

ALTER TABLE ONLY public.packets ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_packet_movements_packet_id ON public.packet_movements USING btree (packet_id);

CREATE INDEX IF NOT EXISTS idx_packet_movements_tenant_id ON public.packet_movements USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_packets_code ON public.packets USING btree (code);

CREATE INDEX IF NOT EXISTS idx_packets_loan_id ON public.packets USING btree (loan_id);

CREATE INDEX IF NOT EXISTS idx_packets_tenant_id ON public.packets USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_packets_tenant_code ON public.packets USING btree (tenant_id, code);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'packet_movements' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.packet_movements USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'packets' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.packets USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_packets_movements') THEN
		ALTER TABLE ONLY public.packet_movements
	ADD CONSTRAINT fk_packets_movements FOREIGN KEY (packet_id) REFERENCES public.packets(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.packets CASCADE;
DROP TABLE IF EXISTS public.packet_movements CASCADE;

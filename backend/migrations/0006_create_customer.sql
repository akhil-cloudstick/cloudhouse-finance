-- +migrate Up

CREATE TABLE IF NOT EXISTS public.customer_device_tokens (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	customer_id bigint NOT NULL,
	device_id character varying(100) NOT NULL,
	token_hash character varying(64) NOT NULL,
	created_at timestamp with time zone,
	revoked_at timestamp with time zone,
	last_used_at timestamp with time zone
);

ALTER TABLE ONLY public.customer_device_tokens ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.customer_otp (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	phone character varying(20) NOT NULL,
	code_hash character varying(64) NOT NULL,
	expires_at timestamp with time zone NOT NULL,
	attempts bigint DEFAULT 0 NOT NULL,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.customer_otp ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.customers (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	code character varying(20),
	name character varying(120) NOT NULL,
	phone character varying(20),
	dob timestamp with time zone,
	address character varying(255),
	branch_id bigint NOT NULL CONSTRAINT fk_customers_branch REFERENCES public.branches(id),
	photo_url character varying(255),
	identity_proof_url character varying(255),
	address_proof_url character varying(255),
	kyc_document_url character varying(255),
	pan character varying(10),
	aadhaar_last4 character varying(4),
	aadhaar_encrypted text,
	nominee_name character varying(120),
	nominee_relation character varying(60),
	nominee_phone character varying(20),
	father_name character varying(120),
	district character varying(80),
	taluk character varying(80),
	village character varying(80),
	place character varying(80),
	pin_code character varying(10),
	age bigint,
	customer_type character varying(20) DEFAULT 'Borrower'::character varying NOT NULL,
	bank_account_name character varying(120),
	bank_account_number character varying(30),
	bank_ifsc character varying(15),
	kyc_status character varying(20),
	pan_status character varying(20),
	aadhaar_status character varying(20),
	digilocker_request_id character varying(64),
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	aadhaar_hash character varying(64)
);

ALTER TABLE ONLY public.customers ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_customer_device_tokens_customer_id ON public.customer_device_tokens USING btree (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_device_tokens_device_id ON public.customer_device_tokens USING btree (device_id);

CREATE INDEX IF NOT EXISTS idx_customer_device_tokens_tenant_id ON public.customer_device_tokens USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_device_tokens_token_hash ON public.customer_device_tokens USING btree (token_hash);

CREATE INDEX IF NOT EXISTS idx_customer_otp_phone ON public.customer_otp USING btree (phone);

CREATE INDEX IF NOT EXISTS idx_customer_otp_tenant_id ON public.customer_otp USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_customers_code ON public.customers USING btree (code);

CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON public.customers USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON public.customers USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_otp_tenant_phone ON public.customer_otp USING btree (tenant_id, phone);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_aadhaar ON public.customers USING btree (tenant_id, aadhaar_hash) WHERE ((aadhaar_hash IS NOT NULL) AND ((aadhaar_hash)::text <> ''::text) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_code ON public.customers USING btree (tenant_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_pan ON public.customers USING btree (tenant_id, pan) WHERE ((pan IS NOT NULL) AND ((pan)::text <> ''::text) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_phone ON public.customers USING btree (tenant_id, phone) WHERE (((phone)::text <> ''::text) AND (deleted_at IS NULL));

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_device_tokens' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.customer_device_tokens USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_otp' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.customer_otp USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customers' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.customers USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.customer_otp CASCADE;
DROP TABLE IF EXISTS public.customer_device_tokens CASCADE;

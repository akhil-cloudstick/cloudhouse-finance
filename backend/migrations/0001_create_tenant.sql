-- +migrate Up

CREATE TABLE IF NOT EXISTS public.api_key_settings (
	id bigserial PRIMARY KEY,
	category character varying(40) NOT NULL,
	name character varying(120),
	encrypted_value text,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.schema_migrations (
	id bigserial PRIMARY KEY,
	version character varying(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sequences (
	tenant_id bigint NOT NULL,
	kind character varying(24) NOT NULL,
	last_value bigint DEFAULT 0 NOT NULL,
	updated_at timestamp with time zone,
	PRIMARY KEY (tenant_id, kind)
);

CREATE TABLE IF NOT EXISTS public.subscription_payments (
	id bigserial PRIMARY KEY,
	tenant_id bigint NOT NULL,
	amount_in_paise bigint NOT NULL,
	paid_on date NOT NULL,
	mode character varying(20) NOT NULL,
	reference character varying(120),
	note character varying(500),
	period_from date,
	period_to date,
	plan_name character varying(60),
	recorded_by_id bigint NOT NULL,
	recorded_by_name character varying(120) NOT NULL,
	created_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.tenants (
	id bigserial PRIMARY KEY,
	name character varying(160) NOT NULL,
	code character varying(32) NOT NULL,
	tier_id bigint NOT NULL,
	status character varying(20) DEFAULT 'active'::character varying NOT NULL,
	subscription_expires_at timestamp with time zone,
	grace_period_ends_at timestamp with time zone,
	razorpay_subscription_id character varying(64),
	subscription_notified_at timestamp with time zone,
	legal_name character varying(200),
	address_line character varying(300),
	kml_reg_no character varying(60),
	app_url character varying(200),
	brand_color character varying(9),
	logo_storage_key character varying(120),
	enabled_modules character varying(200),
	document_languages character varying(60),
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone,
	secondary_color character varying(9),
	accent_color character varying(9),
	font_family character varying(40),
	font_scale character varying(20),
	logo_scale character varying(20),
	logo_display character varying(20),
	short_name character varying(40),
	sidebar_color character varying(9),
	lockup_tagline character varying(120),
	policy character varying(20),
	nav_text_color character varying(9),
	on_brand_text_color character varying(9),
	header_layout text,
	signature_storage_key character varying(120),
	single_branch boolean DEFAULT false NOT NULL,
	contact_phone character varying(120),
	lender_age character varying(3),
	lender_pan character varying(10),
	lender_aadhaar character varying(12)
);

CREATE TABLE IF NOT EXISTS public.tiers (
	id bigserial PRIMARY KEY,
	name character varying(60) NOT NULL,
	branch_quota bigint DEFAULT 1 NOT NULL,
	price_in_paise bigint DEFAULT 0 NOT NULL,
	razorpay_plan_id character varying(64),
	is_active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.usage_counters (
	tenant_id bigint NOT NULL,
	category character varying(40) NOT NULL,
	day timestamp with time zone NOT NULL,
	count bigint DEFAULT 0 NOT NULL,
	PRIMARY KEY (tenant_id, category, day)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_key_settings_category ON public.api_key_settings USING btree (category);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_tenant_id ON public.subscription_payments USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_code ON public.tenants USING btree (code);

CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at ON public.tenants USING btree (deleted_at);

CREATE INDEX IF NOT EXISTS idx_tenants_razorpay_subscription_id ON public.tenants USING btree (razorpay_subscription_id);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants USING btree (status);

CREATE INDEX IF NOT EXISTS idx_tenants_tier_id ON public.tenants USING btree (tier_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tiers_name ON public.tiers USING btree (name);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenants_tier') THEN
		ALTER TABLE ONLY public.tenants
	ADD CONSTRAINT fk_tenants_tier FOREIGN KEY (tier_id) REFERENCES public.tiers(id);
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.usage_counters CASCADE;
DROP TABLE IF EXISTS public.tiers CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;
DROP TABLE IF EXISTS public.subscription_payments CASCADE;
DROP TABLE IF EXISTS public.sequences CASCADE;
DROP TABLE IF EXISTS public.schema_migrations CASCADE;
DROP TABLE IF EXISTS public.api_key_settings CASCADE;

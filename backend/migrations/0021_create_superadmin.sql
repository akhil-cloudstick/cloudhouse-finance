-- +migrate Up

CREATE TABLE IF NOT EXISTS public.superadmin_audit_logs (
	id bigserial PRIMARY KEY,
	super_admin_user_id bigint NOT NULL,
	actor_name character varying(120) NOT NULL,
	action character varying(60) NOT NULL,
	tenant_id bigint,
	tenant_name character varying(160),
	detail text,
	reason text NOT NULL,
	ip_address character varying(64),
	created_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.superadmin_users (
	id bigserial PRIMARY KEY,
	name character varying(120) NOT NULL,
	username character varying(60) NOT NULL,
	password_hash text NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_action ON public.superadmin_audit_logs USING btree (action);

CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_super_admin_user_id ON public.superadmin_audit_logs USING btree (super_admin_user_id);

CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_tenant_id ON public.superadmin_audit_logs USING btree (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_superadmin_users_username ON public.superadmin_users USING btree (username);

-- +migrate Down

DROP TABLE IF EXISTS public.superadmin_users CASCADE;
DROP TABLE IF EXISTS public.superadmin_audit_logs CASCADE;

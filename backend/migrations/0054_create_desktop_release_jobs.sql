-- +migrate Up

CREATE TABLE IF NOT EXISTS public.desktop_release_jobs (
	id bigserial PRIMARY KEY,
	tenant_code text NOT NULL,
	os text NOT NULL,
	version text NOT NULL,
	build_type text NOT NULL DEFAULT 'full',
	status text NOT NULL DEFAULT 'queued',
	github_run_id bigint,
	created_by_admin_id bigint,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT desktop_release_jobs_build_type_check CHECK (build_type IN ('full', 'content')),
	CONSTRAINT desktop_release_jobs_status_check CHECK (status IN ('queued', 'preparing', 'building', 'uploading', 'verifying', 'done', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS desktop_release_jobs_tenant_code_idx ON public.desktop_release_jobs (tenant_code);

-- +migrate Down

DROP TABLE IF EXISTS public.desktop_release_jobs CASCADE;

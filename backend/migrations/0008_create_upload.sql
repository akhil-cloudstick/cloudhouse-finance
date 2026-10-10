-- +migrate Up

CREATE TABLE IF NOT EXISTS public.uploaded_files (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	storage_key character varying(255) NOT NULL,
	original_name character varying(255),
	content_type character varying(120),
	size_bytes bigint,
	uploaded_by_employee_id bigint,
	created_at timestamp with time zone
);

ALTER TABLE ONLY public.uploaded_files ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_uploaded_files_storage_key ON public.uploaded_files USING btree (storage_key);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_tenant_id ON public.uploaded_files USING btree (tenant_id);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'uploaded_files' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.uploaded_files USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.uploaded_files CASCADE;

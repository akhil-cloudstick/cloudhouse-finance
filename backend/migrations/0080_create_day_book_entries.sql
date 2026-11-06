-- +migrate Up

-- The Day Book: lines staff write by hand (date, particulars, debit, credit, interest), kept apart
-- from the cash ledger so nothing here moves the balance in hand.
CREATE TABLE IF NOT EXISTS public.day_book_entries (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	branch_id bigint CONSTRAINT fk_day_book_entries_branch REFERENCES public.branches(id),
	entry_date date NOT NULL,
	particulars character varying(255) NOT NULL,
	debit numeric(16,2) DEFAULT 0 NOT NULL,
	credit numeric(16,2) DEFAULT 0 NOT NULL,
	interest numeric(16,2) DEFAULT 0 NOT NULL,
	created_by_employee_id bigint,
	created_at timestamp with time zone,
	updated_at timestamp with time zone
);

ALTER TABLE ONLY public.day_book_entries ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_day_book_entries_tenant_id ON public.day_book_entries USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_day_book_entries_entry_date ON public.day_book_entries USING btree (entry_date);

CREATE INDEX IF NOT EXISTS idx_day_book_entries_branch_id ON public.day_book_entries USING btree (branch_id);

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'day_book_entries' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.day_book_entries USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP TABLE IF EXISTS public.day_book_entries CASCADE;

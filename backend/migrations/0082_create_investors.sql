-- +migrate Up

-- Investors get their own table. Until now an investor was a customers row with
-- customer_type = 'Investor', so one phone / PAN / Aadhaar could not be both a borrower and an
-- investor. The new table keeps the SAME ids as the rows it was copied from, so
-- investments.customer_id (which now means "the investor") needs no remapping.
CREATE TABLE IF NOT EXISTS public.investors (
	tenant_id bigint NOT NULL,
	id bigserial PRIMARY KEY,
	code character varying(20),
	name character varying(120) NOT NULL,
	phone character varying(20),
	dob timestamp with time zone,
	address character varying(255),
	branch_id bigint NOT NULL CONSTRAINT fk_investors_branch REFERENCES public.branches(id),
	photo_url character varying(255),
	identity_proof_url character varying(255),
	address_proof_url character varying(255),
	kyc_document_url character varying(255),
	pan character varying(10),
	aadhaar_last4 character varying(4),
	aadhaar_encrypted text,
	aadhaar_hash character varying(64),
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
	bank_account_name character varying(120),
	bank_account_number character varying(30),
	bank_ifsc character varying(15),
	kyc_status character varying(20),
	pan_status character varying(20),
	aadhaar_status character varying(20),
	created_at timestamp with time zone,
	updated_at timestamp with time zone,
	deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.investors ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Everyone who is an investor today: the Investor-typed customers, plus any customer an existing
-- investment points at (an investment never checked the type).
INSERT INTO public.investors (
	tenant_id, id, code, name, phone, dob, address, branch_id, photo_url, identity_proof_url,
	address_proof_url, kyc_document_url, pan, aadhaar_last4, aadhaar_encrypted, aadhaar_hash,
	nominee_name, nominee_relation, nominee_phone, father_name, district, taluk, village, place,
	pin_code, age, bank_account_name, bank_account_number, bank_ifsc, kyc_status, pan_status,
	aadhaar_status, created_at, updated_at, deleted_at
)
SELECT
	c.tenant_id, c.id,
	'INV-' || lpad((row_number() OVER (PARTITION BY c.tenant_id ORDER BY c.id))::text, 2, '0'),
	c.name, c.phone, c.dob, c.address, c.branch_id, c.photo_url, c.identity_proof_url,
	c.address_proof_url, c.kyc_document_url, c.pan, c.aadhaar_last4, c.aadhaar_encrypted, c.aadhaar_hash,
	c.nominee_name, c.nominee_relation, c.nominee_phone, c.father_name, c.district, c.taluk, c.village, c.place,
	c.pin_code, c.age, c.bank_account_name, c.bank_account_number, c.bank_ifsc, c.kyc_status, c.pan_status,
	c.aadhaar_status, c.created_at, c.updated_at, c.deleted_at
FROM public.customers c
WHERE c.customer_type = 'Investor'
	OR c.id IN (SELECT customer_id FROM public.investments)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.investors', 'id'), COALESCE((SELECT MAX(id) FROM public.investors), 0) + 1, false);

CREATE INDEX IF NOT EXISTS idx_investors_tenant_id ON public.investors USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_investors_code ON public.investors USING btree (code);

CREATE INDEX IF NOT EXISTS idx_investors_deleted_at ON public.investors USING btree (deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_code ON public.investors USING btree (tenant_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_phone ON public.investors USING btree (tenant_id, phone) WHERE (((phone)::text <> ''::text) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_pan ON public.investors USING btree (tenant_id, pan) WHERE ((pan IS NOT NULL) AND ((pan)::text <> ''::text) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_tenant_aadhaar ON public.investors USING btree (tenant_id, aadhaar_hash) WHERE ((aadhaar_hash IS NOT NULL) AND ((aadhaar_hash)::text <> ''::text) AND (deleted_at IS NULL));

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'investors' AND policyname = 'tenant_isolation') THEN
		CREATE POLICY tenant_isolation ON public.investors USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint));
	END IF;
END $$;
-- +migrate StatementEnd

-- An investment's holder is now an investor. The column keeps its name (customer_id) so every
-- existing query keeps working; only what it points at changes.
ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS fk_investments_customer;

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_investments_investor') THEN
		ALTER TABLE public.investments ADD CONSTRAINT fk_investments_investor FOREIGN KEY (customer_id) REFERENCES public.investors(id);
	END IF;
END $$;
-- +migrate StatementEnd

COMMENT ON COLUMN public.investments.customer_id IS 'References investors.id (the investor holding this investment).';

-- Cash movements made for an investment name the investor as their party. party_customer_id keeps
-- pointing at customers (borrowers); a new column points at investors.
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS party_investor_id bigint;

-- +migrate StatementBegin
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cash_movements_party_investor') THEN
		ALTER TABLE public.cash_movements ADD CONSTRAINT fk_cash_movements_party_investor FOREIGN KEY (party_investor_id) REFERENCES public.investors(id);
	END IF;
END $$;
-- +migrate StatementEnd

CREATE INDEX IF NOT EXISTS idx_cash_movements_party_investor_id ON public.cash_movements USING btree (party_investor_id);

UPDATE public.cash_movements
SET party_investor_id = party_customer_id, party_customer_id = NULL
WHERE source_type IN ('investment_deposit', 'investment_payout')
	AND party_customer_id IS NOT NULL
	AND party_customer_id IN (SELECT id FROM public.investors);

-- Investor-typed customers that are also borrowers stay customers (as Borrower); the rest leave the
-- customers table, along with the per-customer rows that only made sense for them.
UPDATE public.customers c SET customer_type = 'Borrower'
WHERE c.customer_type = 'Investor'
	AND (EXISTS (SELECT 1 FROM public.loans l WHERE l.customer_id = c.id)
		OR EXISTS (SELECT 1 FROM public.loan_drafts d WHERE d.customer_id = c.id)
		OR EXISTS (SELECT 1 FROM public.personal_loans p WHERE p.customer_id = c.id)
		OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.party_customer_id = c.id));

DELETE FROM public.reminders WHERE customer_id IN (SELECT id FROM public.customers WHERE customer_type = 'Investor');
DELETE FROM public.notifications WHERE customer_id IN (SELECT id FROM public.customers WHERE customer_type = 'Investor');
DELETE FROM public.customer_device_tokens WHERE customer_id IN (SELECT id FROM public.customers WHERE customer_type = 'Investor');
DELETE FROM public.customers WHERE customer_type = 'Investor';

-- +migrate Down

-- Down only restores the structure; investor rows are not moved back into customers.
ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS fk_investments_investor;
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS fk_cash_movements_party_investor;
ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS party_investor_id;
DROP TABLE IF EXISTS public.investors CASCADE;

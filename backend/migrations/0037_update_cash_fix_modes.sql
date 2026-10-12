-- +migrate Up

-- the application has three payment modes (Cash, UPI, Bank Transfer); cash_movements force RLS, so each
-- business is fixed under its own app.tenant_id. Rows that cannot be fixed safely are only counted in a
-- notice for manual review, never guessed.
-- +migrate StatementBegin
DO $$
DECLARE
	t record;
	blank_fixed bigint;
	bank_cleared bigint;
	review bigint;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);

		UPDATE public.cash_movements SET mode = 'Cash'
			WHERE tenant_id = t.id AND (mode IS NULL OR btrim(mode) = '');
		GET DIAGNOSTICS blank_fixed = ROW_COUNT;

		UPDATE public.cash_movements SET bank_id = NULL
			WHERE tenant_id = t.id AND mode = 'Cash' AND bank_id IS NOT NULL
			AND source IS DISTINCT FROM 'Self Transfer';
		GET DIAGNOSTICS bank_cleared = ROW_COUNT;

		SELECT count(*) INTO review FROM public.cash_movements
			WHERE tenant_id = t.id AND (
				mode NOT IN ('Cash', 'UPI', 'Bank Transfer')
				OR (mode IN ('UPI', 'Bank Transfer') AND bank_id IS NULL)
			);

		RAISE NOTICE 'tenant %: % blank modes set to Cash, % cash rows lost a bank id, % rows need manual review',
			t.id, blank_fixed, bank_cleared, review;
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

-- the data fix is not reversible
SELECT 1;

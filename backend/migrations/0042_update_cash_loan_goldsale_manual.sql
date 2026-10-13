-- +migrate Up

-- a draw on a bank loan and a gold sale can be edited from the ledger too: mark the ones recorded earlier.
-- cash_movements forces RLS, so each business is marked under its own app.tenant_id. A gold sale from before
-- the cost stopped being booked as a cash-out has a second cash line and stays read-only.
-- +migrate StatementBegin
DO $$
DECLARE
	t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);

		UPDATE public.cash_movements m SET is_manual = true
			WHERE m.tenant_id = t.id
				AND m.type = 'in'
				AND m.expense_id IS NULL
				AND EXISTS (SELECT 1 FROM public.loan_cash_sources l WHERE l.cash_movement_id = m.id);

		UPDATE public.cash_movements m SET is_manual = true
			WHERE m.tenant_id = t.id
				AND m.type = 'in'
				AND m.source = 'GoldSale'
				AND EXISTS (SELECT 1 FROM public.gold_sales g WHERE g.cash_movement_id = m.id AND g.cost_cash_movement_id IS NULL);
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

-- the marking is not reversible

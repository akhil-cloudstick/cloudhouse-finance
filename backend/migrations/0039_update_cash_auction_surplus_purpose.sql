-- +migrate Up

-- the auction surplus entry is now called a settlement (the surplus can be refunded or kept as income);
-- cash_movements force RLS, so each business is updated under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);
		UPDATE public.cash_movements
			SET purpose = replace(purpose, 'Auction surplus refunded to customer', 'Auction surplus settlement')
			WHERE tenant_id = t.id AND purpose LIKE 'Auction surplus refunded to customer%';
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

SELECT 1;

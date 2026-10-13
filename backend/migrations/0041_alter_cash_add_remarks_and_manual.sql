-- +migrate Up

-- remarks typed on a cash-in, a debit or a self transfer, shown in the ledger's info popup
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS remarks character varying(500);
-- true for a line a person keyed in (cash-in, debit, self transfer) and so may edit from the ledger;
-- lines the system books for a loan, auction, pledge or gold sale stay false
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;
-- the debit lines of one payment breakdown share this id, so they are approved and edited together
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS group_id character varying(40);

CREATE INDEX IF NOT EXISTS idx_expenses_group_id ON public.expenses (group_id);

-- mark the lines recorded before this column existed; cash_movements forces RLS, so each business is
-- marked under its own app.tenant_id
-- +migrate StatementBegin
DO $$
DECLARE
	t record;
BEGIN
	FOR t IN SELECT id FROM public.tenants LOOP
		PERFORM set_config('app.tenant_id', t.id::text, true);

		UPDATE public.cash_movements SET is_manual = true
			WHERE tenant_id = t.id AND source = 'Self Transfer';

		UPDATE public.cash_movements m SET is_manual = true
			WHERE m.tenant_id = t.id
				AND m.expense_id IS NOT NULL
				AND m.purpose LIKE 'Expense — %'
				AND m.purpose NOT IN ('Expense — Bank Pledge Release', 'Expense — Auction')
				AND EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = m.expense_id AND COALESCE(e.approved_by, '') <> 'System');

		UPDATE public.cash_movements m SET is_manual = true
			WHERE m.tenant_id = t.id
				AND m.type = 'in'
				AND m.expense_id IS NULL
				AND m.source_type IS NULL
				AND m.source IN (SELECT c.name FROM public.categories c WHERE c.tenant_id = t.id AND c.type = 'cash_in')
				AND m.source NOT IN ('Collection', 'Service Charge', 'Investment', 'Bank', 'GoldSale', 'Self Transfer')
				AND NOT EXISTS (SELECT 1 FROM public.loan_cash_sources l WHERE l.cash_movement_id = m.id);
	END LOOP;
END $$;
-- +migrate StatementEnd

-- +migrate Down

DROP INDEX IF EXISTS idx_expenses_group_id;
ALTER TABLE public.expenses DROP COLUMN IF EXISTS group_id;
ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS is_manual;
ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS remarks;

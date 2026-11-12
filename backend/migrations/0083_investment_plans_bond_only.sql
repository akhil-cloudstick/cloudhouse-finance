-- +migrate Up

-- Every investment plan is a Bond; there is no separate Deposit product any more. Plans made before that
-- carry "Deposit", so they are brought across, and new plans default to Bond.
UPDATE public.investment_plans SET product_type = 'Bond' WHERE product_type <> 'Bond';

ALTER TABLE public.investment_plans ALTER COLUMN product_type SET DEFAULT 'Bond';

-- +migrate Down

ALTER TABLE public.investment_plans ALTER COLUMN product_type SET DEFAULT 'Deposit';

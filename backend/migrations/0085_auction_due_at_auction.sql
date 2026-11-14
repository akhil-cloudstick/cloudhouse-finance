-- +migrate Up

-- What the customer owed when the gold was sold. NULL on rows sold before this column existed.
ALTER TABLE public.auction_records ADD COLUMN IF NOT EXISTS due_principal numeric(16,2);
ALTER TABLE public.auction_records ADD COLUMN IF NOT EXISTS due_interest numeric(16,2);
ALTER TABLE public.auction_records ADD COLUMN IF NOT EXISTS due_penal numeric(16,2);
ALTER TABLE public.auction_records ADD COLUMN IF NOT EXISTS due_total numeric(16,2);

-- +migrate Down
ALTER TABLE public.auction_records DROP COLUMN IF EXISTS due_principal;
ALTER TABLE public.auction_records DROP COLUMN IF EXISTS due_interest;
ALTER TABLE public.auction_records DROP COLUMN IF EXISTS due_penal;
ALTER TABLE public.auction_records DROP COLUMN IF EXISTS due_total;

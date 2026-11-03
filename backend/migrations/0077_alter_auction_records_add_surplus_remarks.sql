-- +migrate Up

-- The reason / notes entered when an auction's surplus is settled, kept on the record so the ledgers can show it.
ALTER TABLE public.auction_records ADD COLUMN IF NOT EXISTS surplus_remarks varchar(500);

-- +migrate Down

ALTER TABLE public.auction_records DROP COLUMN IF EXISTS surplus_remarks;

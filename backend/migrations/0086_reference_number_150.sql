-- +migrate Up
ALTER TABLE public.auction_records ALTER COLUMN auction_reference_number TYPE character varying(150);
ALTER TABLE public.bank_pledge_records ALTER COLUMN reference_number TYPE character varying(150);

-- +migrate Down
ALTER TABLE public.auction_records ALTER COLUMN auction_reference_number TYPE character varying(60);
ALTER TABLE public.bank_pledge_records ALTER COLUMN reference_number TYPE character varying(60);

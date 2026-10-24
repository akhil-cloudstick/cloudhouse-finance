-- +migrate Up

-- contact email printed on the public store-listing pages (/privacy-policy etc.), taken from the "default" business.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS support_email character varying(160);

-- +migrate Down

ALTER TABLE public.tenants DROP COLUMN IF EXISTS support_email;

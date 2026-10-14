-- +migrate Up

-- Aadhaar eSign of the GML pledge slip: the customer signs it, the signed PDF is kept alongside the loan
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS pledge_slip_sign_request_id character varying(100);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS pledge_slip_sign_status character varying(20);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS pledge_slip_signed_url character varying(255);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS pledge_slip_signed_at timestamp with time zone;

-- +migrate Down

ALTER TABLE public.loans DROP COLUMN IF EXISTS pledge_slip_signed_at;
ALTER TABLE public.loans DROP COLUMN IF EXISTS pledge_slip_signed_url;
ALTER TABLE public.loans DROP COLUMN IF EXISTS pledge_slip_sign_status;
ALTER TABLE public.loans DROP COLUMN IF EXISTS pledge_slip_sign_request_id;

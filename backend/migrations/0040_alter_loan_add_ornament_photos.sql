-- +migrate Up

-- one overall photo of the whole pledged lot, shown on the loan details card
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS overall_photo_url character varying(512);
ALTER TABLE public.loan_drafts ADD COLUMN IF NOT EXISTS overall_photo_url character varying(512);
-- every photo of a draft ornament (JSON array); image_url stays as the first one
ALTER TABLE public.loan_draft_ornaments ADD COLUMN IF NOT EXISTS image_urls text;

-- +migrate Down

ALTER TABLE public.loan_draft_ornaments DROP COLUMN IF EXISTS image_urls;
ALTER TABLE public.loan_drafts DROP COLUMN IF EXISTS overall_photo_url;
ALTER TABLE public.loans DROP COLUMN IF EXISTS overall_photo_url;

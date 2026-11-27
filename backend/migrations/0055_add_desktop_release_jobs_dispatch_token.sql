-- +migrate Up

ALTER TABLE public.desktop_release_jobs ADD COLUMN IF NOT EXISTS dispatch_token text;

-- +migrate Down

ALTER TABLE public.desktop_release_jobs DROP COLUMN IF EXISTS dispatch_token;

-- +migrate Up

ALTER TABLE public.devtools_access RENAME COLUMN pin_hash TO encrypted_pin;

-- +migrate Down

ALTER TABLE public.devtools_access RENAME COLUMN encrypted_pin TO pin_hash;

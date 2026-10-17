-- +migrate Up

CREATE TABLE IF NOT EXISTS public.devtools_access (
	id smallint PRIMARY KEY DEFAULT 1,
	pin_hash text NOT NULL,
	updated_at timestamp with time zone,
	CONSTRAINT devtools_access_singleton CHECK (id = 1)
);

-- +migrate Down

DROP TABLE IF EXISTS public.devtools_access CASCADE;

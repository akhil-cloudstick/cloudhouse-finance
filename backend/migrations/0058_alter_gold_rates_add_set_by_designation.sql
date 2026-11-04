-- +migrate Up

-- the role (designation) of the staff member who set the rate, shown beside their name in the rate history.
ALTER TABLE gold_rates ADD COLUMN IF NOT EXISTS set_by_designation character varying(60) NOT NULL DEFAULT '';

-- +migrate Down

ALTER TABLE gold_rates DROP COLUMN IF EXISTS set_by_designation;

-- +migrate Up

-- the ornaments covered by a bank pledge, as a JSON array of ornament ids; 'null' means the whole loan's gold.
ALTER TABLE bank_pledge_records ADD COLUMN IF NOT EXISTS ornament_ids text NOT NULL DEFAULT 'null';

-- +migrate Down

ALTER TABLE bank_pledge_records DROP COLUMN IF EXISTS ornament_ids;

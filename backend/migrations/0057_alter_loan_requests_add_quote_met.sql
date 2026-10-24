-- +migrate Up

-- a release request whose recorded payment (plus discount) covered what was needed to release the gold when the payment was taken,
-- so the later approval stages no longer re-check the live balance.
ALTER TABLE loan_requests ADD COLUMN IF NOT EXISTS quote_met boolean NOT NULL DEFAULT false;

-- +migrate Down

ALTER TABLE loan_requests DROP COLUMN IF EXISTS quote_met;

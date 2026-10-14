-- +migrate Up

-- Staff member who created the loan; printed at the top of the TML pledge-book bond
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS created_by_employee_id bigint;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS created_by_name character varying(120);

-- +migrate Down

ALTER TABLE public.loans DROP COLUMN IF EXISTS created_by_name;
ALTER TABLE public.loans DROP COLUMN IF EXISTS created_by_employee_id;

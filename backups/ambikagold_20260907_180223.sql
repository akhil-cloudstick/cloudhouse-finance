--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_key_settings; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.api_key_settings (
    id bigint NOT NULL,
    category character varying(40) NOT NULL,
    name character varying(120),
    encrypted_value text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


ALTER TABLE public.api_key_settings OWNER TO ambikagold;

--
-- Name: api_key_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.api_key_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.api_key_settings_id_seq OWNER TO ambikagold;

--
-- Name: api_key_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.api_key_settings_id_seq OWNED BY public.api_key_settings.id;


--
-- Name: approval_limits; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.approval_limits (
    id bigint NOT NULL,
    role character varying(40) NOT NULL,
    max_amount numeric NOT NULL,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.approval_limits OWNER TO ambikagold;

--
-- Name: approval_limits_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.approval_limits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.approval_limits_id_seq OWNER TO ambikagold;

--
-- Name: approval_limits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.approval_limits_id_seq OWNED BY public.approval_limits.id;


--
-- Name: auction_decision_requests; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.auction_decision_requests (
    id bigint NOT NULL,
    auction_record_id bigint NOT NULL,
    loan_id bigint NOT NULL,
    kind character varying(20) NOT NULL,
    triggered_by_payment_id bigint,
    amount_paid numeric(16,2) DEFAULT 0,
    outstanding_at_request numeric(16,2) DEFAULT 0,
    status character varying(24) DEFAULT 'Pending'::character varying NOT NULL,
    decided_by_employee_id bigint,
    decided_by_role character varying(40),
    decision_remarks character varying(255),
    decided_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.auction_decision_requests OWNER TO ambikagold;

--
-- Name: auction_decision_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.auction_decision_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auction_decision_requests_id_seq OWNER TO ambikagold;

--
-- Name: auction_decision_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.auction_decision_requests_id_seq OWNED BY public.auction_decision_requests.id;


--
-- Name: auction_events; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.auction_events (
    id bigint NOT NULL,
    auction_record_id bigint NOT NULL,
    action character varying(30) NOT NULL,
    actor_employee_id bigint,
    actor_role character varying(40),
    remarks character varying(255),
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.auction_events OWNER TO ambikagold;

--
-- Name: auction_events_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.auction_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auction_events_id_seq OWNER TO ambikagold;

--
-- Name: auction_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.auction_events_id_seq OWNED BY public.auction_events.id;


--
-- Name: auction_notices; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.auction_notices (
    id bigint NOT NULL,
    auction_record_id bigint NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    method character varying(40),
    remarks character varying(255),
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.auction_notices OWNER TO ambikagold;

--
-- Name: auction_notices_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.auction_notices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auction_notices_id_seq OWNER TO ambikagold;

--
-- Name: auction_notices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.auction_notices_id_seq OWNED BY public.auction_notices.id;


--
-- Name: auction_records; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.auction_records (
    id bigint NOT NULL,
    loan_id bigint NOT NULL,
    stage character varying(20) NOT NULL,
    auction_eligible_date timestamp with time zone NOT NULL,
    auction_date timestamp with time zone,
    auction_reference_number character varying(60),
    sale_amount numeric(16,2) DEFAULT 0,
    auction_expenses numeric(16,2) DEFAULT 0,
    surplus_shortfall numeric(16,2) DEFAULT 0,
    final_settlement_status character varying(24) DEFAULT 'Pending'::character varying NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    surplus_payable_amount numeric(16,2) DEFAULT 0,
    surplus_disposition character varying(24),
    surplus_paid_out_movement_id bigint,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.auction_records OWNER TO ambikagold;

--
-- Name: auction_records_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.auction_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auction_records_id_seq OWNER TO ambikagold;

--
-- Name: auction_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.auction_records_id_seq OWNED BY public.auction_records.id;


--
-- Name: audit_log_entries; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.audit_log_entries (
    tenant_id bigint,
    id bigint NOT NULL,
    actor_employee_id bigint NOT NULL,
    actor_name character varying(120) NOT NULL,
    action character varying(60) NOT NULL,
    entity_type character varying(40) NOT NULL,
    entity_id bigint NOT NULL,
    entity_name character varying(160),
    detail text,
    created_at timestamp with time zone
);


ALTER TABLE public.audit_log_entries OWNER TO ambikagold;

--
-- Name: audit_log_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.audit_log_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_log_entries_id_seq OWNER TO ambikagold;

--
-- Name: audit_log_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.audit_log_entries_id_seq OWNED BY public.audit_log_entries.id;


--
-- Name: bank_pledge_events; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.bank_pledge_events (
    id bigint NOT NULL,
    bank_pledge_record_id bigint NOT NULL,
    action character varying(20) NOT NULL,
    actor_employee_id bigint,
    actor_role character varying(40),
    amount numeric(16,2) DEFAULT 0,
    remarks character varying(255),
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.bank_pledge_events OWNER TO ambikagold;

--
-- Name: bank_pledge_events_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.bank_pledge_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bank_pledge_events_id_seq OWNER TO ambikagold;

--
-- Name: bank_pledge_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.bank_pledge_events_id_seq OWNED BY public.bank_pledge_events.id;


--
-- Name: bank_pledge_records; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.bank_pledge_records (
    id bigint NOT NULL,
    loan_id bigint NOT NULL,
    bank_name character varying(120) NOT NULL,
    pledged_amount numeric(16,2) NOT NULL,
    pledge_date timestamp with time zone NOT NULL,
    release_date timestamp with time zone,
    created_at timestamp with time zone,
    cash_movement_id bigint,
    bank_interest_rate numeric,
    reference_number character varying(60),
    bank_id bigint,
    bank_pledge_due_date timestamp with time zone,
    pledged_gross_weight numeric,
    pledged_net_weight numeric,
    expense_id bigint,
    release_cash_movement_id bigint,
    release_expense_id bigint,
    cash_treatment character varying(20) DEFAULT 'CashIn'::character varying NOT NULL,
    status character varying(20) DEFAULT 'Active'::character varying NOT NULL,
    voided_at timestamp with time zone,
    void_reason character varying(255),
    void_cash_movement_id bigint,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.bank_pledge_records OWNER TO ambikagold;

--
-- Name: bank_pledge_records_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.bank_pledge_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bank_pledge_records_id_seq OWNER TO ambikagold;

--
-- Name: bank_pledge_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.bank_pledge_records_id_seq OWNED BY public.bank_pledge_records.id;


--
-- Name: banks; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.banks (
    id bigint NOT NULL,
    name character varying(120) NOT NULL,
    branch character varying(120),
    ifsc character varying(20),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone character varying(20),
    account_no character varying(40),
    tenant_id bigint NOT NULL
);


ALTER TABLE public.banks OWNER TO ambikagold;

--
-- Name: banks_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.banks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.banks_id_seq OWNER TO ambikagold;

--
-- Name: banks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.banks_id_seq OWNED BY public.banks.id;


--
-- Name: branches; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.branches (
    id bigint NOT NULL,
    name character varying(120) NOT NULL,
    code character varying(20),
    address character varying(255) NOT NULL,
    phone character varying(20),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.branches OWNER TO ambikagold;

--
-- Name: branches_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.branches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.branches_id_seq OWNER TO ambikagold;

--
-- Name: branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;


--
-- Name: cash_movements; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.cash_movements (
    id bigint NOT NULL,
    type character varying(10) NOT NULL,
    source character varying(20),
    purpose character varying(120),
    bank character varying(120),
    amount numeric(16,2) NOT NULL,
    status character varying(20),
    occurred_on timestamp with time zone NOT NULL,
    created_at timestamp with time zone,
    branch_id bigint,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.cash_movements OWNER TO ambikagold;

--
-- Name: cash_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.cash_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cash_movements_id_seq OWNER TO ambikagold;

--
-- Name: cash_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.cash_movements_id_seq OWNED BY public.cash_movements.id;


--
-- Name: communication_logs; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.communication_logs (
    id bigint NOT NULL,
    recipient_name character varying(120),
    recipient_phone character varying(20),
    chat_id character varying(32),
    channel character varying(20) NOT NULL,
    trigger_type character varying(30) NOT NULL,
    message_body text,
    related_entity_type character varying(30),
    related_entity_id bigint,
    status character varying(10) NOT NULL,
    error_message character varying(500),
    triggered_by_employee_id bigint,
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.communication_logs OWNER TO ambikagold;

--
-- Name: communication_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.communication_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.communication_logs_id_seq OWNER TO ambikagold;

--
-- Name: communication_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.communication_logs_id_seq OWNED BY public.communication_logs.id;


--
-- Name: customer_device_tokens; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.customer_device_tokens (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    device_id character varying(100) NOT NULL,
    token_hash character varying(64) NOT NULL,
    created_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.customer_device_tokens OWNER TO ambikagold;

--
-- Name: customer_device_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.customer_device_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_device_tokens_id_seq OWNER TO ambikagold;

--
-- Name: customer_device_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.customer_device_tokens_id_seq OWNED BY public.customer_device_tokens.id;


--
-- Name: customer_otp; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.customer_otp (
    id bigint NOT NULL,
    phone character varying(20) NOT NULL,
    code_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.customer_otp OWNER TO ambikagold;

--
-- Name: customer_otp_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.customer_otp_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_otp_id_seq OWNER TO ambikagold;

--
-- Name: customer_otp_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.customer_otp_id_seq OWNED BY public.customer_otp.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.customers (
    id bigint NOT NULL,
    code character varying(20),
    name character varying(120) NOT NULL,
    phone character varying(20) NOT NULL,
    dob timestamp with time zone,
    address character varying(255),
    branch_id bigint NOT NULL,
    photo_url character varying(255),
    identity_proof_url character varying(255),
    address_proof_url character varying(255),
    kyc_document_url character varying(255),
    pan character varying(10),
    aadhaar_last4 character varying(4),
    aadhaar_encrypted text,
    nominee_name character varying(120),
    nominee_relation character varying(60),
    nominee_phone character varying(20),
    kyc_status character varying(20),
    pan_status character varying(20),
    aadhaar_status character varying(20),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    digilocker_request_id character varying(64),
    tenant_id bigint NOT NULL,
    father_name character varying(120),
    district character varying(80),
    taluk character varying(80),
    village character varying(80),
    place character varying(80),
    pin_code character varying(10),
    age bigint
);


ALTER TABLE public.customers OWNER TO ambikagold;

--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_id_seq OWNER TO ambikagold;

--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: dashboard_snapshots; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.dashboard_snapshots (
    id bigint NOT NULL,
    date timestamp with time zone NOT NULL,
    active_count bigint,
    overdue_count bigint,
    pending_approval_count bigint,
    opened_today_count bigint,
    due_today_count bigint,
    created_at timestamp with time zone
);


ALTER TABLE public.dashboard_snapshots OWNER TO ambikagold;

--
-- Name: dashboard_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.dashboard_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dashboard_snapshots_id_seq OWNER TO ambikagold;

--
-- Name: dashboard_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.dashboard_snapshots_id_seq OWNED BY public.dashboard_snapshots.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.employees (
    id bigint NOT NULL,
    code character varying(20),
    name character varying(120) NOT NULL,
    role character varying(60) NOT NULL,
    phone character varying(20),
    loans_processed bigint,
    collections numeric,
    followups bigint,
    pending bigint,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    branch_id bigint NOT NULL,
    email character varying(120),
    password_hash character varying(255),
    password_reset_token_hash character varying(64),
    password_reset_expires_at timestamp with time zone,
    username character varying(60),
    role_id bigint,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.employees OWNER TO ambikagold;

--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employees_id_seq OWNER TO ambikagold;

--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.expenses (
    id bigint NOT NULL,
    occurred_on timestamp with time zone NOT NULL,
    category character varying(80) NOT NULL,
    amount numeric(16,2) NOT NULL,
    mode character varying(20) NOT NULL,
    payee character varying(120) NOT NULL,
    status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    receipt_image text,
    created_at timestamp with time zone,
    branch_id bigint NOT NULL,
    remarks character varying(500),
    approved_by character varying(120),
    approved_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.expenses OWNER TO ambikagold;

--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.expenses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expenses_id_seq OWNER TO ambikagold;

--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: gold_rates; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.gold_rates (
    id bigint NOT NULL,
    date timestamp with time zone NOT NULL,
    k24 numeric NOT NULL,
    legacy_k22 numeric,
    legacy_k18 numeric,
    set_by character varying(120) NOT NULL,
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.gold_rates OWNER TO ambikagold;

--
-- Name: gold_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.gold_rates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.gold_rates_id_seq OWNER TO ambikagold;

--
-- Name: gold_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.gold_rates_id_seq OWNED BY public.gold_rates.id;


--
-- Name: loan_approvals; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.loan_approvals (
    id bigint NOT NULL,
    loan_id bigint NOT NULL,
    stage character varying(30) NOT NULL,
    action character varying(20) NOT NULL,
    actor_employee_id bigint NOT NULL,
    remarks character varying(255),
    created_at timestamp with time zone,
    actor_role character varying(40),
    tenant_id bigint NOT NULL
);


ALTER TABLE public.loan_approvals OWNER TO ambikagold;

--
-- Name: loan_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.loan_approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.loan_approvals_id_seq OWNER TO ambikagold;

--
-- Name: loan_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.loan_approvals_id_seq OWNED BY public.loan_approvals.id;


--
-- Name: loan_draft_ornaments; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.loan_draft_ornaments (
    id bigint NOT NULL,
    draft_id bigint NOT NULL,
    name character varying(80),
    purity character varying(10),
    gross_weight numeric,
    quantity bigint,
    image_url character varying(512),
    image_name character varying(255),
    "position" bigint DEFAULT 0 NOT NULL,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.loan_draft_ornaments OWNER TO ambikagold;

--
-- Name: loan_draft_ornaments_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.loan_draft_ornaments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.loan_draft_ornaments_id_seq OWNER TO ambikagold;

--
-- Name: loan_draft_ornaments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.loan_draft_ornaments_id_seq OWNED BY public.loan_draft_ornaments.id;


--
-- Name: loan_drafts; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.loan_drafts (
    id bigint NOT NULL,
    created_by_employee_id bigint NOT NULL,
    branch_id bigint NOT NULL,
    customer_id bigint,
    scheme_id bigint,
    locker_id bigint,
    principal_override numeric(16,2),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.loan_drafts OWNER TO ambikagold;

--
-- Name: loan_drafts_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.loan_drafts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.loan_drafts_id_seq OWNER TO ambikagold;

--
-- Name: loan_drafts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.loan_drafts_id_seq OWNED BY public.loan_drafts.id;


--
-- Name: loan_payments; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.loan_payments (
    id bigint NOT NULL,
    loan_id bigint NOT NULL,
    amount numeric(16,2) NOT NULL,
    type character varying(30) NOT NULL,
    paid_on timestamp with time zone NOT NULL,
    received_by_employee_id bigint,
    created_at timestamp with time zone,
    description character varying(255),
    method character varying(30),
    reference character varying(80),
    penal_interest_applied numeric(16,2) DEFAULT 0,
    interest_applied numeric(16,2) DEFAULT 0,
    principal_applied numeric(16,2) DEFAULT 0,
    running_balance numeric(16,2) DEFAULT 0,
    processing_fee_applied numeric(16,2) DEFAULT 0,
    processing_fee numeric(16,2) DEFAULT 0,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.loan_payments OWNER TO ambikagold;

--
-- Name: loan_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.loan_payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.loan_payments_id_seq OWNER TO ambikagold;

--
-- Name: loan_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.loan_payments_id_seq OWNED BY public.loan_payments.id;


--
-- Name: loan_requests; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.loan_requests (
    id bigint NOT NULL,
    loan_id bigint NOT NULL,
    type character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    requested_by character varying(20) NOT NULL,
    detail character varying(255),
    requested_extension_months bigint,
    new_due_date timestamp with time zone,
    remarks character varying(255),
    requested_at timestamp with time zone NOT NULL,
    decided_at timestamp with time zone,
    decided_by_employee_id bigint,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    approval_stage character varying(30),
    payment_verified boolean,
    packet_verified boolean,
    bank_pledge_verified boolean,
    customer_confirmed boolean,
    verification_notes character varying(255),
    charges numeric(16,2) DEFAULT 0,
    settlement_amount numeric(16,2) DEFAULT 0,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.loan_requests OWNER TO ambikagold;

--
-- Name: loan_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.loan_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.loan_requests_id_seq OWNER TO ambikagold;

--
-- Name: loan_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.loan_requests_id_seq OWNED BY public.loan_requests.id;


--
-- Name: loans; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.loans (
    id bigint NOT NULL,
    loan_number character varying(20),
    branch_id bigint NOT NULL,
    customer_id bigint NOT NULL,
    scheme_id bigint NOT NULL,
    opened_date timestamp with time zone NOT NULL,
    due_date timestamp with time zone NOT NULL,
    total_net_weight numeric,
    total_gold_value numeric(16,2) DEFAULT 0,
    eligible_loan_amount numeric(16,2) DEFAULT 0,
    principal_amount numeric(16,2) NOT NULL,
    outstanding_amount numeric(16,2) NOT NULL,
    status character varying(30) NOT NULL,
    approval_stage character varying(30) NOT NULL,
    bank_pledge_status character varying(20) DEFAULT 'Not Pledged'::character varying NOT NULL,
    auction_date timestamp with time zone,
    auction_amount numeric(16,2),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    accrued_interest numeric(16,2) DEFAULT 0,
    interest_paid numeric(16,2) DEFAULT 0,
    accrued_penal_interest numeric(16,2) DEFAULT 0,
    penal_interest_paid numeric(16,2) DEFAULT 0,
    last_accrual_date timestamp with time zone,
    outstanding_processing_fee numeric(16,2) DEFAULT 0,
    indemnity_bond_document_id character varying(100),
    indemnity_bond_sign_request_id character varying(100),
    indemnity_bond_sign_status character varying(20),
    indemnity_bond_signed_url character varying(255),
    indemnity_bond_signed_at timestamp with time zone,
    due_soon_notified_at timestamp with time zone,
    overdue_notified_at timestamp with time zone,
    tenant_id bigint NOT NULL,
    additional_info character varying(2000)
);


ALTER TABLE public.loans OWNER TO ambikagold;

--
-- Name: loans_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.loans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.loans_id_seq OWNER TO ambikagold;

--
-- Name: loans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.loans_id_seq OWNED BY public.loans.id;


--
-- Name: lockers; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.lockers (
    id bigint NOT NULL,
    code character varying(20),
    branch_id bigint NOT NULL,
    capacity bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.lockers OWNER TO ambikagold;

--
-- Name: lockers_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.lockers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lockers_id_seq OWNER TO ambikagold;

--
-- Name: lockers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.lockers_id_seq OWNED BY public.lockers.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    type character varying(40) NOT NULL,
    title character varying(120),
    body text,
    related_entity_type character varying(30),
    related_entity_id bigint,
    delivered boolean DEFAULT false NOT NULL,
    delivered_at timestamp with time zone,
    attempts bigint DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    created_at timestamp with time zone,
    read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.notifications OWNER TO ambikagold;

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notifications_id_seq OWNER TO ambikagold;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: opening_cash_balances; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.opening_cash_balances (
    id bigint NOT NULL,
    branch_id bigint NOT NULL,
    balance_date timestamp with time zone NOT NULL,
    amount numeric(16,2) NOT NULL,
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.opening_cash_balances OWNER TO ambikagold;

--
-- Name: opening_cash_balances_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.opening_cash_balances_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.opening_cash_balances_id_seq OWNER TO ambikagold;

--
-- Name: opening_cash_balances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.opening_cash_balances_id_seq OWNED BY public.opening_cash_balances.id;


--
-- Name: ornament_images; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.ornament_images (
    id bigint NOT NULL,
    ornament_id bigint NOT NULL,
    image_url character varying(255) NOT NULL,
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.ornament_images OWNER TO ambikagold;

--
-- Name: ornament_images_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.ornament_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ornament_images_id_seq OWNER TO ambikagold;

--
-- Name: ornament_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.ornament_images_id_seq OWNED BY public.ornament_images.id;


--
-- Name: ornament_purity_tests; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.ornament_purity_tests (
    id bigint NOT NULL,
    ornament_id bigint NOT NULL,
    tested_purity character varying(10) NOT NULL,
    tested_gross_weight numeric NOT NULL,
    tested_deduction_weight numeric,
    tested_net_weight numeric,
    testing_remarks character varying(255),
    tested_by character varying(120) NOT NULL,
    tested_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.ornament_purity_tests OWNER TO ambikagold;

--
-- Name: ornament_purity_tests_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.ornament_purity_tests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ornament_purity_tests_id_seq OWNER TO ambikagold;

--
-- Name: ornament_purity_tests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.ornament_purity_tests_id_seq OWNED BY public.ornament_purity_tests.id;


--
-- Name: ornament_types; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.ornament_types (
    id bigint NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.ornament_types OWNER TO ambikagold;

--
-- Name: ornament_types_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.ornament_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ornament_types_id_seq OWNER TO ambikagold;

--
-- Name: ornament_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.ornament_types_id_seq OWNED BY public.ornament_types.id;


--
-- Name: ornaments; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.ornaments (
    id bigint NOT NULL,
    loan_id bigint NOT NULL,
    name character varying(80) NOT NULL,
    purity character varying(10) NOT NULL,
    gross_weight numeric NOT NULL,
    deduction_weight numeric,
    net_weight numeric,
    quantity bigint DEFAULT 1 NOT NULL,
    gold_value numeric(16,2) DEFAULT 0,
    remarks character varying(255),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.ornaments OWNER TO ambikagold;

--
-- Name: ornaments_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.ornaments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ornaments_id_seq OWNER TO ambikagold;

--
-- Name: ornaments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.ornaments_id_seq OWNED BY public.ornaments.id;


--
-- Name: packet_movements; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.packet_movements (
    id bigint NOT NULL,
    packet_id bigint NOT NULL,
    from_status character varying(30),
    to_status character varying(30) NOT NULL,
    locker_id bigint,
    actor_employee_id bigint,
    remarks character varying(255),
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.packet_movements OWNER TO ambikagold;

--
-- Name: packet_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.packet_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.packet_movements_id_seq OWNER TO ambikagold;

--
-- Name: packet_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.packet_movements_id_seq OWNED BY public.packet_movements.id;


--
-- Name: packets; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.packets (
    id bigint NOT NULL,
    code character varying(30) NOT NULL,
    loan_id bigint NOT NULL,
    status character varying(30) NOT NULL,
    current_locker_id bigint,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.packets OWNER TO ambikagold;

--
-- Name: packets_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.packets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.packets_id_seq OWNER TO ambikagold;

--
-- Name: packets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.packets_id_seq OWNED BY public.packets.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.permissions (
    id bigint NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    module_name character varying(80) NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.permissions OWNER TO ambikagold;

--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permissions_id_seq OWNER TO ambikagold;

--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;


--
-- Name: personal_loan_installments; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.personal_loan_installments (
    id bigint NOT NULL,
    personal_loan_id bigint NOT NULL,
    sequence_no bigint NOT NULL,
    due_date timestamp with time zone NOT NULL,
    amount numeric(16,2) NOT NULL,
    status character varying(15) DEFAULT 'Pending'::character varying NOT NULL,
    paid_amount numeric(16,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.personal_loan_installments OWNER TO ambikagold;

--
-- Name: personal_loan_installments_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.personal_loan_installments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.personal_loan_installments_id_seq OWNER TO ambikagold;

--
-- Name: personal_loan_installments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.personal_loan_installments_id_seq OWNED BY public.personal_loan_installments.id;


--
-- Name: personal_loan_payments; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.personal_loan_payments (
    id bigint NOT NULL,
    personal_loan_id bigint NOT NULL,
    amount numeric(16,2) NOT NULL,
    paid_on timestamp with time zone NOT NULL,
    received_by_employee_id bigint,
    method character varying(30),
    reference character varying(80),
    description character varying(255),
    running_balance numeric(16,2) NOT NULL,
    installment_id bigint,
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.personal_loan_payments OWNER TO ambikagold;

--
-- Name: personal_loan_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.personal_loan_payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.personal_loan_payments_id_seq OWNER TO ambikagold;

--
-- Name: personal_loan_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.personal_loan_payments_id_seq OWNED BY public.personal_loan_payments.id;


--
-- Name: personal_loans; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.personal_loans (
    id bigint NOT NULL,
    loan_number character varying(20),
    branch_id bigint NOT NULL,
    customer_id bigint NOT NULL,
    created_by_employee_id bigint,
    principal_amount numeric(16,2) NOT NULL,
    interest_type character varying(20) NOT NULL,
    interest_value numeric(16,2) NOT NULL,
    interest_amount numeric(16,2) NOT NULL,
    disbursed_amount numeric(16,2) NOT NULL,
    frequency character varying(10) NOT NULL,
    tenure_count bigint NOT NULL,
    installment_amount numeric(16,2) NOT NULL,
    outstanding_amount numeric(16,2) NOT NULL,
    total_paid numeric(16,2) DEFAULT 0 NOT NULL,
    status character varying(20) NOT NULL,
    opened_date timestamp with time zone NOT NULL,
    disbursed_at timestamp with time zone,
    closed_at timestamp with time zone,
    renewed_from_loan_id bigint,
    renewed_to_loan_id bigint,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.personal_loans OWNER TO ambikagold;

--
-- Name: personal_loans_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.personal_loans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.personal_loans_id_seq OWNER TO ambikagold;

--
-- Name: personal_loans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.personal_loans_id_seq OWNED BY public.personal_loans.id;


--
-- Name: purity_standards; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.purity_standards (
    id bigint NOT NULL,
    karat bigint,
    fineness_percent numeric,
    label character varying(40) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.purity_standards OWNER TO ambikagold;

--
-- Name: purity_standards_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.purity_standards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purity_standards_id_seq OWNER TO ambikagold;

--
-- Name: purity_standards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.purity_standards_id_seq OWNED BY public.purity_standards.id;


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.reminders (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    loan_id bigint,
    type character varying(20) NOT NULL,
    due_date timestamp with time zone NOT NULL,
    note character varying(255),
    status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    created_by_employee_id bigint NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.reminders OWNER TO ambikagold;

--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.reminders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reminders_id_seq OWNER TO ambikagold;

--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.reminders_id_seq OWNED BY public.reminders.id;


--
-- Name: request_approvals; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.request_approvals (
    id bigint NOT NULL,
    request_id bigint NOT NULL,
    stage character varying(30) NOT NULL,
    action character varying(20) NOT NULL,
    actor_employee_id bigint NOT NULL,
    remarks character varying(255),
    created_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.request_approvals OWNER TO ambikagold;

--
-- Name: request_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.request_approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.request_approvals_id_seq OWNER TO ambikagold;

--
-- Name: request_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.request_approvals_id_seq OWNED BY public.request_approvals.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.role_permissions (
    id bigint NOT NULL,
    role_id bigint NOT NULL,
    permission_id bigint NOT NULL,
    permission boolean DEFAULT true NOT NULL,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO ambikagold;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.role_permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_permissions_id_seq OWNER TO ambikagold;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.roles (
    id bigint NOT NULL,
    name character varying(60) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.roles OWNER TO ambikagold;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO ambikagold;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.schema_migrations (
    id bigint NOT NULL,
    version character varying(120) NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO ambikagold;

--
-- Name: schema_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.schema_migrations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.schema_migrations_id_seq OWNER TO ambikagold;

--
-- Name: schema_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.schema_migrations_id_seq OWNED BY public.schema_migrations.id;


--
-- Name: schemes; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.schemes (
    id bigint NOT NULL,
    code character varying(20),
    name character varying(120) NOT NULL,
    interest_rate numeric NOT NULL,
    ltv_percent numeric NOT NULL,
    interest_method character varying(80),
    penal_rate numeric,
    conditions text,
    is_active boolean DEFAULT false,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    duration_months bigint,
    branch_id bigint,
    tenant_id bigint NOT NULL
);


ALTER TABLE public.schemes OWNER TO ambikagold;

--
-- Name: schemes_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.schemes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.schemes_id_seq OWNER TO ambikagold;

--
-- Name: schemes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.schemes_id_seq OWNED BY public.schemes.id;


--
-- Name: sequences; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.sequences (
    tenant_id bigint NOT NULL,
    kind character varying(24) NOT NULL,
    last_value bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone
);


ALTER TABLE public.sequences OWNER TO ambikagold;

--
-- Name: superadmin_audit_logs; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.superadmin_audit_logs (
    id bigint NOT NULL,
    super_admin_user_id bigint NOT NULL,
    actor_name character varying(120) NOT NULL,
    action character varying(60) NOT NULL,
    tenant_id bigint,
    tenant_name character varying(160),
    detail text,
    reason text NOT NULL,
    ip_address character varying(64),
    created_at timestamp with time zone
);


ALTER TABLE public.superadmin_audit_logs OWNER TO ambikagold;

--
-- Name: superadmin_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.superadmin_audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.superadmin_audit_logs_id_seq OWNER TO ambikagold;

--
-- Name: superadmin_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.superadmin_audit_logs_id_seq OWNED BY public.superadmin_audit_logs.id;


--
-- Name: superadmin_users; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.superadmin_users (
    id bigint NOT NULL,
    name character varying(120) NOT NULL,
    username character varying(60) NOT NULL,
    password_hash text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


ALTER TABLE public.superadmin_users OWNER TO ambikagold;

--
-- Name: superadmin_users_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.superadmin_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.superadmin_users_id_seq OWNER TO ambikagold;

--
-- Name: superadmin_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.superadmin_users_id_seq OWNED BY public.superadmin_users.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.tenants (
    id bigint NOT NULL,
    name character varying(160) NOT NULL,
    code character varying(32) NOT NULL,
    tier_id bigint NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    subscription_expires_at timestamp with time zone,
    grace_period_ends_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    razorpay_subscription_id character varying(64),
    subscription_notified_at timestamp with time zone
);


ALTER TABLE public.tenants OWNER TO ambikagold;

--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.tenants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tenants_id_seq OWNER TO ambikagold;

--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: tiers; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.tiers (
    id bigint NOT NULL,
    name character varying(60) NOT NULL,
    branch_quota bigint DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    price_in_paise bigint DEFAULT 0 NOT NULL,
    razorpay_plan_id character varying(64)
);


ALTER TABLE public.tiers OWNER TO ambikagold;

--
-- Name: tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.tiers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tiers_id_seq OWNER TO ambikagold;

--
-- Name: tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.tiers_id_seq OWNED BY public.tiers.id;


--
-- Name: uploaded_files; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.uploaded_files (
    tenant_id bigint NOT NULL,
    id bigint NOT NULL,
    storage_key character varying(255) NOT NULL,
    original_name character varying(255),
    content_type character varying(120),
    size_bytes bigint,
    uploaded_by_employee_id bigint,
    created_at timestamp with time zone
);


ALTER TABLE public.uploaded_files OWNER TO ambikagold;

--
-- Name: uploaded_files_id_seq; Type: SEQUENCE; Schema: public; Owner: ambikagold
--

CREATE SEQUENCE public.uploaded_files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.uploaded_files_id_seq OWNER TO ambikagold;

--
-- Name: uploaded_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ambikagold
--

ALTER SEQUENCE public.uploaded_files_id_seq OWNED BY public.uploaded_files.id;


--
-- Name: usage_counters; Type: TABLE; Schema: public; Owner: ambikagold
--

CREATE TABLE public.usage_counters (
    tenant_id bigint NOT NULL,
    category character varying(40) NOT NULL,
    day timestamp with time zone NOT NULL,
    count bigint DEFAULT 0 NOT NULL
);


ALTER TABLE public.usage_counters OWNER TO ambikagold;

--
-- Name: api_key_settings id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.api_key_settings ALTER COLUMN id SET DEFAULT nextval('public.api_key_settings_id_seq'::regclass);


--
-- Name: approval_limits id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.approval_limits ALTER COLUMN id SET DEFAULT nextval('public.approval_limits_id_seq'::regclass);


--
-- Name: auction_decision_requests id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_decision_requests ALTER COLUMN id SET DEFAULT nextval('public.auction_decision_requests_id_seq'::regclass);


--
-- Name: auction_events id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_events ALTER COLUMN id SET DEFAULT nextval('public.auction_events_id_seq'::regclass);


--
-- Name: auction_notices id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_notices ALTER COLUMN id SET DEFAULT nextval('public.auction_notices_id_seq'::regclass);


--
-- Name: auction_records id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_records ALTER COLUMN id SET DEFAULT nextval('public.auction_records_id_seq'::regclass);


--
-- Name: audit_log_entries id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.audit_log_entries ALTER COLUMN id SET DEFAULT nextval('public.audit_log_entries_id_seq'::regclass);


--
-- Name: bank_pledge_events id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.bank_pledge_events ALTER COLUMN id SET DEFAULT nextval('public.bank_pledge_events_id_seq'::regclass);


--
-- Name: bank_pledge_records id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.bank_pledge_records ALTER COLUMN id SET DEFAULT nextval('public.bank_pledge_records_id_seq'::regclass);


--
-- Name: banks id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.banks ALTER COLUMN id SET DEFAULT nextval('public.banks_id_seq'::regclass);


--
-- Name: branches id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);


--
-- Name: cash_movements id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.cash_movements ALTER COLUMN id SET DEFAULT nextval('public.cash_movements_id_seq'::regclass);


--
-- Name: communication_logs id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.communication_logs ALTER COLUMN id SET DEFAULT nextval('public.communication_logs_id_seq'::regclass);


--
-- Name: customer_device_tokens id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.customer_device_tokens ALTER COLUMN id SET DEFAULT nextval('public.customer_device_tokens_id_seq'::regclass);


--
-- Name: customer_otp id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.customer_otp ALTER COLUMN id SET DEFAULT nextval('public.customer_otp_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: dashboard_snapshots id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.dashboard_snapshots ALTER COLUMN id SET DEFAULT nextval('public.dashboard_snapshots_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: gold_rates id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.gold_rates ALTER COLUMN id SET DEFAULT nextval('public.gold_rates_id_seq'::regclass);


--
-- Name: loan_approvals id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_approvals ALTER COLUMN id SET DEFAULT nextval('public.loan_approvals_id_seq'::regclass);


--
-- Name: loan_draft_ornaments id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_draft_ornaments ALTER COLUMN id SET DEFAULT nextval('public.loan_draft_ornaments_id_seq'::regclass);


--
-- Name: loan_drafts id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_drafts ALTER COLUMN id SET DEFAULT nextval('public.loan_drafts_id_seq'::regclass);


--
-- Name: loan_payments id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_payments ALTER COLUMN id SET DEFAULT nextval('public.loan_payments_id_seq'::regclass);


--
-- Name: loan_requests id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_requests ALTER COLUMN id SET DEFAULT nextval('public.loan_requests_id_seq'::regclass);


--
-- Name: loans id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loans ALTER COLUMN id SET DEFAULT nextval('public.loans_id_seq'::regclass);


--
-- Name: lockers id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.lockers ALTER COLUMN id SET DEFAULT nextval('public.lockers_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: opening_cash_balances id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.opening_cash_balances ALTER COLUMN id SET DEFAULT nextval('public.opening_cash_balances_id_seq'::regclass);


--
-- Name: ornament_images id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_images ALTER COLUMN id SET DEFAULT nextval('public.ornament_images_id_seq'::regclass);


--
-- Name: ornament_purity_tests id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_purity_tests ALTER COLUMN id SET DEFAULT nextval('public.ornament_purity_tests_id_seq'::regclass);


--
-- Name: ornament_types id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_types ALTER COLUMN id SET DEFAULT nextval('public.ornament_types_id_seq'::regclass);


--
-- Name: ornaments id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornaments ALTER COLUMN id SET DEFAULT nextval('public.ornaments_id_seq'::regclass);


--
-- Name: packet_movements id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.packet_movements ALTER COLUMN id SET DEFAULT nextval('public.packet_movements_id_seq'::regclass);


--
-- Name: packets id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.packets ALTER COLUMN id SET DEFAULT nextval('public.packets_id_seq'::regclass);


--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);


--
-- Name: personal_loan_installments id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loan_installments ALTER COLUMN id SET DEFAULT nextval('public.personal_loan_installments_id_seq'::regclass);


--
-- Name: personal_loan_payments id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loan_payments ALTER COLUMN id SET DEFAULT nextval('public.personal_loan_payments_id_seq'::regclass);


--
-- Name: personal_loans id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loans ALTER COLUMN id SET DEFAULT nextval('public.personal_loans_id_seq'::regclass);


--
-- Name: purity_standards id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.purity_standards ALTER COLUMN id SET DEFAULT nextval('public.purity_standards_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.reminders ALTER COLUMN id SET DEFAULT nextval('public.reminders_id_seq'::regclass);


--
-- Name: request_approvals id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.request_approvals ALTER COLUMN id SET DEFAULT nextval('public.request_approvals_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: schema_migrations id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.schema_migrations ALTER COLUMN id SET DEFAULT nextval('public.schema_migrations_id_seq'::regclass);


--
-- Name: schemes id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.schemes ALTER COLUMN id SET DEFAULT nextval('public.schemes_id_seq'::regclass);


--
-- Name: superadmin_audit_logs id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.superadmin_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.superadmin_audit_logs_id_seq'::regclass);


--
-- Name: superadmin_users id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.superadmin_users ALTER COLUMN id SET DEFAULT nextval('public.superadmin_users_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: tiers id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.tiers ALTER COLUMN id SET DEFAULT nextval('public.tiers_id_seq'::regclass);


--
-- Name: uploaded_files id; Type: DEFAULT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.uploaded_files ALTER COLUMN id SET DEFAULT nextval('public.uploaded_files_id_seq'::regclass);


--
-- Data for Name: api_key_settings; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.api_key_settings (id, category, name, encrypted_value, created_at, updated_at) FROM stdin;
1	whatsapp	OpenWA local	JwfcvJw8DRO3a5qCIEFRkLDZ0yvk5m09aYvur+OcNxIyU4ottqjPXwkNi/a0w43LZPR57UA6ZDD4yMP6Nnyp56BiyvEz1XbQ3nhszFJhAoTmFs9Lb9tQdrb3wCbnnl+SCYTHAKkhIiG7zf6XrUZianAvNMK3ILnyp6XqudOHhvhXpfPUAzLrIh9lui+wN14QOehf4Zp2ZuNwI85aGqCF2r8imbfArScbPRswOKJJFsqQOzgFzuYvz2B25ZFN2kQHjhNPrMI=	2026-08-13 10:56:29.484181+05:30	2026-08-13 10:56:29.484181+05:30
\.


--
-- Data for Name: approval_limits; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.approval_limits (id, role, max_amount, updated_at, tenant_id) FROM stdin;
1	Loan Operator	50000	2026-08-13 12:28:21.66772+05:30	1
\.


--
-- Data for Name: auction_decision_requests; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.auction_decision_requests (id, auction_record_id, loan_id, kind, triggered_by_payment_id, amount_paid, outstanding_at_request, status, decided_by_employee_id, decided_by_role, decision_remarks, decided_at, created_at, updated_at, tenant_id) FROM stdin;
1	1	1	Shortfall	\N	39800.00	20481.23	PursueBalance	6	Administrator	the due needs to be recoverd	2026-08-14 19:33:41.007821+05:30	2026-08-14 19:33:14.625513+05:30	2026-08-14 19:33:41.011822+05:30	1
2	1	1	PartialRepayment	5	15000.00	5488.33	RemovedFromAuction	6	Administrator		2026-08-15 10:25:59.953519+05:30	2026-08-14 19:37:06.104528+05:30	2026-08-15 10:25:59.960486+05:30	1
3	3	19	PartialRepayment	19	5533.33	0.00	Pending	\N			\N	2026-08-28 17:29:23.791091+05:30	2026-08-28 17:29:23.791091+05:30	1
4	2	7	PartialRepayment	20	5000.00	45025.38	RemovedFromAuction	6	Administrator		2026-08-28 19:04:15.825473+05:30	2026-08-28 17:35:52.050332+05:30	2026-08-28 19:04:15.84644+05:30	1
\.


--
-- Data for Name: auction_events; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.auction_events (id, auction_record_id, action, actor_employee_id, actor_role, remarks, created_at, tenant_id) FROM stdin;
1	1	NoticeIssued	6	Administrator	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:41.21686+05:30	1
2	1	NoticeIssued	6	Administrator	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:53.798328+05:30	1
3	1	Scheduled	6	Administrator	Auction scheduled for 14-Aug-2026 (ref )	2026-08-14 19:32:07.518658+05:30	1
4	1	SaleRecorded	6	Administrator	Sold for ₹40000.00, expenses ₹200.00, net ₹39800.00 applied against debt of ₹60281.23	2026-08-14 19:33:14.629918+05:30	1
5	1	ShortfallEscalated	6	Administrator	Auction proceeds fell short by ₹20481.23 — escalated for a write-off/pursue decision	2026-08-14 19:33:14.632049+05:30	1
6	1	DecisionPursue	6	Administrator	the due needs to be recoverd	2026-08-14 19:33:41.011307+05:30	1
7	1	DecisionRequested	\N		Part-payment of ₹15000.00 received (₹5488.33 still owed) — auction frozen pending a keep/remove decision	2026-08-14 19:37:06.105637+05:30	1
8	1	DecisionRemove	6	Administrator		2026-08-15 10:25:59.957229+05:30	1
9	2	Eligible	6	Administrator	Loan marked auction-eligible	2026-08-28 16:29:22.177272+05:30	1
10	3	Eligible	6	Administrator	Loan marked auction-eligible	2026-08-28 17:18:56.040293+05:30	1
11	3	NoticeIssued	6	Administrator		2026-08-28 17:26:28.305603+05:30	1
12	3	NoticeIssued	6	Administrator		2026-08-28 17:26:57.280403+05:30	1
13	3	Scheduled	6	Administrator	Auction scheduled for 28-Aug-2026 (ref )	2026-08-28 17:27:12.312835+05:30	1
14	3	DecisionRequested	\N		Part-payment of ₹5533.33 received (₹0.00 still owed) — auction frozen pending a keep/remove decision	2026-08-28 17:29:23.793557+05:30	1
15	2	DecisionRequested	\N		Part-payment of ₹5000.00 received (₹45025.38 still owed) — auction frozen pending a keep/remove decision	2026-08-28 17:35:52.050332+05:30	1
16	2	DecisionRemove	6	Administrator		2026-08-28 19:04:15.844316+05:30	1
\.


--
-- Data for Name: auction_notices; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.auction_notices (id, auction_record_id, issued_at, method, remarks, created_at, tenant_id) FROM stdin;
1	1	2026-08-14 19:31:40.901656+05:30	SMS	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:40.902372+05:30	1
2	1	2026-08-14 19:31:40.908929+05:30	WhatsApp	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:40.909828+05:30	1
3	1	2026-08-14 19:31:41.213494+05:30	Registered Post	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:41.214001+05:30	1
4	1	2026-08-14 19:31:53.778542+05:30	SMS	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:53.778542+05:30	1
5	1	2026-08-14 19:31:53.779284+05:30	WhatsApp	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:53.779802+05:30	1
6	1	2026-08-14 19:31:53.797595+05:30	Registered Post	the sanction loan is being defaulted and will be put into auction	2026-08-14 19:31:53.797595+05:30	1
7	3	2026-08-28 17:26:23.208274+05:30	SMS		2026-08-28 17:26:23.208796+05:30	1
8	3	2026-08-28 17:26:23.213334+05:30	WhatsApp		2026-08-28 17:26:23.213837+05:30	1
9	3	2026-08-28 17:26:28.30233+05:30	Registered Post		2026-08-28 17:26:28.30233+05:30	1
10	3	2026-08-28 17:26:51.528205+05:30	SMS		2026-08-28 17:26:51.528205+05:30	1
11	3	2026-08-28 17:26:51.531804+05:30	WhatsApp		2026-08-28 17:26:51.532538+05:30	1
12	3	2026-08-28 17:26:57.279457+05:30	Registered Post		2026-08-28 17:26:57.279817+05:30	1
\.


--
-- Data for Name: auction_records; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.auction_records (id, loan_id, stage, auction_eligible_date, auction_date, auction_reference_number, sale_amount, auction_expenses, surplus_shortfall, final_settlement_status, created_at, updated_at, surplus_payable_amount, surplus_disposition, surplus_paid_out_movement_id, tenant_id) FROM stdin;
1	1	Withdrawn	2026-08-13 18:40:59.896698+05:30	2026-08-14 05:30:00+05:30		40000.00	200.00	-20481.23	Pending	2026-08-13 18:40:59.896698+05:30	2026-08-15 10:25:59.953519+05:30	0.00		\N	1
3	19	AuctionScheduled	2026-08-28 17:18:56.037555+05:30	2026-08-28 05:30:00+05:30		0.00	0.00	0.00	Pending	2026-08-28 17:18:56.037555+05:30	2026-08-28 17:27:12.306907+05:30	0.00		\N	1
2	7	Withdrawn	2026-08-28 16:29:22.170633+05:30	\N		0.00	0.00	0.00	Pending	2026-08-28 16:29:22.171146+05:30	2026-08-28 19:04:15.825473+05:30	0.00		\N	1
\.


--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.audit_log_entries (tenant_id, id, actor_employee_id, actor_name, action, entity_type, entity_id, entity_name, detail, created_at) FROM stdin;
\.


--
-- Data for Name: bank_pledge_events; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.bank_pledge_events (id, bank_pledge_record_id, action, actor_employee_id, actor_role, amount, remarks, created_at, tenant_id) FROM stdin;
1	4	Pledged	6	Administrator	10000.00	Recorded as a re-pledge record only — no cash effect	2026-08-25 08:55:00.994987+05:30	1
2	4	Released	6	Administrator	10000.00	No cash effect — pledge was recorded only	2026-08-25 08:55:25.265579+05:30	1
3	5	Pledged	6	Administrator	100000.00	Pledged amount added to Cash-in-Hand	2026-08-28 10:09:20.883453+05:30	1
4	5	Released	6	Administrator	100000.00	Pledged amount booked back out of Cash-in-Hand	2026-08-28 17:30:13.35322+05:30	1
\.


--
-- Data for Name: bank_pledge_records; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.bank_pledge_records (id, loan_id, bank_name, pledged_amount, pledge_date, release_date, created_at, cash_movement_id, bank_interest_rate, reference_number, bank_id, bank_pledge_due_date, pledged_gross_weight, pledged_net_weight, expense_id, release_cash_movement_id, release_expense_id, cash_treatment, status, voided_at, void_reason, void_cash_movement_id, tenant_id) FROM stdin;
1	3	SBI	900.00	2026-08-10 05:30:00+05:30	2026-08-13 14:15:09.539529+05:30	2026-08-10 18:21:10.893273+05:30	\N	0		4	\N	0	0	\N	\N	\N	CashIn	Active	\N	\N	\N	1
3	8	SBI back	30000.00	2026-08-11 05:30:00+05:30	2026-08-11 11:46:58.743068+05:30	2026-08-11 11:39:52.17907+05:30	\N	\N	\N	1	\N	\N	\N	\N	\N	\N	CashIn	Active	\N	\N	\N	1
2	4	TestBank	900.00	2026-08-10 05:30:00+05:30	2026-08-10 18:29:44.355465+05:30	2026-08-10 18:29:27.158916+05:30	\N	\N	\N	5	\N	\N	\N	\N	\N	\N	CashIn	Active	\N	\N	\N	1
4	19	SBI back	10000.00	2026-08-25 05:30:00+05:30	2026-08-25 08:55:25.25598+05:30	2026-08-25 08:55:00.986545+05:30	\N	10		1	2026-08-30 05:30:00+05:30	1	1	\N	\N	\N	RecordOnly	Released	\N		\N	1
5	19	HDFC	100000.00	2026-08-28 05:30:00+05:30	2026-08-28 17:30:13.342784+05:30	2026-08-28 10:09:20.860101+05:30	37	12		3	\N	1	1	\N	39	4	CashIn	Released	\N		\N	1
\.


--
-- Data for Name: banks; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.banks (id, name, branch, ifsc, created_at, updated_at, phone, account_no, tenant_id) FROM stdin;
1	SBI back			2026-08-11 11:39:43.570664+05:30	2026-08-11 11:39:43.570664+05:30		\N	1
2	SBI bank	Koratty	SBIN00070604	2026-08-11 11:40:35.365937+05:30	2026-08-11 11:40:35.365937+05:30	6742228546	\N	1
3	HDFC			2026-08-11 17:37:29.260046+05:30	2026-08-11 17:37:29.260046+05:30		\N	1
4	SBI			2026-08-15 08:26:28.792088+05:30	2026-08-15 08:26:28.792088+05:30			1
5	TestBank			2026-08-15 08:26:28.794169+05:30	2026-08-15 08:26:28.794169+05:30			1
\.


--
-- Data for Name: branches; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.branches (id, name, code, address, phone, is_active, created_at, updated_at, deleted_at, tenant_id) FROM stdin;
1	Koratty	K021	sdaasdasdasdasda	87654435401	t	2026-08-10 14:08:11.576885+05:30	2026-08-10 14:08:20.244269+05:30	\N	1
\.


--
-- Data for Name: cash_movements; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.cash_movements (id, type, source, purpose, bank, amount, status, occurred_on, created_at, branch_id, tenant_id) FROM stdin;
5	out		Loan disbursement — LN-00007		50000.00		2026-08-11 17:37:02.262351+05:30	2026-08-11 17:37:02.262865+05:30	1	1
8	out		Loan disbursement — LN-00010		90000.00		2026-08-12 18:39:08.582389+05:30	2026-08-12 18:39:08.582389+05:30	1	1
9	out		Loan disbursement — LN-00011		74250.00		2026-08-13 15:41:38.133076+05:30	2026-08-13 15:41:38.133151+05:30	1	1
10	out		Loan disbursement — LN-00012		74250.00		2026-08-13 15:47:21.69824+05:30	2026-08-13 15:47:21.69824+05:30	1	1
11	out		Loan disbursement — LN-00013		50000.00		2026-08-13 15:59:38.180354+05:30	2026-08-13 15:59:38.180354+05:30	1	1
12	in	Collection	Partial — LN-00013		10000.00		2026-08-13 05:30:00+05:30	2026-08-13 18:32:56.150161+05:30	1	1
13	in	Auction	Auction sale proceeds — LN-00001		39800.00		2026-08-14 19:33:14.620648+05:30	2026-08-14 19:33:14.626858+05:30	1	1
14	in	Collection	Partial — LN-00001		15000.00		2026-08-14 05:30:00+05:30	2026-08-14 19:37:06.10236+05:30	1	1
1	in	Savings			50000.00		2026-08-07 16:08:45.604365+05:30	2026-08-07 16:08:45.604365+05:30	1	1
3	out		Vault transfer		20000.00		2026-08-07 16:08:45.858196+05:30	2026-08-07 16:08:45.858196+05:30	1	1
2	in	Loan		South Indian Bank	118000.00	Open	2026-08-07 16:08:45.667051+05:30	2026-08-07 16:08:45.667051+05:30	1	1
4	in	Savings			4455.00		2026-08-11 05:30:00+05:30	2026-08-11 12:19:01.347118+05:30	1	1
6	in	Savings			200000.00		2026-08-12 05:30:00+05:30	2026-08-12 12:15:54.470922+05:30	1	1
7	out		test withdrawal	SBI back	100000.00		2026-08-12 05:30:00+05:30	2026-08-12 12:18:03.740534+05:30	1	1
15	in	Collection	Partial — LN-00001		1.40		2026-08-15 05:30:00+05:30	2026-08-15 14:00:51.729179+05:30	1	1
17	out		Loan disbursement — LN-00015		100000.00		2026-08-17 13:56:59.572645+05:30	2026-08-17 13:56:59.573184+05:30	1	1
18	out		Loan disbursement — LN-00014		100000.00		2026-08-17 14:01:40.919352+05:30	2026-08-17 14:01:40.919352+05:30	1	1
19	out		Loan disbursement — LN-00009		90000.00		2026-08-17 17:04:51.159729+05:30	2026-08-17 17:04:51.161393+05:30	1	1
20	in	Collection	Partial — LN-00015		100000.00		2026-08-17 05:30:00+05:30	2026-08-17 17:58:00.124818+05:30	1	1
16	in	Savings			100000.00		2026-08-17 05:30:00+05:30	2026-08-17 13:55:09.909767+05:30	1	1
21	out		Loan disbursement — LN-00016		10000.00		2026-08-18 15:05:50.711179+05:30	2026-08-18 15:05:50.711179+05:30	1	1
22	out		Loan disbursement — LN-00017		10000.00		2026-08-18 18:10:50.905001+05:30	2026-08-18 18:10:50.905081+05:30	1	1
23	in	Collection	Full Settlement — LN-00017		10000.00		2026-08-18 18:54:01.08198+05:30	2026-08-18 18:54:01.114353+05:30	1	1
24	in	Collection	Partial — LN-00012		10000.00		2026-08-18 19:12:46.721092+05:30	2026-08-18 19:12:46.742559+05:30	1	1
25	in	Collection	Partial — LN-00016		5000.00		2026-08-18 19:39:29.645919+05:30	2026-08-18 19:39:29.662519+05:30	1	1
26	in	Collection	Partial — LN-00012		1000.00		2026-08-19 10:17:24.116659+05:30	2026-08-19 10:17:24.155556+05:30	1	1
27	in	Collection	Partial — LN-00012		10000.00		2026-08-19 10:26:05.528985+05:30	2026-08-19 10:26:05.553944+05:30	1	1
28	in	Collection	Partial — LN-00012		10000.00		2026-08-19 10:40:17.977456+05:30	2026-08-19 10:40:17.982213+05:30	1	1
29	in	Collection	Partial — LN-00011		10000.00		2026-08-19 10:56:58.06215+05:30	2026-08-19 10:56:58.081103+05:30	1	1
30	in	Collection	Partial — LN-00012		10000.00		2026-08-19 11:16:38.01586+05:30	2026-08-19 11:16:38.027644+05:30	1	1
31	out		Loan disbursement — LN-00019		10000.00		2026-08-19 14:44:19.912236+05:30	2026-08-19 14:44:19.912327+05:30	1	1
32	out		Loan disbursement — LN-00018		10000.00		2026-08-19 15:01:13.818008+05:30	2026-08-19 15:01:13.822246+05:30	1	1
33	out		Loan disbursement — LN-00020		10000.00		2026-08-25 08:54:02.392629+05:30	2026-08-25 08:54:02.392716+05:30	1	1
37	in	Bank		HDFC	100000.00		2026-08-28 05:30:00+05:30	2026-08-28 10:09:20.874908+05:30	1	1
34	in	Collection	Partial — LN-00020		10000.00		2026-08-25 05:30:00+05:30	2026-08-25 09:09:55.900792+05:30	1	1
35	in	Collection	Partial — LN-00010		5000.00		2026-08-25 05:30:00+05:30	2026-08-25 13:31:53.000683+05:30	1	1
36	in	Collection	Partial — LN-00019		5000.00		2026-08-25 05:30:00+05:30	2026-08-25 13:32:23.544664+05:30	1	1
38	in	Collection	Partial — LN-00019		5533.33		2026-08-28 05:30:00+05:30	2026-08-28 17:29:23.779689+05:30	1	1
39	out		Bank pledge release — HDFC	HDFC	100000.00		2026-08-28 17:30:13.342784+05:30	2026-08-28 17:30:13.350149+05:30	1	1
40	in	Collection	Partial — LN-00007		5000.00		2026-08-28 05:30:00+05:30	2026-08-28 17:35:52.049266+05:30	1	1
41	in	Collection	Partial — LN-00018		10000.00		2026-08-28 05:30:00+05:30	2026-08-28 18:25:49.825833+05:30	1	1
42	in	Collection	Partial — LN-00007		500.00		2026-08-28 05:30:00+05:30	2026-08-28 19:04:43.955909+05:30	1	1
43	in	Collection	Partial — LN-00007		5000.00		2026-08-28 05:30:00+05:30	2026-08-28 19:29:19.041996+05:30	1	1
\.


--
-- Data for Name: communication_logs; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.communication_logs (id, recipient_name, recipient_phone, chat_id, channel, trigger_type, message_body, related_entity_type, related_entity_id, status, error_message, triggered_by_employee_id, created_at, tenant_id) FROM stdin;
163		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00018. — Ambika Gold Finance	loan	18	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 18:25:49.861186+05:30	1
175			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 11:39:33.671746+05:30	1
177			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 12:39:33.46302+05:30	1
184			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 13:39:33.517695+05:30	1
185			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 13:39:33.521993+05:30	1
190			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 14:39:33.494025+05:30	1
191			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 14:39:33.543831+05:30	1
192			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 15:39:33.452254+05:30	1
193			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 15:39:33.457351+05:30	1
194			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 15:39:33.460001+05:30	1
195			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 15:39:33.471015+05:30	1
196			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 15:39:33.513572+05:30	1
209			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 18:39:33.492636+05:30	1
225			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 13:49:54.826471+05:30	1
164		9856325893	919856325893@c.us	WhatsApp	auction_event	Dear adithyan cloudhouse, following your recent payment, loan LN-00007 has been removed from auction and your pledged gold is no longer at risk. A balance of ₹45025.38 remains payable. — Ambika Gold Finance	auction_record	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 19:04:15.869479+05:30	1
165		9856325893	919856325893@c.us	WhatsApp	payment	Dear adithyan cloudhouse, we have received your payment of ₹500.00 (Partial) towards loan LN-00007. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 19:04:43.976181+05:30	1
25		8078532691	918078532691@c.us	WhatsApp	extension_request	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	4	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:52:46.988061+05:30	1
26		8078532691	918078532691@c.us	WhatsApp	extension_request	Dear adithyan, your extension request for loan LN-00011 has been fully approved. New due date: 13-Mar-2028. — Ambika Gold Finance	loan_request	4	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:52:47.181476+05:30	1
179			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 12:39:33.498246+05:30	1
180			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 12:39:33.502752+05:30	1
182			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 13:39:33.471749+05:30	1
183			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 13:39:33.509376+05:30	1
187			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 14:39:33.472713+05:30	1
188			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 14:39:33.477218+05:30	1
189			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 14:39:33.480717+05:30	1
232			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 15:49:54.725042+05:30	1
237			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 16:49:54.715199+05:30	1
243			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 17:49:54.743+05:30	1
245			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 17:49:54.753804+05:30	1
166		9856325893	919856325893@c.us	WhatsApp	payment	Dear adithyan cloudhouse, we have received your payment of ₹5000.00 (Partial) towards loan LN-00007. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 19:29:19.057411+05:30	1
181			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 12:39:33.545401+05:30	1
235			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 15:49:54.815178+05:30	1
167			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 10:39:33.757694+05:30	1
186			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 13:39:33.588566+05:30	1
212			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	failed	whatsapp: OpenWA returned 401 Unauthorized	\N	2026-09-04 13:27:04.604325+05:30	1
213			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	failed	whatsapp: OpenWA returned 401 Unauthorized	\N	2026-09-04 13:27:04.785538+05:30	1
214			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	failed	whatsapp: OpenWA returned 401 Unauthorized	\N	2026-09-04 13:27:04.79436+05:30	1
215			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	failed	whatsapp: OpenWA returned 401 Unauthorized	\N	2026-09-04 13:27:04.800744+05:30	1
216			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	failed	whatsapp: OpenWA returned 401 Unauthorized	\N	2026-09-04 13:27:04.808261+05:30	1
236			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 15:49:54.816753+05:30	1
168			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 10:39:33.757694+05:30	1
197			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 16:39:33.467875+05:30	1
199			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 16:39:33.49042+05:30	1
217			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 12:49:54.715918+05:30	1
223			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 13:49:54.778331+05:30	1
224			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 13:49:54.785897+05:30	1
226			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 13:49:54.847102+05:30	1
227			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 14:49:54.722748+05:30	1
228			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 14:49:54.727063+05:30	1
240			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 16:49:54.844101+05:30	1
241			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 16:49:54.846161+05:30	1
242			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 17:49:54.709496+05:30	1
244			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 17:49:54.746625+05:30	1
169			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 10:39:33.777052+05:30	1
198			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 16:39:33.485286+05:30	1
200			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 16:39:33.580325+05:30	1
201			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 16:39:33.58394+05:30	1
218			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 12:49:54.754891+05:30	1
219			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 12:49:54.811867+05:30	1
246			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 17:49:54.756731+05:30	1
170			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 10:39:33.816501+05:30	1
202			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 17:39:33.465956+05:30	1
220			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 12:49:54.815479+05:30	1
171			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 10:39:33.936664+05:30	1
203			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 17:39:33.500739+05:30	1
204			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 17:39:33.551801+05:30	1
205			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 17:39:33.554415+05:30	1
206			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 17:39:33.556165+05:30	1
221			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 12:49:54.826265+05:30	1
222			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 13:49:54.77708+05:30	1
229			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 14:49:54.748921+05:30	1
230			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 14:49:54.80268+05:30	1
231			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 14:49:54.804737+05:30	1
233			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 15:49:54.735884+05:30	1
234			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 15:49:54.74445+05:30	1
238			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 16:49:54.790799+05:30	1
239			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-09-07 16:49:54.818522+05:30	1
172			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 11:39:33.452496+05:30	1
176			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 11:39:33.67593+05:30	1
178			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 12:39:33.495229+05:30	1
1		21121154544	21121154544@c.us	WhatsApp	auction_event	Dear adithyan cloudhouse, following your recent payment, loan LN-00001 has been removed from auction and your pledged gold is no longer at risk. A balance of ₹5488.33 remains payable. — Ambika Gold Finance	auction_record	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-15 10:26:06.439624+05:30	1
2		21121154544	21121154544@c.us	WhatsApp	payment	Dear adithyan cloudhouse, we have received your payment of ₹1.40 towards loan LN-00001. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-15 14:00:58.408094+05:30	1
3	Admin	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance password reset code is 549935. It expires in 10 minutes. Do not share this code with anyone.	employee	6	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-17 11:51:15.783182+05:30	1
4		9999999999	919999999999@c.us	WhatsApp	loan_submission	Dear Test Cust, your gold loan application LN-00015 for ₹100000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	15	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-17 13:56:15.76582+05:30	1
5		9999999999	919999999999@c.us	WhatsApp	loan_sanction	Dear Test Cust, your gold loan LN-00015 has been sanctioned and ₹100000.00 has been disbursed. Due date: 17-Aug-2027. — Ambika Gold Finance	loan	15	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-17 13:56:59.584321+05:30	1
6		9999999999	919999999999@c.us	WhatsApp	loan_sanction	Dear Test Cust, your gold loan LN-00014 has been sanctioned and ₹100000.00 has been disbursed. Due date: 17-Aug-2027. — Ambika Gold Finance	loan	14	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-17 14:01:40.935669+05:30	1
7		21121154544	21121154544@c.us	WhatsApp	loan_sanction	Dear adithyan cloudhouse, your gold loan LN-00009 has been sanctioned and ₹90000.00 has been disbursed. Due date: 12-Aug-2027. — Ambika Gold Finance	loan	9	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-17 17:04:57.11436+05:30	1
8	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 540326. It expires in 5 minutes. Do not share this code with anyone.	customer	5	sent		\N	2026-08-18 14:00:11.754654+05:30	1
9	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 669990. It expires in 5 minutes. Do not share this code with anyone.	customer	5	sent		\N	2026-08-18 14:06:46.781698+05:30	1
10		8078532691	918078532691@c.us	WhatsApp	loan_submission	Dear adithyan, your gold loan application LN-00016 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	16	sent		\N	2026-08-18 15:04:57.544536+05:30	1
11		8078532691	918078532691@c.us	WhatsApp	loan_sanction	Dear adithyan, your gold loan LN-00016 has been sanctioned and ₹10000.00 has been disbursed. Due date: 18-Aug-2027. — Ambika Gold Finance	loan	16	sent		\N	2026-08-18 15:05:56.1143+05:30	1
12		8078532691	918078532691@c.us	WhatsApp	loan_submission	Dear adithyan, your gold loan application LN-00017 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	17	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 18:08:08.720102+05:30	1
13		8078532691	918078532691@c.us	WhatsApp	loan_approval	Dear adithyan, your gold loan application LN-00017 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	17	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 18:09:51.28505+05:30	1
14		8078532691	918078532691@c.us	WhatsApp	loan_approval	Dear adithyan, your gold loan application LN-00017 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	17	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 18:10:04.692237+05:30	1
15		8078532691	918078532691@c.us	WhatsApp	loan_sanction	Dear adithyan, your gold loan LN-00017 has been sanctioned and ₹10000.00 has been disbursed. Due date: 18-Aug-2027. — Ambika Gold Finance	loan	17	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 18:10:50.916702+05:30	1
16		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹10000.00 (Full Settlement) towards loan LN-00017. — Ambika Gold Finance	loan	17	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 18:54:01.17209+05:30	1
17		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:12:46.773212+05:30	1
18		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹5000.00 (Partial) towards loan LN-00016. — Ambika Gold Finance	loan	16	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:39:29.692097+05:30	1
19			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:48:26.442331+05:30	1
20			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:48:26.463783+05:30	1
21		8078532691	918078532691@c.us	WhatsApp	extension_request	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Branch Manager). — Ambika Gold Finance	loan_request	3	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:50:20.176764+05:30	1
22		8078532691	918078532691@c.us	WhatsApp	extension_request	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	3	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:50:20.989345+05:30	1
23		8078532691	918078532691@c.us	WhatsApp	extension_request	Dear adithyan, your extension request for loan LN-00011 has been fully approved. New due date: 13-Nov-2027. — Ambika Gold Finance	loan_request	3	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:50:21.724343+05:30	1
24		8078532691	918078532691@c.us	WhatsApp	extension_request	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Branch Manager). — Ambika Gold Finance	loan_request	4	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 19:52:46.726728+05:30	1
27	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 248669. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-18 20:14:55.439499+05:30	1
28	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 736891. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-18 20:18:46.248995+05:30	1
29	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 059098. It expires in 5 minutes. Do not share this code with anyone.	customer	5	sent		\N	2026-08-18 20:20:13.532333+05:30	1
30	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 203495. It expires in 5 minutes. Do not share this code with anyone.	customer	5	sent		\N	2026-08-18 20:26:29.218473+05:30	1
31		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹1000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	sent		\N	2026-08-19 10:17:30.008077+05:30	1
32			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 10:24:24.348841+05:30	1
33			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 10:24:29.851046+05:30	1
34		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	sent		\N	2026-08-19 10:26:10.024559+05:30	1
35		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	sent		\N	2026-08-19 10:40:22.718745+05:30	1
36		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00011. — Ambika Gold Finance	loan	11	sent		\N	2026-08-19 10:57:03.111095+05:30	1
37		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	sent		\N	2026-08-19 11:16:43.433906+05:30	1
38			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 11:24:24.235124+05:30	1
39			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 11:24:29.063628+05:30	1
40		8078532691	918078532691@c.us	WhatsApp	loan_submission	Dear adithyan, your gold loan application LN-00018 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	18	sent		\N	2026-08-19 14:25:39.95628+05:30	1
41	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 157934. It expires in 5 minutes. Do not share this code with anyone.	customer	5	sent		\N	2026-08-19 14:27:10.616007+05:30	1
42	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 787807. It expires in 5 minutes. Do not share this code with anyone.	customer	5	sent		\N	2026-08-19 14:28:04.14683+05:30	1
43		8078532691	918078532691@c.us	WhatsApp	loan_submission	Dear adithyan, your gold loan application LN-00019 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	19	sent		\N	2026-08-19 14:39:01.982483+05:30	1
44		8078532691	918078532691@c.us	WhatsApp	loan_approval	Dear adithyan, your gold loan application LN-00019 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	19	sent		\N	2026-08-19 14:40:23.925743+05:30	1
45		8078532691	918078532691@c.us	WhatsApp	loan_approval	Dear adithyan, your gold loan application LN-00019 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	19	sent		\N	2026-08-19 14:42:46.576562+05:30	1
46		8078532691	918078532691@c.us	WhatsApp	loan_sanction	Dear adithyan, your gold loan LN-00019 has been sanctioned and ₹10000.00 has been disbursed. Due date: 19-Aug-2027. — Ambika Gold Finance	loan	19	sent		\N	2026-08-19 14:44:24.612954+05:30	1
47		8078532691	918078532691@c.us	WhatsApp	loan_approval	Dear adithyan, your gold loan application LN-00018 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	18	sent		\N	2026-08-19 15:01:06.640777+05:30	1
48		8078532691	918078532691@c.us	WhatsApp	loan_approval	Dear adithyan, your gold loan application LN-00018 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	18	sent		\N	2026-08-19 15:01:12.034207+05:30	1
49		8078532691	918078532691@c.us	WhatsApp	loan_sanction	Dear adithyan, your gold loan LN-00018 has been sanctioned and ₹10000.00 has been disbursed. Due date: 19-Aug-2027. — Ambika Gold Finance	loan	18	sent		\N	2026-08-19 15:01:19.372152+05:30	1
50			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 15:59:52.018747+05:30	1
51			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 15:59:56.365582+05:30	1
52			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 16:59:50.98824+05:30	1
53			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 16:59:56.622889+05:30	1
54			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 17:59:50.684313+05:30	1
55			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 17:59:55.191105+05:30	1
56			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 18:59:50.697546+05:30	1
57			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-19 18:59:56.290851+05:30	1
58	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 768288. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-24 12:56:51.320348+05:30	1
59	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 580827. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 12:59:52.175865+05:30	1
60	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 680316. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 12:59:54.238294+05:30	1
61	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 788106. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:00:49.820872+05:30	1
62	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 212166. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:00:50.887941+05:30	1
63	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 390208. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:00:51.501237+05:30	1
64	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 489659. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:00:51.919009+05:30	1
65	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 955210. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:00:55.45043+05:30	1
66	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 342401. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:00:59.368569+05:30	1
67	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 693967. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:01:42.819289+05:30	1
68	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 410492. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:01:43.633552+05:30	1
69	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 803004. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:01:43.995012+05:30	1
70	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 073843. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:01:44.333887+05:30	1
71	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 625243. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:01:44.632324+05:30	1
72	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 933350. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: OpenWA returned 409 Conflict	\N	2026-08-24 13:01:44.974784+05:30	1
73	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 699441. It expires in 5 minutes. Do not share this code with anyone.	customer	5	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": context deadline exceeded (Client.Timeout exceeded while awaiting headers)	\N	2026-08-24 13:02:13.954326+05:30	1
74	adithyan	8078532691	918078532691@c.us	WhatsApp	otp	Your Ambika Gold Finance app sign-in code is 663853. It expires in 5 minutes. Do not share this code with anyone.	customer	5	sent		\N	2026-08-24 13:03:11.53813+05:30	1
75			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 13:27:16.203955+05:30	1
76			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 13:27:20.967638+05:30	1
77			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 14:32:05.822507+05:30	1
78			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 14:32:10.797701+05:30	1
79			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 16:29:42.572023+05:30	1
80			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 16:29:48.288747+05:30	1
81			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 16:30:03.171107+05:30	1
82			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 16:30:07.672977+05:30	1
83		21121154544	21121154544@c.us	WhatsApp	loan_submission	Dear adithyan cloudhouse, your gold loan application LN-00020 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	20	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-24 16:51:51.007629+05:30	1
84		21121154544	21121154544@c.us	WhatsApp	loan_approval	Dear adithyan cloudhouse, your gold loan application LN-00020 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	20	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-24 16:52:07.685985+05:30	1
85		21121154544	21121154544@c.us	WhatsApp	loan_approval	Dear adithyan cloudhouse, your gold loan application LN-00020 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	20	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-24 16:52:14.727502+05:30	1
86			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 17:29:43.304315+05:30	1
87			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 17:29:48.790292+05:30	1
88			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 17:30:03.271595+05:30	1
89			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 17:30:08.794571+05:30	1
90			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 18:29:43.105812+05:30	1
91			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 18:29:47.851298+05:30	1
92			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 19:16:48.068864+05:30	1
93			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 19:16:52.741309+05:30	1
94			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 19:29:43.572662+05:30	1
95			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 19:29:49.30622+05:30	1
96			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 20:29:43.011273+05:30	1
97			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 20:29:48.380667+05:30	1
98			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 21:14:08.492001+05:30	1
99			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 21:14:13.763193+05:30	1
100			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 21:29:42.907515+05:30	1
156		8078532691	918078532691@c.us	WhatsApp	release_request	Dear adithyan, your gold release request for loan LN-00019 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	6	sent		\N	2026-08-28 17:33:52.909727+05:30	1
101			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-24 21:29:47.92143+05:30	1
102			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 07:59:40.067814+05:30	1
103			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 07:59:40.10153+05:30	1
104		21121154544	21121154544@c.us	WhatsApp	loan_sanction	Dear adithyan cloudhouse, your gold loan LN-00020 has been sanctioned and ₹10000.00 has been disbursed. Due date: 24-Aug-2027. — Ambika Gold Finance	loan	20	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 08:54:02.411987+05:30	1
105			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 08:59:39.812767+05:30	1
106			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 08:59:39.848239+05:30	1
107		21121154544	21121154544@c.us	WhatsApp	payment	Dear adithyan cloudhouse, we have received your payment of ₹10000.00 (Partial) towards loan LN-00020. — Ambika Gold Finance	loan	20	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 09:09:55.943909+05:30	1
108			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 10:09:01.313278+05:30	1
109			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 10:09:01.354318+05:30	1
110			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 11:09:01.273596+05:30	1
111			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 11:09:01.289921+05:30	1
112			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 12:09:01.251543+05:30	1
113			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 12:09:01.270505+05:30	1
114			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 13:09:01.228091+05:30	1
115			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 13:09:01.240902+05:30	1
116		21121154544	21121154544@c.us	WhatsApp	payment	Dear adithyan cloudhouse, we have received your payment of ₹5000.00 (Partial) towards loan LN-00010. — Ambika Gold Finance	loan	10	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 13:31:53.027055+05:30	1
117		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹5000.00 (Partial) towards loan LN-00019. — Ambika Gold Finance	loan	19	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 13:32:23.566664+05:30	1
118			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 14:53:14.23171+05:30	1
119			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 14:53:14.25882+05:30	1
120			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 15:53:14.210415+05:30	1
121			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 15:53:14.23923+05:30	1
122			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 17:19:30.394292+05:30	1
123			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-25 17:19:30.41141+05:30	1
157		8078532691	918078532691@c.us	WhatsApp	release_request	Dear adithyan, your gold release request for loan LN-00019 has been fully approved. Closure is now being processed. — Ambika Gold Finance	loan_request	6	sent		\N	2026-08-28 17:34:07.845048+05:30	1
124		8078532691	918078532691@c.us	WhatsApp	release_request	Dear adithyan, your gold release request for loan LN-00018 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	5	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 10:11:15.206011+05:30	1
125		8078532691	918078532691@c.us	WhatsApp	release_request	Dear adithyan, your gold release request for loan LN-00018 has been fully approved. Closure is now being processed. — Ambika Gold Finance	loan_request	5	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 10:11:29.795186+05:30	1
126		9856325893	919856325893@c.us	WhatsApp	loan_submission	Dear adithyan cloudhouse, your gold loan application LN-00021 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	21	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 10:14:31.227465+05:30	1
127			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 11:06:16.750982+05:30	1
128			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 11:06:16.793361+05:30	1
129			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 13:36:23.040173+05:30	1
130			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 13:36:23.085587+05:30	1
131			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 13:36:23.141183+05:30	1
132			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 13:36:23.158344+05:30	1
147			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-28 16:42:13.712166+05:30	1
133			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 13:36:23.166998+05:30	1
134			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 14:42:13.3684+05:30	1
135			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 14:42:13.411187+05:30	1
136			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 14:42:13.418722+05:30	1
137			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 14:42:13.426729+05:30	1
158		9856325893	919856325893@c.us	WhatsApp	payment	Dear adithyan cloudhouse, we have received your payment of ₹5000.00 towards loan LN-00007. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — Ambika Gold Finance	loan	7	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-28 17:35:58.425023+05:30	1
138			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 14:42:13.434596+05:30	1
139		9856325893	919856325893@c.us	WhatsApp	loan_approval	Dear adithyan cloudhouse, your gold loan application LN-00021 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	21	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 15:29:49.974735+05:30	1
140			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 15:42:13.406459+05:30	1
141			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 15:42:13.42992+05:30	1
142			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 15:42:13.442526+05:30	1
143			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 15:42:13.455593+05:30	1
144			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 15:42:13.468532+05:30	1
145		9856325893	919856325893@c.us	WhatsApp	auction_event	Dear adithyan cloudhouse, your gold loan LN-00007 is seriously overdue and has now been marked eligible for auction. Outstanding: ₹50025.38. Please contact the branch immediately to settle and retain your pledged items. — Ambika Gold Finance	auction_record	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-28 16:29:22.183911+05:30	1
146			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-28 16:42:13.686481+05:30	1
148			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-28 16:42:13.723974+05:30	1
149			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-28 16:42:13.73677+05:30	1
150			@c.us	WhatsApp	loan_overdue	Dear adithyan, your gold loan LN-00019 is now overdue (due date 14-Jul-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	19	failed	whatsapp: OpenWA returned 400 Bad Request	\N	2026-08-28 16:42:13.752954+05:30	1
151		8078532691	918078532691@c.us	WhatsApp	auction_event	Dear adithyan, your gold loan LN-00019 is seriously overdue and has now been marked eligible for auction. Outstanding: ₹5533.33. Please contact the branch immediately to settle and retain your pledged items. — Ambika Gold Finance	auction_record	3	sent		\N	2026-08-28 17:19:01.844707+05:30	1
152		8078532691	918078532691@c.us	WhatsApp	auction_notice	Dear adithyan, your gold loan LN-00019 is overdue and has been marked for auction. Please contact the branch immediately to settle dues and avoid losing your pledged items.	auction_record	3	sent		\N	2026-08-28 17:26:28.300408+05:30	1
153		8078532691	918078532691@c.us	WhatsApp	auction_notice	Dear adithyan, your gold loan LN-00019 is overdue and has been marked for auction. Please contact the branch immediately to settle dues and avoid losing your pledged items.	auction_record	3	sent		\N	2026-08-28 17:26:57.271939+05:30	1
154		8078532691	918078532691@c.us	WhatsApp	auction_event	Dear adithyan, the auction of the gold pledged against loan LN-00019 has been scheduled for 28-Aug-2026 (ref ). You may still settle the outstanding dues before this date to reclaim your items. — Ambika Gold Finance	auction_record	3	sent		\N	2026-08-28 17:27:17.165664+05:30	1
155		8078532691	918078532691@c.us	WhatsApp	payment	Dear adithyan, we have received your payment of ₹5533.33 towards loan LN-00019. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — Ambika Gold Finance	loan	19	sent		\N	2026-08-28 17:29:28.190671+05:30	1
159			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-28 17:42:18.624371+05:30	1
160			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-28 17:42:23.002865+05:30	1
161			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-28 17:42:28.710242+05:30	1
162			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: OpenWA returned 500 Internal Server Error	\N	2026-08-28 17:42:33.352451+05:30	1
173			@c.us	WhatsApp	loan_overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 11:39:33.637037+05:30	1
174			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 11:39:33.646894+05:30	1
207			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 18:39:33.465018+05:30	1
208			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 18:39:33.492636+05:30	1
210			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 18:39:33.602911+05:30	1
211			@c.us	WhatsApp	loan_overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	failed	whatsapp: request to OpenWA failed: Post "http://localhost:2785/api/sessions/c7df8e6b-d461-4eec-8fb1-25d0d6212301/messages/send-text": dial tcp [::1]:2785: connectex: No connection could be made because the target machine actively refused it.	\N	2026-08-29 18:39:33.604452+05:30	1
\.


--
-- Data for Name: customer_device_tokens; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.customer_device_tokens (id, customer_id, device_id, token_hash, created_at, revoked_at, last_used_at, tenant_id) FROM stdin;
1	5	android-1787042276669-ujtn47k4v4	5b9daa524fd923931ea07fb15f6e023fd593f5237c45aec3fc83f11959168df5	2026-08-18 14:07:27.219352+05:30	2026-08-18 20:20:34.113684+05:30	2026-08-18 18:25:22.188908+05:30	1
2	5	android-1787042276669-ujtn47k4v4	293c07ffac4b2d31e53e5e4717ac2e48a3088c71baa511b19ec6fcd9661c8bb4	2026-08-18 20:20:34.13251+05:30	2026-08-18 20:26:42.597287+05:30	\N	1
3	5	android-1787042276669-ujtn47k4v4	de7fcce999dc22d2ed6ae08b55d1b6048b7c6c6bc438be3ae4b1f7683fe0f721	2026-08-18 20:26:42.598985+05:30	2026-08-24 13:03:41.683435+05:30	2026-08-19 14:26:57.19267+05:30	1
4	5	android-1787042276669-ujtn47k4v4	a64393eb498b72261ba528dce53b64caddf207fa1469908df2ba7f3f7700f429	2026-08-24 13:03:41.690433+05:30	\N	2026-08-24 16:20:25.654017+05:30	1
\.


--
-- Data for Name: customer_otp; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.customer_otp (id, phone, code_hash, expires_at, attempts, created_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.customers (id, code, name, phone, dob, address, branch_id, photo_url, identity_proof_url, address_proof_url, kyc_document_url, pan, aadhaar_last4, aadhaar_encrypted, nominee_name, nominee_relation, nominee_phone, kyc_status, pan_status, aadhaar_status, created_at, updated_at, deleted_at, digilocker_request_id, tenant_id, father_name, district, taluk, village, place, pin_code, age) FROM stdin;
3	CUST-03	adithyan cloudhouse	9856325893	2004-01-10 05:30:00+05:30	indeevaram	1		/uploads/e39f91ae5ac107cb-images.jfif			ABCDE1234A	2121	wxqPOOL70gdlMPOnsz62tCTq2NSaiHf2j3EiReJAyp9mrfvS19Ng/g==				Verified	Verified	Verified	2026-08-10 14:37:07.778432+05:30	2026-08-25 15:48:20.74196+05:30	\N		1	\N	\N	\N	\N	\N	\N	\N
1	CUST-01	Test Customer Updated	9999999999	1990-01-01 05:30:00+05:30	New address	1					ABCDE1234A	9012	EkjCt6bWSLEYpQUEMs1h654jBKwweljZok7Kd2/4bPzIiAWTstuSOg==				Verified	Verified	Verified	2026-08-10 14:11:56.070615+05:30	2026-08-10 14:12:06.69288+05:30	2026-08-10 14:12:32.650652+05:30	\N	1	\N	\N	\N	\N	\N	\N	\N
2	CUST-02	Anil Varma	9876543210	1985-06-15 05:30:00+05:30	Koratty, Thrissur	1	/uploads/3e5c2c0ee21b47dd-photo.png				abcde1234f	7777	KjESGRwclxiUG2gfAAFE+khmtCx/IhpsEmvOzEFnxmvopBPk6aVT0g==	Priya Varma	Spouse	9876500000	Verified	Verified	Verified	2026-08-10 14:26:05.564963+05:30	2026-08-10 14:26:05.564963+05:30	2026-08-10 14:26:42.279584+05:30	\N	1	\N	\N	\N	\N	\N	\N	\N
4	CUST-04	Test Cust	9999999999	0001-01-01 05:53:28+05:53:28		1											Verified	Verified	Verified	2026-08-10 18:28:08.789093+05:30	2026-08-10 18:28:08.789093+05:30	\N	\N	1	\N	\N	\N	\N	\N	\N	\N
6	CUST-06	Akhil Joshy	09048300196	2026-06-13 05:30:00+05:30	Kottekulam-Tazhakottukaavu Road, 678703, Erimayur-I, Alathur, Palakkad, Kerala, India fgxdfgdd	1											Verified	Verified	Verified	2026-08-13 15:48:55.549282+05:30	2026-08-13 15:48:55.549282+05:30	\N	\N	1	\N	\N	\N	\N	\N	\N	\N
7	CUST-07	Pan Verification	98563256987	2004-02-13 05:30:00+05:30	indeevaram	1					PAN1234234	5145	3xCBog+O/hm6xMNFQ1Mdm9v1ZC7OlQic8tHdXCZi0VwHDLb196w3Cw==				Verified	Verified	Verified	2026-08-14 13:28:59.805053+05:30	2026-08-14 13:28:59.805053+05:30	\N	\N	1	\N	\N	\N	\N	\N	\N	\N
8	CUST-08	pan verification sandbox	78987542311	2024-07-04 05:30:00+05:30	indeevaram	1					ABCDE1234A	0019	JBambINSR0OvQOQ2dTD3wHzAqA210tXwEofG7kGkKHctyZ5YPnR8Ow==				Verified	Verified	Pending	2026-08-14 14:24:58.952583+05:30	2026-08-14 14:52:58.383225+05:30	\N	41864e34-1b19-4326-b87b-bc859459b783	1	\N	\N	\N	\N	\N	\N	\N
11	CUST-11	adithyan cloudhouse	9856325893	2004-01-10 05:30:00+05:30	indeevaram	1					ABCDE1234A	6522	3I3lK5VaxlTSixa9pNaRtA77p7sB1dcQw7YyIkYLJfVif1hRg3f1kQ==				Pending	Verified	Pending	2026-08-25 09:29:32.881196+05:30	2026-08-28 15:02:39.915367+05:30	\N	78fefd85-a454-406f-aa21-ffb0e9229f73	1	\N	\N	\N	\N	\N	\N	\N
5	CUST-05	adithyan	8078532691	2004-01-29 05:30:00+05:30	indeevaram	1	/uploads/7528c5846d28eccf-upload_1787063874353_1000088108.jpg										Verified	Verified	Verified	2026-08-13 15:39:55.974129+05:30	2026-08-18 20:07:30.727263+05:30	\N		1	\N	\N	\N	\N	\N	\N	\N
9	CUST-09	Anil Varma	9494488189	2004-08-02 05:30:00+05:30	123 Street	1					ABCDE123A	6522	yZ8taqyKjOCQvb7pwfYPn+LFcIgdFtOFht+3soChWbaj0/KniYwuGA==				Failed	Failed	Verified	2026-08-17 17:21:14.135279+05:30	2026-08-25 13:20:35.203203+05:30	\N		1	\N	\N	\N	\N	\N	\N	\N
10	CUST-10	archana	9856235698	2026-08-03 05:30:00+05:30	indeevaram	1	/uploads/060dce96723e5cb9-marvels-spider-man-3840x2160-11990.jpeg	/uploads/ba36848e1b52f760-PROCESS_FLOW-_India.pdf	/uploads/f3ad1dac37ff7b06-images.jfif	/uploads/f4828a061a481858-PROCESS_FLOW-_India.pdf	ABCD123B	7855	ASf6JHU+bZK5LmhDGQMe7/VWeSdLiDk54dXa8FZOm5tGItwPpoHgaA==				Failed	Failed	Pending	2026-08-24 12:36:04.38844+05:30	2026-08-25 13:20:53.380563+05:30	\N	887d2255-f4b6-44dd-a007-66bb1670bbee	1	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: dashboard_snapshots; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.dashboard_snapshots (id, date, active_count, overdue_count, pending_approval_count, opened_today_count, due_today_count, created_at) FROM stdin;
1	2026-09-04 00:00:00+05:30	12	0	3	0	0	2026-09-04 14:39:55.396234+05:30
2	2026-09-07 00:00:00+05:30	12	0	3	0	0	2026-09-07 11:49:54.730912+05:30
\.


--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.employees (id, code, name, role, phone, loans_processed, collections, followups, pending, created_at, updated_at, deleted_at, branch_id, email, password_hash, password_reset_token_hash, password_reset_expires_at, username, role_id, tenant_id) FROM stdin;
9	EMP-04	Suresh Pillai (Management)	Management	\N	\N	\N	\N	\N	2026-08-12 09:57:51.867554+05:30	2026-08-12 09:57:51.867554+05:30	\N	1	management.test@ambikagold.test	$2a$10$YWf0GFnCQmyQ5ZTCE5wmpu0/rWL/.SGYFNHftx5Y3l3oEdBJVcuZ6	\N	\N	sureshpillai	2	1
13	EMP-09	Management	Management	8985654541	0	0	0	0	2026-08-13 11:59:29.207091+05:30	2026-08-13 11:59:29.207091+05:30	\N	1		$2a$12$JfJKBarBEOziRlL.Sj38WupHTQNRPY0aaOMtbqK/HNEDI5caVolmm		\N	Management	2	1
5	EMP-01	Arun Kumar	Branch Manager	1223356556	0	0	0	0	2026-08-10 17:33:32.666121+05:30	2026-08-10 17:33:40.442038+05:30	\N	1	\N	$2a$10$YWf0GFnCQmyQ5ZTCE5wmpu0/rWL/.SGYFNHftx5Y3l3oEdBJVcuZ6	\N	\N	arunkumar	3	1
7	EMP-02	Priya Nair (Branch Manager)	Branch Manager	\N	\N	\N	\N	\N	2026-08-12 09:57:51.867554+05:30	2026-08-12 09:57:51.867554+05:30	\N	1	branchmanager.test@ambikagold.test	$2a$10$YWf0GFnCQmyQ5ZTCE5wmpu0/rWL/.SGYFNHftx5Y3l3oEdBJVcuZ6	\N	\N	priyanair	3	1
14	EMP-10	Branch Manager	Branch Manager	8985654543	0	0	0	0	2026-08-13 12:00:06.173794+05:30	2026-08-13 12:00:06.173794+05:30	\N	1		$2a$12$BT2Rdd8NCYp/UuxNABmzVukfOxPGbK1Zb1UcuOJBSq47od/uGIV4m		\N	BrnManager	3	1
8	EMP-03	Ravi Menon (Loan Operator)	Loan Operator	\N	\N	\N	\N	\N	2026-08-12 09:57:51.867554+05:30	2026-08-12 09:57:51.867554+05:30	\N	1	staff.test@ambikagold.test	$2a$10$YWf0GFnCQmyQ5ZTCE5wmpu0/rWL/.SGYFNHftx5Y3l3oEdBJVcuZ6	\N	\N	ravimenon	4	1
15	EMP-11	LoanOperator	Loan Operator	8985654546	0	0	0	0	2026-08-13 12:00:43.537686+05:30	2026-08-13 12:00:43.537686+05:30	\N	1		$2a$12$lXINKEyf18QtSBa/pU73leVNTRuSoxQWEQefoiU5seZ5fuoBEoUZu		\N	LoanOpr	4	1
10	EMP-06	testemp	Cashier	8958635978	0	0	0	0	2026-08-12 16:30:33.650099+05:30	2026-08-12 16:30:33.650099+05:30	\N	1				\N		5	1
11	EMP-07	Empnew	Cashier	9875321463	0	0	0	0	2026-08-12 17:06:15.81598+05:30	2026-08-12 17:06:15.81598+05:30	\N	1		$2a$12$sAul3/5C1.V.YtXmdw9YMObOpIldMnU2TwtP8sR8w562ElUw55D0C		\N	Empnew	5	1
16	EMP-12	Accountant	Accountant	8985654548	0	0	0	0	2026-08-13 12:01:07.325604+05:30	2026-08-13 12:01:07.325604+05:30	\N	1		$2a$12$GIawTqMh0sIwbxtuAlOtiuI.rhqkn74dU2oAgFX1geJ9XYCVpAfQO		\N	Accountant	6	1
17	EMP-13	Collection Staff	Collection Staff	8985654549	0	0	0	0	2026-08-13 12:01:34.682039+05:30	2026-08-13 12:01:34.682039+05:30	\N	1		$2a$12$pXbh7oo6ukricLkg1eFWj.SCjPDOVrCgnnAvT20KkeTvmRLdthb1i		\N	CollStaff	7	1
18	EMP-14	Auction Manager	Auction Administrator	8985654544	0	0	0	0	2026-08-13 12:02:05.860742+05:30	2026-08-13 12:02:05.860742+05:30	\N	1		$2a$12$D3FZQjTTod7z14JBRs/JKODBuZClNe3bNdSgLl/PJRNBErP9fNBnG		\N	AucMgr	8	1
12	EMP-08	Cashier	Cashier	8985654542	0	0	0	0	2026-08-13 11:58:43.838427+05:30	2026-08-13 11:58:43.838427+05:30	\N	1		$2a$12$Gjzv2Qd1uw4HcJY9SDEstu5czYiyXX6Iikd.cXnDg1U4..LbzWf3y		\N	Cashier	5	1
6	EMP-ADMIN	Admin	Administrator	8078532691	0	0	0	0	2026-08-11 11:11:15.907933+05:30	2026-08-17 11:51:15.756245+05:30	\N	1	admin@cloudstick.io	$2a$12$Gjzv2Qd1uw4HcJY9SDEstu5czYiyXX6Iikd.cXnDg1U4..LbzWf3y	6c10c8196863555284d4b6bb7c758042b817f09873445914be001428528bab97	2026-08-17 12:01:15.755096+05:30	admin	1	1
19	EMP-15	Auditor	Auditor	8985654584	0	0	0	0	2026-08-13 12:02:27.286481+05:30	2026-08-13 12:02:27.286481+05:30	\N	1		$2a$12$Gjzv2Qd1uw4HcJY9SDEstu5czYiyXX6Iikd.cXnDg1U4..LbzWf3y		\N	Auditor	9	1
\.


--
-- Data for Name: expenses; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.expenses (id, occurred_on, category, amount, mode, payee, status, receipt_image, created_at, branch_id, remarks, approved_by, approved_at, tenant_id) FROM stdin;
2	2026-08-19 05:30:00+05:30	Rent & Utilities	10000.00	Cash	Office	Approved	/uploads/d0bcfaf528337925-ambika_gold_finance_logo_1_.svg	2026-08-19 10:54:37.447509+05:30	1		\N	2026-08-19 10:54:41.864346+05:30	1
4	2026-08-28 17:30:13.342784+05:30	Bank Pledge Release	100000.00	Bank	HDFC	Approved		2026-08-28 17:30:13.350763+05:30	1	Auto-recorded from bank pledge workflow	System	2026-08-28 17:30:13.350763+05:30	1
\.


--
-- Data for Name: gold_rates; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.gold_rates (id, date, k24, legacy_k22, legacy_k18, set_by, created_at, tenant_id) FROM stdin;
1	2026-08-07 16:08:24.121614+05:30	7285	6690	5480	Rajesh Menon	2026-08-07 16:08:24.122128+05:30	1
2	2026-08-10 16:59:46.817619+05:30	8000	7000	5480	Rajesh Menon	2026-08-10 16:59:46.817619+05:30	1
3	2026-08-10 18:28:08.679357+05:30	6000	5500	4500	Admin	2026-08-10 18:28:08.679933+05:30	1
4	2026-08-11 10:58:01.583597+05:30	9500	8000	7000	Admin	2026-08-11 10:58:01.583597+05:30	1
5	2026-08-12 14:54:30.707341+05:30	10000	9000	8000	Admin	2026-08-12 14:54:30.707341+05:30	1
8	2026-08-12 17:46:28.611044+05:30	10001	\N	\N	Admin	2026-08-12 17:46:28.611044+05:30	1
9	2026-08-13 14:49:37.406677+05:30	9000	\N	\N	Admin	2026-08-13 14:49:37.406677+05:30	1
10	2026-08-15 07:47:15.979466+05:30	9000	\N	\N	Admin	2026-08-15 07:47:15.981423+05:30	1
11	2026-08-17 11:04:33.006761+05:30	15566	\N	\N	Admin	2026-08-17 11:04:33.006761+05:30	1
12	2026-08-18 14:51:41.283193+05:30	15638	\N	\N	Admin	2026-08-18 14:51:41.283779+05:30	1
13	2026-08-19 14:04:18.197006+05:30	15755	\N	\N	Admin	2026-08-19 14:04:18.197006+05:30	1
14	2026-08-24 15:06:53.926917+05:30	15755	\N	\N	Admin	2026-08-24 15:06:53.926917+05:30	1
15	2026-08-25 07:16:48.000384+05:30	15756	\N	\N	Admin	2026-08-25 07:16:48.000384+05:30	1
16	2026-08-25 13:48:46.545737+05:30	15756	\N	\N	Admin	2026-08-25 13:48:46.545745+05:30	1
17	2026-08-28 10:14:08.04245+05:30	14000	\N	\N	Admin	2026-08-28 10:14:08.04245+05:30	1
18	2026-08-29 12:02:41.447328+05:30	15755	\N	\N	Admin	2026-08-29 12:02:41.447328+05:30	1
\.


--
-- Data for Name: loan_approvals; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.loan_approvals (id, loan_id, stage, action, actor_employee_id, remarks, created_at, actor_role, tenant_id) FROM stdin;
3	2	Manager	Rejected	1		2026-08-10 17:16:48.308512+05:30	\N	1
4	6	Manager	Approved	1		2026-08-10 18:44:31.857474+05:30	\N	1
5	6	Management	Approved	1		2026-08-10 18:44:33.842377+05:30	\N	1
46	17	FinalSanction	Approved	13		2026-08-18 18:10:50.902348+05:30	Management	1
6	8	Manager	Approved	1		2026-08-11 11:36:28.813092+05:30	\N	1
7	8	Management	Approved	1		2026-08-11 11:36:32.42712+05:30	\N	1
45	17	BranchManager	Approved	14		2026-08-18 18:10:04.680039+05:30	Branch Manager	1
44	17	LoanOperator	Verified	15		2026-08-18 18:09:51.256113+05:30	Loan Operator	1
12	10	LoanOperator	Approved	6		2026-08-12 18:39:03.491566+05:30	Administrator	1
56	21	LoanOperator	Verified	6		2026-08-28 15:29:49.952281+05:30	Administrator	1
22	11	FinalSanction	Approved	13		2026-08-13 15:41:38.12786+05:30	Management	1
30	13	FinalSanction	Approved	6		2026-08-13 15:59:38.178046+05:30	Administrator	1
29	13	AuthorizedManagement	Approved	6		2026-08-13 15:59:36.95531+05:30	Administrator	1
28	13	BranchManager	Approved	6		2026-08-13 15:59:36.393053+05:30	Administrator	1
21	11	AuthorizedManagement	Approved	13		2026-08-13 15:41:36.939683+05:30	Management	1
20	11	BranchManager	Approved	14		2026-08-13 15:41:21.969098+05:30	Branch Manager	1
19	11	LoanOperator	Approved	14		2026-08-13 15:41:21.46255+05:30	Branch Manager	1
18	11	LoanOperator	Verified	15		2026-08-13 15:40:56.502104+05:30	Loan Operator	1
43	16	FinalSanction	Approved	13		2026-08-18 15:05:50.706815+05:30	Management	1
42	16	BranchManager	Approved	14		2026-08-18 15:05:35.151321+05:30	Branch Manager	1
41	16	LoanOperator	Verified	15		2026-08-18 15:05:21.901291+05:30	Loan Operator	1
8	3	Manager	Approved	1		2026-08-11 11:43:10.439601+05:30	\N	1
9	3	Management	Approved	1		2026-08-11 11:43:11.812984+05:30	\N	1
27	13	LoanOperator	Approved	6		2026-08-13 15:59:35.796408+05:30	Administrator	1
26	12	FinalSanction	Approved	6		2026-08-13 15:47:21.693743+05:30	Administrator	1
25	12	AuthorizedManagement	Approved	6		2026-08-13 15:47:21.003945+05:30	Administrator	1
34	15	FinalSanction	Approved	6		2026-08-17 13:56:59.570227+05:30	Administrator	1
39	14	FinalSanction	Approved	13		2026-08-17 14:01:40.916839+05:30	Management	1
38	14	AuthorizedManagement	Approved	13		2026-08-17 13:59:07.913697+05:30	Management	1
37	14	BranchManager	Approved	14		2026-08-17 13:58:43.45934+05:30	Branch Manager	1
36	14	LoanOperator	Approved	14		2026-08-17 13:58:12.432084+05:30	Branch Manager	1
35	14	LoanOperator	Verified	15		2026-08-17 13:57:56.89043+05:30	Loan Operator	1
40	9	FinalSanction	Approved	6		2026-08-17 17:04:51.115466+05:30	Administrator	1
17	9	BranchManager	Approved	14		2026-08-13 14:04:32.581902+05:30	Branch Manager	1
16	9	LoanOperator	Approved	14		2026-08-13 14:03:02.75978+05:30	Branch Manager	1
33	15	AuthorizedManagement	Approved	6		2026-08-17 13:56:56.997302+05:30	Administrator	1
32	15	BranchManager	Approved	6		2026-08-17 13:56:56.22+05:30	Administrator	1
31	15	LoanOperator	Approved	6		2026-08-17 13:56:53.247565+05:30	Administrator	1
24	12	BranchManager	Approved	6		2026-08-13 15:47:20.535812+05:30	Administrator	1
23	12	LoanOperator	Approved	6		2026-08-13 15:47:20.109389+05:30	Administrator	1
13	10	BranchManager	Approved	6		2026-08-12 18:39:05.556012+05:30	Administrator	1
2	1	Management	Approved	1		2026-08-10 17:07:12.964883+05:30	\N	1
14	10	AuthorizedManagement	Approved	6		2026-08-12 18:39:07.074604+05:30	Administrator	1
1	1	Manager	Approved	1		2026-08-10 17:06:46.239499+05:30	\N	1
15	10	FinalSanction	Approved	6		2026-08-12 18:39:08.580446+05:30	Administrator	1
55	20	FinalSanction	Approved	6		2026-08-25 08:54:02.378401+05:30	Administrator	1
54	20	BranchManager	Approved	6		2026-08-24 16:52:07.750999+05:30	Administrator	1
53	20	LoanOperator	Verified	6		2026-08-24 16:52:01.055677+05:30	Administrator	1
49	19	FinalSanction	Approved	13		2026-08-19 14:44:19.907472+05:30	Management	1
48	19	BranchManager	Approved	14		2026-08-19 14:42:41.222387+05:30	Branch Manager	1
47	19	LoanOperator	Verified	15		2026-08-19 14:40:19.081879+05:30	Loan Operator	1
52	18	FinalSanction	Approved	6		2026-08-19 15:01:13.782595+05:30	Administrator	1
51	18	BranchManager	Approved	6		2026-08-19 15:01:06.893005+05:30	Administrator	1
50	18	LoanOperator	Verified	6		2026-08-19 15:01:02.229168+05:30	Administrator	1
10	7	Manager	Approved	1		2026-08-11 17:37:02.029432+05:30	\N	1
11	7	Management	Approved	1		2026-08-11 17:37:02.260487+05:30	\N	1
\.


--
-- Data for Name: loan_draft_ornaments; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.loan_draft_ornaments (id, draft_id, name, purity, gross_weight, quantity, image_url, image_name, "position", tenant_id) FROM stdin;
\.


--
-- Data for Name: loan_drafts; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.loan_drafts (id, created_by_employee_id, branch_id, customer_id, scheme_id, locker_id, principal_override, created_at, updated_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: loan_payments; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.loan_payments (id, loan_id, amount, type, paid_on, received_by_employee_id, created_at, description, method, reference, penal_interest_applied, interest_applied, principal_applied, running_balance, processing_fee_applied, processing_fee, tenant_id) FROM stdin;
1	6	7500.00	Partial	2026-08-10 05:30:00+05:30	1	2026-08-10 18:44:49.196516+05:30	\N	\N	\N	\N	\N	\N	\N	\N	\N	1
2	8	2000.00	Full Settlement	2026-08-11 05:30:00+05:30	1	2026-08-11 14:38:15.179401+05:30	\N	\N	\N	\N	\N	\N	\N	\N	\N	1
3	13	10000.00	Partial	2026-08-13 05:30:00+05:30	6	2026-08-13 18:32:56.148458+05:30		Cash		0.00	9.06	9990.94	40009.06	0.00	0.00	1
6	1	1.40	Partial	2026-08-15 05:30:00+05:30	6	2026-08-15 14:00:51.724165+05:30		Cash		0.00	1.40	0.00	5488.33	0.00	0.00	1
4	1	39800.00	Auction Sale	2026-08-14 19:33:14.620648+05:30	6	2026-08-14 19:33:14.620648+05:30	Auction proceeds applied (sale ₹40000.00 less expenses ₹200.00)	Auction		0.00	71.23	39728.77	20481.23	0.00	0.00	1
5	1	15000.00	Partial	2026-08-14 05:30:00+05:30	6	2026-08-14 19:37:06.101469+05:30		Cash		0.00	7.10	14992.90	5488.33	0.00	0.00	1
7	15	100000.00	Partial	2026-08-17 05:30:00+05:30	6	2026-08-17 17:58:00.121055+05:30		Cash		0.00	0.00	100000.00	0.00	0.00	0.00	1
8	17	10000.00	Full Settlement	2026-08-18 18:54:01.08198+05:30	\N	2026-08-18 18:54:01.105864+05:30	Razorpay online payment	Online	pay_TRFQywTl7c3zmz	0.00	0.00	10000.00	0.00	0.00	0.00	1
10	16	5000.00	Partial	2026-08-18 19:39:29.645919+05:30	\N	2026-08-18 19:39:29.661054+05:30	Razorpay online payment	Online	pay_TRGD4919VWbBtw	0.00	0.00	5000.00	5000.00	0.00	0.00	1
14	11	10000.00	Partial	2026-08-19 10:56:58.06215+05:30	\N	2026-08-19 10:56:58.078614+05:30	Razorpay online payment	Online	pay_TRVqFLfhtCRLzf	0.00	10.51	9989.49	64260.51	0.00	0.00	1
9	12	10000.00	Partial	2026-08-18 19:12:46.721092+05:30	\N	2026-08-18 19:12:46.740664+05:30	Razorpay online payment	Online	pay_TRFkpBAZDTq6tw	0.00	8.86	9991.14	64258.86	0.00	0.00	1
11	12	1000.00	Partial	2026-08-19 10:17:24.116659+05:30	\N	2026-08-19 10:17:24.147+05:30	Razorpay online payment	Online	pay_TRVASQY8TSmtUa	0.00	0.00	1000.00	63258.86	0.00	0.00	1
12	12	10000.00	Partial	2026-08-19 10:26:05.528985+05:30	\N	2026-08-19 10:26:05.552239+05:30	Razorpay online payment	Online	pay_TRVJbEGepBiZNj	0.00	0.00	10000.00	53258.86	0.00	0.00	1
13	12	10000.00	Partial	2026-08-19 10:40:17.977456+05:30	\N	2026-08-19 10:40:17.981131+05:30	Razorpay online payment	Online	pay_TRVYeAiHjVQD50	0.00	0.00	10000.00	43258.86	0.00	0.00	1
15	12	10000.00	Partial	2026-08-19 11:16:38.01586+05:30	\N	2026-08-19 11:16:38.026092+05:30	Razorpay online payment	Online	pay_TRWAymwHwRiJFl	0.00	0.00	10000.00	33258.86	0.00	0.00	1
16	20	10000.00	Partial	2026-08-25 05:30:00+05:30	6	2026-08-25 09:09:55.89819+05:30		UPI		0.00	0.00	10000.00	0.00	0.00	0.00	1
17	10	5000.00	Partial	2026-08-25 05:30:00+05:30	6	2026-08-25 13:31:52.999264+05:30		Cash		0.00	13.73	4986.27	85013.73	0.00	0.00	1
18	19	5000.00	Partial	2026-08-25 05:30:00+05:30	6	2026-08-25 13:32:23.540527+05:30		Cash		0.00	0.00	5000.00	5000.00	0.00	0.00	1
19	19	5533.33	Partial	2026-08-28 05:30:00+05:30	6	2026-08-28 17:29:23.777594+05:30		Cash		33.33	500.00	5000.00	0.00	0.00	0.00	1
21	18	10000.00	Partial	2026-08-28 05:30:00+05:30	6	2026-08-28 18:25:49.812019+05:30		Cash		0.00	0.00	10000.00	0.00	0.00	0.00	1
20	7	5000.00	Partial	2026-08-28 05:30:00+05:30	6	2026-08-28 17:35:52.048746+05:30		Cash		0.00	25.38	4974.62	45025.38	0.00	0.00	1
22	7	500.00	Partial	2026-08-28 05:30:00+05:30	6	2026-08-28 19:04:43.954186+05:30		Cash		0.00	500.00	0.00	49027.92	0.00	0.00	1
23	7	5000.00	Partial	2026-08-28 05:30:00+05:30	6	2026-08-28 19:29:19.039894+05:30		Cash		0.00	4002.54	997.46	44027.92	0.00	0.00	1
\.


--
-- Data for Name: loan_requests; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.loan_requests (id, loan_id, type, status, requested_by, detail, requested_extension_months, new_due_date, remarks, requested_at, decided_at, decided_by_employee_id, created_at, updated_at, approval_stage, payment_verified, packet_verified, bank_pledge_verified, customer_confirmed, verification_notes, charges, settlement_amount, tenant_id) FROM stdin;
1	13	Extension	Approved	Staff	+3 months	3	2027-11-13 05:30:00+05:30		2026-08-13 18:33:08.426821+05:30	2026-08-13 18:33:15.120015+05:30	6	2026-08-13 18:33:08.426821+05:30	2026-08-13 18:33:15.136158+05:30		f	f	f	f		0.00	0.00	1
2	13	Extension	Approved	Staff	+3 months	3	2028-02-13 05:30:00+05:30		2026-08-13 18:33:48.658544+05:30	2026-08-13 18:33:59.438521+05:30	6	2026-08-13 18:33:48.658544+05:30	2026-08-13 18:33:59.448663+05:30		f	f	f	f		0.00	0.00	1
3	11	Extension	Approved	Customer		3	2027-11-13 05:30:00+05:30		2026-08-18 19:49:43.931002+05:30	2026-08-18 19:50:21.71731+05:30	6	2026-08-18 19:49:43.931002+05:30	2026-08-18 19:50:21.717884+05:30	Approved	f	f	f	f		0.00	0.00	1
4	11	Extension	Approved	Customer		4	2028-03-13 05:30:00+05:30		2026-08-18 19:52:27.573516+05:30	2026-08-18 19:52:47.174305+05:30	6	2026-08-18 19:52:27.573516+05:30	2026-08-18 19:52:47.174813+05:30	Approved	f	f	f	f		0.00	0.00	1
5	18	Release	Approved	Staff	Full settlement requested	\N	\N		2026-08-28 10:10:45.093145+05:30	2026-08-28 10:11:29.784448+05:30	6	2026-08-28 10:10:45.093145+05:30	2026-08-28 10:11:29.785514+05:30	Approved	t	t	t	t		0.00	10000.00	1
6	19	Release	Approved	Staff	Full settlement requested	\N	\N		2026-08-28 17:33:23.915178+05:30	2026-08-28 17:34:03.130211+05:30	6	2026-08-28 17:33:23.915682+05:30	2026-08-28 17:34:03.131727+05:30	Approved	t	t	t	t		0.00	0.00	1
\.


--
-- Data for Name: loans; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.loans (id, loan_number, branch_id, customer_id, scheme_id, opened_date, due_date, total_net_weight, total_gold_value, eligible_loan_amount, principal_amount, outstanding_amount, status, approval_stage, bank_pledge_status, auction_date, auction_amount, created_at, updated_at, deleted_at, accrued_interest, interest_paid, accrued_penal_interest, penal_interest_paid, last_accrual_date, outstanding_processing_fee, indemnity_bond_document_id, indemnity_bond_sign_request_id, indemnity_bond_sign_status, indemnity_bond_signed_url, indemnity_bond_signed_at, due_soon_notified_at, overdue_notified_at, tenant_id, additional_info) FROM stdin;
18	LN-00018	1	5	6	2026-08-19 05:30:00+05:30	2027-08-19 05:30:00+05:30	1	14442.00	10831.50	10000.00	0.00	Closed	Approved	Not Pledged	\N	\N	2026-08-19 14:25:34.981375+05:30	2026-08-28 18:25:51.639226+05:30	\N	0.00	0.00	0.00	0.00	2026-08-19 05:30:00+05:30	0.00					\N	\N	\N	1	\N
7	LN-00007	1	3	3	2025-10-02 12:44:00.001299+05:30	2026-03-31 12:44:00.001299+05:30	7	56000.00	50400.00	50000.00	44027.92	Active	Approved	Not Pledged	\N	\N	2026-08-11 11:08:01.583726+05:30	2026-08-28 19:29:19.032218+05:30	\N	4527.92	4527.92	0.00	0.00	2026-08-02 12:44:00.001299+05:30	0.00					\N	\N	\N	1	\N
3	LN-00003	1	3	3	2026-08-10 05:30:00+05:30	2027-08-10 05:30:00+05:30	10	70000.00	63000.00	1000.00	1000.00	Active	Approved	Released	\N	\N	2026-08-10 18:20:42.515375+05:30	2026-08-13 14:15:09.545038+05:30	\N	1.12	0.00	0.00	0.00	2026-08-13 14:15:09.543968+05:30	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
13	LN-00013	1	6	3	2026-08-13 05:30:00+05:30	2028-02-13 05:30:00+05:30	12	99000.00	89100.00	50000.00	40009.06	Active	Approved	Not Pledged	\N	\N	2026-08-13 15:49:47.209565+05:30	2026-08-15 09:23:19.845368+05:30	\N	30.64	9.06	0.00	0.00	2026-08-15 09:23:19.843268+05:30	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
1	LN-00001	1	3	3	2026-08-10 05:30:00+05:30	2026-05-05 18:37:55.529908+05:30	10	66900.00	60210.00	60210.00	5488.33	Active	Approved	Not Pledged	2026-08-14 19:33:14.620648+05:30	40000.00	2026-08-10 17:06:42.668517+05:30	2026-08-17 10:25:40.476531+05:30	\N	79.73	79.73	0.00	0.00	2026-08-15 14:01:16.606858+05:30	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
2	LN-00002	1	3	3	2026-08-10 05:30:00+05:30	2026-04-17 07:49:52.146421+05:30	10	70000.00	63000.00	63000.00	63000.00	Active	Rejected	Not Pledged	\N	\N	2026-08-10 17:03:19.777993+05:30	2026-08-17 11:38:00.958959+05:30	\N	0.00	0.00	0.00	0.00	0001-01-01 05:53:28+05:53:28	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
11	LN-00011	1	5	3	2026-08-13 05:30:00+05:30	2028-03-13 05:30:00+05:30	10	82500.00	74250.00	74250.00	64260.51	Active	Approved	Not Pledged	\N	\N	2026-08-13 15:40:31.731054+05:30	2026-08-19 10:56:58.072275+05:30	\N	10.51	10.51	0.00	0.00	2026-08-13 15:41:38.157015+05:30	0.00					\N	\N	\N	1	\N
12	LN-00012	1	5	5	2026-08-13 05:30:00+05:30	2027-08-13 05:30:00+05:30	10	82500.00	74250.00	74250.00	33258.86	Active	Approved	Not Pledged	\N	\N	2026-08-13 15:47:00.976733+05:30	2026-08-19 11:16:38.021793+05:30	\N	8.86	8.86	0.00	0.00	2026-08-13 15:47:26.258646+05:30	0.00					\N	\N	\N	1	\N
17	LN-00017	1	5	5	2026-08-18 05:30:00+05:30	2027-08-18 05:30:00+05:30	1	14335.00	12901.50	10000.00	0.00	Closed	Approved	Not Pledged	\N	\N	2026-08-18 18:08:08.648026+05:30	2026-08-18 18:54:01.094792+05:30	\N	0.00	0.00	0.00	0.00	2026-08-18 05:30:00+05:30	0.00					\N	\N	\N	1	\N
20	LN-00020	1	3	3	2026-08-24 05:30:00+05:30	2027-08-24 05:30:00+05:30	1	14442.00	12997.80	10000.00	0.00	Closed	Approved	Not Pledged	\N	\N	2026-08-24 16:51:44.508009+05:30	2026-08-25 09:09:55.893344+05:30	\N	0.00	0.00	0.00	0.00	2026-08-24 05:30:00+05:30	0.00					\N	\N	\N	1	\N
16	LN-00016	1	5	4	2026-08-18 05:30:00+05:30	2027-08-18 05:30:00+05:30	10	143350.00	107512.50	10000.00	5000.00	Active	Approved	Not Pledged	\N	\N	2026-08-18 15:04:52.561923+05:30	2026-08-18 19:39:29.656352+05:30	\N	0.00	0.00	0.00	0.00	2026-08-18 05:30:00+05:30	0.00					\N	\N	\N	1	\N
15	LN-00015	1	4	5	2026-08-17 05:30:00+05:30	2027-08-17 05:30:00+05:30	12	171228.00	154105.20	100000.00	0.00	Closed	Approved	Not Pledged	\N	\N	2026-08-17 13:56:15.691539+05:30	2026-08-17 19:49:03.52449+05:30	\N	0.00	0.00	0.00	0.00	2026-08-17 05:30:00+05:30	0.00	9901ba10-ddaf-4837-a6b2-68217e612ea5	6969b27a-e818-4cdb-809c-e6925424c02f	sign_initiated		\N	\N	\N	1	\N
5	LN-00005	1	4	4	2026-08-10 05:30:00+05:30	2026-09-10 05:30:00+05:30	5	27500.00	20625.00	1000.00	1000.00	Pending Approval	PendingManager	Not Pledged	\N	\N	2026-08-10 18:29:08.874476+05:30	2026-08-10 18:29:08.874476+05:30	\N	0.00	0.00	0.00	0.00	\N	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
4	LN-00004	1	4	4	2026-08-10 05:30:00+05:30	2026-09-10 05:30:00+05:30	10	55000.00	41250.00	1000.00	1000.00	Pending Approval	PendingManager	Released	\N	\N	2026-08-10 18:28:24.484299+05:30	2026-08-10 18:29:44.356619+05:30	\N	0.00	0.00	0.00	0.00	\N	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
6	LN-00006	1	3	3	2026-08-10 05:30:00+05:30	2027-08-10 05:30:00+05:30	2	11000.00	9900.00	9000.00	1500.00	Active	Approved	Not Pledged	\N	\N	2026-08-10 18:44:24.266945+05:30	2026-08-10 18:44:49.199638+05:30	\N	0.00	0.00	0.00	0.00	\N	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
8	LN-00008	1	3	3	2026-08-11 05:30:00+05:30	2027-08-11 05:30:00+05:30	1	8000.00	7200.00	2000.00	0.00	Closed	Approved	Released	\N	\N	2026-08-11 11:36:27.509642+05:30	2026-08-11 14:38:15.183845+05:30	\N	0.00	0.00	0.00	0.00	\N	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
21	LN-00021	1	3	5	2026-08-28 05:30:00+05:30	2027-08-28 05:30:00+05:30	1	12833.00	11549.70	10000.00	10000.00	Pending Approval	BranchManager	Not Pledged	\N	\N	2026-08-28 10:14:31.204718+05:30	2026-08-28 15:29:49.962801+05:30	\N	0.00	0.00	0.00	0.00	2026-08-28 05:30:00+05:30	0.00	3faf1589-b4e4-4867-b79e-380005f1ef30	d363b21c-60fe-4d7b-bd16-0d4f10b1b0af	sign_initiated		\N	\N	\N	1	\N
14	LN-00014	1	4	5	2025-10-02 12:44:00.001299+05:30	2026-03-31 12:44:00.001299+05:30	12	171228.00	154105.20	100000.00	100000.00	Active	Approved	Not Pledged	\N	\N	2026-08-17 13:56:09.98889+05:30	2026-08-17 14:01:40.918055+05:30	\N	0.00	0.00	0.00	0.00	\N	0.00	\N	\N	\N	\N	\N	\N	\N	1	\N
9	LN-00009	1	3	5	2025-10-02 12:44:00.001299+05:30	2026-03-31 12:44:00.001299+05:30	10	100000.00	90000.00	90000.00	90000.00	Active	Approved	Not Pledged	\N	\N	2026-08-12 14:54:31.887013+05:30	2026-08-17 17:04:51.150988+05:30	\N	0.00	0.00	0.00	0.00	\N	0.00					\N	\N	\N	1	\N
10	LN-00010	1	3	5	2026-08-12 05:30:00+05:30	2027-08-12 05:30:00+05:30	10	100000.00	90000.00	90000.00	85013.73	Active	Approved	Not Pledged	\N	\N	2026-08-12 17:07:11.334613+05:30	2026-08-25 13:31:52.996061+05:30	\N	13.73	13.73	0.00	0.00	2026-08-12 18:39:08.584984+05:30	0.00					\N	\N	\N	1	\N
19	LN-00019	1	5	6	2025-08-28 00:00:00+05:30	2026-04-30 00:00:00+05:30	1	14442.00	10831.50	10000.00	0.00	Closed	Approved	Released	\N	\N	2026-08-19 14:38:56.521182+05:30	2026-08-28 18:25:09.149814+05:30	\N	500.00	500.00	33.33	33.33	2026-08-28 00:00:00+05:30	0.00					\N	\N	\N	1	\N
\.


--
-- Data for Name: lockers; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.lockers (id, code, branch_id, capacity, is_active, created_at, updated_at, deleted_at, tenant_id) FROM stdin;
2	LKR-TEST1	1	30	t	2026-08-10 18:28:50.738796+05:30	2026-08-11 11:34:37.805493+05:30	\N	1
3	LKR-B2	1	30	t	2026-08-25 08:53:17.653741+05:30	2026-08-25 08:53:17.653741+05:30	\N	1
4	LK31	1	30	t	2026-08-25 12:29:59.445084+05:30	2026-08-25 12:29:59.445084+05:30	\N	1
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.notifications (id, customer_id, type, title, body, related_entity_type, related_entity_id, delivered, delivered_at, attempts, last_attempt_at, created_at, read, read_at, tenant_id) FROM stdin;
129	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00018. — Ambika Gold Finance	loan	18	f	\N	0	\N	2026-08-28 18:25:49.843861+05:30	f	\N	1
166	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 16:39:33.485794+05:30	f	\N	1
178	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	f	\N	0	\N	2026-09-04 13:27:04.578891+05:30	f	\N	1
179	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	f	\N	0	\N	2026-09-04 13:27:04.608869+05:30	f	\N	1
180	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	f	\N	0	\N	2026-09-04 13:27:04.613813+05:30	f	\N	1
181	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	f	\N	0	\N	2026-09-04 13:27:04.616833+05:30	f	\N	1
182	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	f	\N	0	\N	2026-09-04 13:27:04.621043+05:30	f	\N	1
16	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹1000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	t	2026-08-19 10:17:30.12505+05:30	1	2026-08-19 10:17:30.024495+05:30	2026-08-19 10:17:30.023495+05:30	f	\N	1
130	3	auction_event	Auction Decision	Dear adithyan cloudhouse, following your recent payment, loan LN-00007 has been removed from auction and your pledged gold is no longer at risk. A balance of ₹45025.38 remains payable. — Ambika Gold Finance	auction_record	2	f	\N	0	\N	2026-08-28 19:04:15.848914+05:30	f	\N	1
131	3	payment	Payment Received	Dear adithyan cloudhouse, we have received your payment of ₹500.00 (Partial) towards loan LN-00007. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-28 19:04:43.958829+05:30	f	\N	1
168	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 17:39:33.45118+05:30	f	\N	1
169	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 17:39:33.47118+05:30	f	\N	1
170	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 17:39:33.474328+05:30	f	\N	1
171	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 17:39:33.480275+05:30	f	\N	1
172	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 17:39:33.489588+05:30	f	\N	1
183	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	f	\N	0	\N	2026-09-07 12:49:54.690831+05:30	f	\N	1
184	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	f	\N	0	\N	2026-09-07 12:49:54.726044+05:30	f	\N	1
185	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	f	\N	0	\N	2026-09-07 12:49:54.729932+05:30	f	\N	1
186	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	f	\N	0	\N	2026-09-07 12:49:54.733608+05:30	f	\N	1
187	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	f	\N	0	\N	2026-09-07 12:49:54.738306+05:30	f	\N	1
132	3	payment	Payment Received	Dear adithyan cloudhouse, we have received your payment of ₹5000.00 (Partial) towards loan LN-00007. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-28 19:29:19.047248+05:30	f	\N	1
173	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 18:39:33.451624+05:30	f	\N	1
174	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 18:39:33.47205+05:30	f	\N	1
53	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 17:29:48.790939+05:30	f	\N	1
60	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 19:29:43.574892+05:30	f	\N	1
61	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 19:29:49.307651+05:30	f	\N	1
175	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 18:39:33.477036+05:30	f	\N	1
176	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 18:39:33.479564+05:30	f	\N	1
177	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 18:39:33.482703+05:30	f	\N	1
188	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	f	\N	0	\N	2026-09-07 13:49:54.717101+05:30	f	\N	1
189	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	f	\N	0	\N	2026-09-07 13:49:54.746438+05:30	f	\N	1
190	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	f	\N	0	\N	2026-09-07 13:49:54.757523+05:30	f	\N	1
191	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	f	\N	0	\N	2026-09-07 13:49:54.764422+05:30	f	\N	1
193	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	f	\N	0	\N	2026-09-07 14:49:54.685709+05:30	f	\N	1
194	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	f	\N	0	\N	2026-09-07 14:49:54.696315+05:30	f	\N	1
195	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	f	\N	0	\N	2026-09-07 14:49:54.706056+05:30	f	\N	1
196	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	f	\N	0	\N	2026-09-07 14:49:54.719974+05:30	f	\N	1
197	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	f	\N	0	\N	2026-09-07 14:49:54.73005+05:30	f	\N	1
198	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	f	\N	0	\N	2026-09-07 15:49:54.687699+05:30	f	\N	1
199	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	f	\N	0	\N	2026-09-07 15:49:54.698523+05:30	f	\N	1
200	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	f	\N	0	\N	2026-09-07 15:49:54.708006+05:30	f	\N	1
201	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	f	\N	0	\N	2026-09-07 15:49:54.714209+05:30	f	\N	1
202	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	f	\N	0	\N	2026-09-07 15:49:54.724536+05:30	f	\N	1
203	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	f	\N	0	\N	2026-09-07 16:49:54.685586+05:30	f	\N	1
204	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	f	\N	0	\N	2026-09-07 16:49:54.697084+05:30	f	\N	1
133	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 10:39:33.466092+05:30	f	\N	1
134	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 10:39:33.517534+05:30	f	\N	1
54	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 17:30:03.273619+05:30	f	\N	1
55	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 17:30:08.795922+05:30	f	\N	1
135	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 10:39:33.52257+05:30	f	\N	1
136	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 10:39:33.529553+05:30	f	\N	1
137	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 10:39:33.540829+05:30	f	\N	1
192	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	f	\N	0	\N	2026-09-07 13:49:54.839844+05:30	f	\N	1
138	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 11:39:33.437689+05:30	f	\N	1
139	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 11:39:33.468054+05:30	f	\N	1
140	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 11:39:33.471107+05:30	f	\N	1
141	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 11:39:33.478177+05:30	f	\N	1
142	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 11:39:33.485327+05:30	f	\N	1
205	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	f	\N	0	\N	2026-09-07 16:49:54.704487+05:30	f	\N	1
206	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	f	\N	0	\N	2026-09-07 16:49:54.716365+05:30	f	\N	1
207	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	f	\N	0	\N	2026-09-07 16:49:54.79537+05:30	f	\N	1
210	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	2	f	\N	0	\N	2026-09-07 17:49:54.734569+05:30	f	\N	1
211	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	14	f	\N	0	\N	2026-09-07 17:49:54.741092+05:30	f	\N	1
143	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 12:39:33.443819+05:30	f	\N	1
144	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 12:39:33.475456+05:30	f	\N	1
145	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 12:39:33.483487+05:30	f	\N	1
146	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 12:39:33.487983+05:30	f	\N	1
147	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 12:39:33.491054+05:30	f	\N	1
153	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 14:39:33.445937+05:30	f	\N	1
154	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 14:39:33.460413+05:30	f	\N	1
155	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 14:39:33.46672+05:30	f	\N	1
158	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 15:39:33.440142+05:30	f	\N	1
159	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 15:39:33.449133+05:30	f	\N	1
160	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 15:39:33.451226+05:30	f	\N	1
161	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 15:39:33.454321+05:30	f	\N	1
162	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 15:39:33.458401+05:30	f	\N	1
208	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	7	f	\N	0	\N	2026-09-07 17:49:54.690316+05:30	f	\N	1
209	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	1	f	\N	0	\N	2026-09-07 17:49:54.729584+05:30	f	\N	1
212	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Default Business	loan	9	f	\N	0	\N	2026-09-07 17:49:54.750578+05:30	f	\N	1
148	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 13:39:33.44539+05:30	f	\N	1
149	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 13:39:33.497918+05:30	f	\N	1
150	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 13:39:33.502983+05:30	f	\N	1
151	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 13:39:33.508855+05:30	f	\N	1
152	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 13:39:33.511928+05:30	f	\N	1
156	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-29 14:39:33.472529+05:30	f	\N	1
157	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 14:39:33.479691+05:30	f	\N	1
1	5	loan_submission	Loan Application Submitted	Dear adithyan, your gold loan application LN-00017 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	17	t	2026-08-18 18:08:08.85305+05:30	1	2026-08-18 18:08:08.727628+05:30	2026-08-18 18:08:08.722096+05:30	f	\N	1
11	5	extension_request	Extension Approved	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	3	t	2026-08-18 19:50:21.077517+05:30	1	2026-08-18 19:50:20.990455+05:30	2026-08-18 19:50:20.989926+05:30	f	\N	1
2	5	loan_approval	Loan Approved	Dear adithyan, your gold loan application LN-00017 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	17	t	2026-08-18 18:09:51.521732+05:30	1	2026-08-18 18:09:51.288147+05:30	2026-08-18 18:09:51.286754+05:30	f	\N	1
3	5	loan_approval	Loan Approved	Dear adithyan, your gold loan application LN-00017 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	17	t	2026-08-18 18:10:04.806186+05:30	1	2026-08-18 18:10:04.69444+05:30	2026-08-18 18:10:04.693767+05:30	f	\N	1
17	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-19 10:24:24.352997+05:30	f	\N	1
4	5	loan_sanction	Loan Sanctioned	Dear adithyan, your gold loan LN-00017 has been sanctioned and ₹10000.00 has been disbursed. Due date: 18-Aug-2027. — Ambika Gold Finance	loan	17	t	2026-08-18 18:10:51.040861+05:30	1	2026-08-18 18:10:50.9178+05:30	2026-08-18 18:10:50.917264+05:30	f	\N	1
12	5	extension_request	Extension Approved	Dear adithyan, your extension request for loan LN-00011 has been fully approved. New due date: 13-Nov-2027. — Ambika Gold Finance	loan_request	3	t	2026-08-18 19:50:21.803138+05:30	1	2026-08-18 19:50:21.725377+05:30	2026-08-18 19:50:21.724858+05:30	f	\N	1
5	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹10000.00 (Full Settlement) towards loan LN-00017. — Ambika Gold Finance	loan	17	t	2026-08-18 18:54:01.265812+05:30	1	2026-08-18 18:54:01.17732+05:30	2026-08-18 18:54:01.175676+05:30	f	\N	1
6	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	t	2026-08-18 19:12:46.873965+05:30	1	2026-08-18 19:12:46.776299+05:30	2026-08-18 19:12:46.77522+05:30	f	\N	1
18	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-19 10:24:29.852588+05:30	f	\N	1
7	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹5000.00 (Partial) towards loan LN-00016. — Ambika Gold Finance	loan	16	t	2026-08-18 19:39:29.788002+05:30	1	2026-08-18 19:39:29.694538+05:30	2026-08-18 19:39:29.693301+05:30	f	\N	1
8	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-18 19:48:26.444058+05:30	f	\N	1
9	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-18 19:48:26.46503+05:30	f	\N	1
13	5	extension_request	Extension Approved	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Branch Manager). — Ambika Gold Finance	loan_request	4	t	2026-08-18 19:52:46.889294+05:30	1	2026-08-18 19:52:46.728169+05:30	2026-08-18 19:52:46.727655+05:30	f	\N	1
10	5	extension_request	Extension Approved	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Branch Manager). — Ambika Gold Finance	loan_request	3	t	2026-08-18 19:50:20.268071+05:30	1	2026-08-18 19:50:20.177773+05:30	2026-08-18 19:50:20.177773+05:30	f	\N	1
14	5	extension_request	Extension Approved	Dear adithyan, your extension request for loan LN-00011 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	4	t	2026-08-18 19:52:47.067808+05:30	1	2026-08-18 19:52:46.993469+05:30	2026-08-18 19:52:46.991793+05:30	f	\N	1
15	5	extension_request	Extension Approved	Dear adithyan, your extension request for loan LN-00011 has been fully approved. New due date: 13-Mar-2028. — Ambika Gold Finance	loan_request	4	t	2026-08-18 19:52:47.353001+05:30	1	2026-08-18 19:52:47.182686+05:30	2026-08-18 19:52:47.182143+05:30	f	\N	1
19	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	t	2026-08-19 10:26:10.122084+05:30	1	2026-08-19 10:26:10.028859+05:30	2026-08-19 10:26:10.027398+05:30	f	\N	1
22	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	t	2026-08-19 11:16:43.578423+05:30	1	2026-08-19 11:16:43.435811+05:30	2026-08-19 11:16:43.435134+05:30	f	\N	1
20	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00012. — Ambika Gold Finance	loan	12	t	2026-08-19 10:40:22.935022+05:30	1	2026-08-19 10:40:22.720412+05:30	2026-08-19 10:40:22.719847+05:30	f	\N	1
23	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-19 11:24:24.236256+05:30	f	\N	1
21	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹10000.00 (Partial) towards loan LN-00011. — Ambika Gold Finance	loan	11	t	2026-08-19 10:57:03.471957+05:30	1	2026-08-19 10:57:03.113735+05:30	2026-08-19 10:57:03.112628+05:30	f	\N	1
24	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-19 11:24:29.064841+05:30	f	\N	1
25	5	loan_submission	Loan Application Submitted	Dear adithyan, your gold loan application LN-00018 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	18	t	2026-08-19 14:29:11.272652+05:30	1	2026-08-19 14:29:11.082855+05:30	2026-08-19 14:25:39.965292+05:30	f	\N	1
28	5	loan_approval	Loan Approved	Dear adithyan, your gold loan application LN-00019 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	19	t	2026-08-19 15:15:18.036182+05:30	1	2026-08-19 15:15:17.861607+05:30	2026-08-19 14:42:46.577576+05:30	t	2026-08-24 14:25:57.895591+05:30	1
27	5	loan_approval	Loan Approved	Dear adithyan, your gold loan application LN-00019 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	19	t	2026-08-19 15:15:18.012634+05:30	1	2026-08-19 15:15:17.860939+05:30	2026-08-19 14:40:23.927907+05:30	f	\N	1
29	5	loan_sanction	Loan Sanctioned	Dear adithyan, your gold loan LN-00019 has been sanctioned and ₹10000.00 has been disbursed. Due date: 19-Aug-2027. — Ambika Gold Finance	loan	19	t	2026-08-19 15:15:18.037252+05:30	1	2026-08-19 15:15:17.862175+05:30	2026-08-19 14:44:24.615085+05:30	t	2026-08-24 14:25:56.061484+05:30	1
43	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 14:32:05.84707+05:30	f	\N	1
44	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 14:32:10.800017+05:30	f	\N	1
32	5	loan_sanction	Loan Sanctioned	Dear adithyan, your gold loan LN-00018 has been sanctioned and ₹10000.00 has been disbursed. Due date: 19-Aug-2027. — Ambika Gold Finance	loan	18	t	2026-08-19 15:15:18.039661+05:30	1	2026-08-19 15:15:17.863851+05:30	2026-08-19 15:01:19.372664+05:30	t	2026-08-24 16:05:56.194409+05:30	1
26	5	loan_submission	Loan Application Submitted	Dear adithyan, your gold loan application LN-00019 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	19	t	2026-08-19 15:15:17.948041+05:30	1	2026-08-19 15:15:17.859591+05:30	2026-08-19 14:39:01.983557+05:30	f	\N	1
33	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-19 15:59:52.019747+05:30	f	\N	1
34	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-19 15:59:56.366106+05:30	f	\N	1
35	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-19 16:59:50.991636+05:30	f	\N	1
36	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-19 16:59:56.623961+05:30	f	\N	1
37	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-19 17:59:50.686563+05:30	f	\N	1
38	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-19 17:59:55.19214+05:30	f	\N	1
39	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-19 18:59:50.697546+05:30	f	\N	1
40	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-19 18:59:56.291851+05:30	f	\N	1
41	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 13:27:16.206601+05:30	f	\N	1
42	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 13:27:20.968147+05:30	f	\N	1
30	5	loan_approval	Loan Approved	Dear adithyan, your gold loan application LN-00018 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	18	t	2026-08-19 15:15:18.038583+05:30	1	2026-08-19 15:15:17.862703+05:30	2026-08-19 15:01:06.65514+05:30	t	2026-08-24 14:25:54.211788+05:30	1
31	5	loan_approval	Loan Approved	Dear adithyan, your gold loan application LN-00018 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	18	t	2026-08-19 15:15:18.039148+05:30	1	2026-08-19 15:15:17.86322+05:30	2026-08-19 15:01:12.035518+05:30	t	2026-08-24 16:06:00.162872+05:30	1
45	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 16:29:42.604484+05:30	f	\N	1
46	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 16:29:48.291279+05:30	f	\N	1
47	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 16:30:03.177929+05:30	f	\N	1
48	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 16:30:07.675194+05:30	f	\N	1
49	3	loan_submission	Loan Application Submitted	Dear adithyan cloudhouse, your gold loan application LN-00020 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	20	f	\N	0	\N	2026-08-24 16:51:51.022073+05:30	f	\N	1
50	3	loan_approval	Loan Approved	Dear adithyan cloudhouse, your gold loan application LN-00020 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	20	f	\N	0	\N	2026-08-24 16:52:07.686752+05:30	f	\N	1
51	3	loan_approval	Loan Approved	Dear adithyan cloudhouse, your gold loan application LN-00020 has been approved at one stage and is now awaiting Management approval. — Ambika Gold Finance	loan	20	f	\N	0	\N	2026-08-24 16:52:14.729547+05:30	f	\N	1
52	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 17:29:43.307316+05:30	f	\N	1
83	5	payment	Payment Received	Dear adithyan, we have received your payment of ₹5000.00 (Partial) towards loan LN-00019. — Ambika Gold Finance	loan	19	f	\N	0	\N	2026-08-25 13:32:23.567872+05:30	f	\N	1
56	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 18:29:43.107336+05:30	f	\N	1
57	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 18:29:47.853317+05:30	f	\N	1
58	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 19:16:48.071684+05:30	f	\N	1
59	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 19:16:52.742901+05:30	f	\N	1
62	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 20:29:43.011789+05:30	f	\N	1
63	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 20:29:48.381183+05:30	f	\N	1
64	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 21:14:08.501162+05:30	f	\N	1
65	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 21:14:13.764721+05:30	f	\N	1
66	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-24 21:29:42.910266+05:30	f	\N	1
67	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-24 21:29:47.923668+05:30	f	\N	1
68	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 07:59:40.081285+05:30	f	\N	1
69	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 07:59:40.102186+05:30	f	\N	1
70	3	loan_sanction	Loan Sanctioned	Dear adithyan cloudhouse, your gold loan LN-00020 has been sanctioned and ₹10000.00 has been disbursed. Due date: 24-Aug-2027. — Ambika Gold Finance	loan	20	f	\N	0	\N	2026-08-25 08:54:02.413905+05:30	f	\N	1
71	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 08:59:39.814973+05:30	f	\N	1
72	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 08:59:39.850538+05:30	f	\N	1
73	3	payment	Payment Received	Dear adithyan cloudhouse, we have received your payment of ₹10000.00 (Partial) towards loan LN-00020. — Ambika Gold Finance	loan	20	f	\N	0	\N	2026-08-25 09:09:55.94743+05:30	f	\N	1
74	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 10:09:01.334293+05:30	f	\N	1
75	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 10:09:01.354859+05:30	f	\N	1
76	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 11:09:01.275433+05:30	f	\N	1
77	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 11:09:01.29092+05:30	f	\N	1
78	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 12:09:01.255917+05:30	f	\N	1
79	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 12:09:01.271634+05:30	f	\N	1
80	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 13:09:01.229197+05:30	f	\N	1
81	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 13:09:01.242148+05:30	f	\N	1
82	3	payment	Payment Received	Dear adithyan cloudhouse, we have received your payment of ₹5000.00 (Partial) towards loan LN-00010. — Ambika Gold Finance	loan	10	f	\N	0	\N	2026-08-25 13:31:53.02842+05:30	f	\N	1
84	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 14:53:14.241134+05:30	f	\N	1
85	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 14:53:14.259805+05:30	f	\N	1
86	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 15:53:14.213364+05:30	f	\N	1
87	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 15:53:14.240389+05:30	f	\N	1
88	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-25 17:19:30.397367+05:30	f	\N	1
89	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-25 17:19:30.412721+05:30	f	\N	1
90	5	release_request	Release Approved	Dear adithyan, your gold release request for loan LN-00018 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	5	f	\N	0	\N	2026-08-28 10:11:15.221745+05:30	f	\N	1
91	5	release_request	Release Approved	Dear adithyan, your gold release request for loan LN-00018 has been fully approved. Closure is now being processed. — Ambika Gold Finance	loan_request	5	f	\N	0	\N	2026-08-28 10:11:29.797394+05:30	f	\N	1
92	3	loan_submission	Loan Application Submitted	Dear adithyan cloudhouse, your gold loan application LN-00021 for ₹10000.00 has been submitted and is pending approval. We'll notify you once it's sanctioned. — Ambika Gold Finance	loan	21	f	\N	0	\N	2026-08-28 10:14:31.2281+05:30	f	\N	1
93	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-28 11:06:16.753906+05:30	f	\N	1
94	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-28 11:06:16.795165+05:30	f	\N	1
95	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-28 13:36:23.052877+05:30	f	\N	1
96	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-28 13:36:23.086298+05:30	f	\N	1
97	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-28 13:36:23.143222+05:30	f	\N	1
98	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-28 13:36:23.159344+05:30	f	\N	1
99	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-28 13:36:23.167566+05:30	f	\N	1
100	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-28 14:42:13.384831+05:30	f	\N	1
101	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-28 14:42:13.411737+05:30	f	\N	1
102	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-28 14:42:13.419315+05:30	f	\N	1
103	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-28 14:42:13.427245+05:30	f	\N	1
104	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-28 14:42:13.435591+05:30	f	\N	1
105	3	loan_approval	Loan Approved	Dear adithyan cloudhouse, your gold loan application LN-00021 has been approved at one stage and is now awaiting Branch Manager approval. — Ambika Gold Finance	loan	21	f	\N	0	\N	2026-08-28 15:29:49.983128+05:30	f	\N	1
106	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-28 15:42:13.411152+05:30	f	\N	1
107	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-28 15:42:13.431083+05:30	f	\N	1
108	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-28 15:42:13.443676+05:30	f	\N	1
109	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-28 15:42:13.456756+05:30	f	\N	1
110	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-28 15:42:13.469656+05:30	f	\N	1
111	3	auction_event	Auction Eligible	Dear adithyan cloudhouse, your gold loan LN-00007 is seriously overdue and has now been marked eligible for auction. Outstanding: ₹50025.38. Please contact the branch immediately to settle and retain your pledged items. — Ambika Gold Finance	auction_record	2	f	\N	0	\N	2026-08-28 16:29:22.195708+05:30	f	\N	1
112	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-28 16:42:13.691783+05:30	f	\N	1
113	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-28 16:42:13.712797+05:30	f	\N	1
114	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-28 16:42:13.725026+05:30	f	\N	1
115	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-28 16:42:13.738312+05:30	f	\N	1
116	5	loan_overdue	Loan Overdue	Dear adithyan, your gold loan LN-00019 is now overdue (due date 14-Jul-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	19	f	\N	0	\N	2026-08-28 16:42:13.753725+05:30	f	\N	1
117	5	auction_event	Auction Eligible	Dear adithyan, your gold loan LN-00019 is seriously overdue and has now been marked eligible for auction. Outstanding: ₹5533.33. Please contact the branch immediately to settle and retain your pledged items. — Ambika Gold Finance	auction_record	3	f	\N	0	\N	2026-08-28 17:19:01.845924+05:30	f	\N	1
118	5	auction_notice	Auction Notice	Dear adithyan, your gold loan LN-00019 is overdue and has been marked for auction. Please contact the branch immediately to settle dues and avoid losing your pledged items.	auction_record	3	f	\N	0	\N	2026-08-28 17:26:28.301156+05:30	f	\N	1
119	5	auction_notice	Auction Notice	Dear adithyan, your gold loan LN-00019 is overdue and has been marked for auction. Please contact the branch immediately to settle dues and avoid losing your pledged items.	auction_record	3	f	\N	0	\N	2026-08-28 17:26:57.275651+05:30	f	\N	1
120	5	auction_event	Auction Scheduled	Dear adithyan, the auction of the gold pledged against loan LN-00019 has been scheduled for 28-Aug-2026 (ref ). You may still settle the outstanding dues before this date to reclaim your items. — Ambika Gold Finance	auction_record	3	f	\N	0	\N	2026-08-28 17:27:17.166697+05:30	f	\N	1
121	5	payment	Payment Received — Auction On Hold	Dear adithyan, we have received your payment of ₹5533.33 towards loan LN-00019. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — Ambika Gold Finance	loan	19	f	\N	0	\N	2026-08-28 17:29:28.192493+05:30	f	\N	1
122	5	release_request	Release Approved	Dear adithyan, your gold release request for loan LN-00019 has moved to the next approval stage (Management). — Ambika Gold Finance	loan_request	6	f	\N	0	\N	2026-08-28 17:33:52.91075+05:30	f	\N	1
123	5	release_request	Release Approved	Dear adithyan, your gold release request for loan LN-00019 has been fully approved. Closure is now being processed. — Ambika Gold Finance	loan_request	6	f	\N	0	\N	2026-08-28 17:34:07.846565+05:30	f	\N	1
124	3	payment	Payment Received — Auction On Hold	Dear adithyan cloudhouse, we have received your payment of ₹5000.00 towards loan LN-00007. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-28 17:35:58.426098+05:30	f	\N	1
125	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-28 17:42:18.625648+05:30	f	\N	1
126	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-28 17:42:23.004058+05:30	f	\N	1
127	4	loan_overdue	Loan Overdue	Dear Test Cust, your gold loan LN-00014 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	14	f	\N	0	\N	2026-08-28 17:42:28.712094+05:30	f	\N	1
128	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-28 17:42:33.354088+05:30	f	\N	1
163	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00007 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	7	f	\N	0	\N	2026-08-29 16:39:33.449147+05:30	f	\N	1
164	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00001 is now overdue (due date 05-May-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	1	f	\N	0	\N	2026-08-29 16:39:33.475598+05:30	f	\N	1
165	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00002 is now overdue (due date 17-Apr-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	2	f	\N	0	\N	2026-08-29 16:39:33.482272+05:30	f	\N	1
167	3	loan_overdue	Loan Overdue	Dear adithyan cloudhouse, your gold loan LN-00009 is now overdue (due date 31-Mar-2026). Please settle the outstanding amount at the earliest to avoid further action. — Ambika Gold Finance	loan	9	f	\N	0	\N	2026-08-29 16:39:33.490957+05:30	f	\N	1
\.


--
-- Data for Name: opening_cash_balances; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.opening_cash_balances (id, branch_id, balance_date, amount, created_at, tenant_id) FROM stdin;
1	1	2026-08-17 05:30:00+05:30	100000.00	2026-08-17 13:55:35.992209+05:30	1
2	1	2026-08-19 05:30:00+05:30	1000000.00	2026-08-19 10:55:13.713464+05:30	1
\.


--
-- Data for Name: ornament_images; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.ornament_images (id, ornament_id, image_url, created_at, tenant_id) FROM stdin;
7	13	/uploads/dafa1318a1260da2-marvels-spider-man-3840x2160-11990.jpeg	2026-08-13 15:49:53.025526+05:30	1
1	1	/uploads/3b93af65355ebab9-images.jfif	2026-08-10 17:06:42.687236+05:30	1
3	9	/uploads/d170850c2b7ac2b7-ChatGPT_Image_Jul_17_2026_10_37_11_AM.png	2026-08-12 14:54:31.905832+05:30	1
5	11	/uploads/6728ad9f1dd25fa1-marvels-spider-man-3840x2160-11990.jpeg	2026-08-13 15:40:32.00496+05:30	1
6	12	/uploads/26c4f864d71337da-marvels-spider-man-3840x2160-11990.jpeg	2026-08-13 15:47:05.552928+05:30	1
4	10	/uploads/ca785471306deab4-images.jfif	2026-08-12 17:07:11.350798+05:30	1
2	7	/uploads/3d3e126487b04f76-WhatsApp_Image_2026-07-23_at_4.14.01_PM.jpeg	2026-08-11 11:08:01.596481+05:30	1
\.


--
-- Data for Name: ornament_purity_tests; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.ornament_purity_tests (id, ornament_id, tested_purity, tested_gross_weight, tested_deduction_weight, tested_net_weight, testing_remarks, tested_by, tested_at, created_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: ornament_types; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.ornament_types (id, name, created_at, updated_at, tenant_id) FROM stdin;
1	Gold Chain	2026-08-11 11:07:02.972218+05:30	2026-08-11 11:07:02.972218+05:30	1
2	Ring	2026-08-11 17:27:59.178672+05:30	2026-08-11 17:27:59.178672+05:30	1
3	bangles	2026-08-12 14:51:01.099116+05:30	2026-08-12 14:51:01.099116+05:30	1
\.


--
-- Data for Name: ornaments; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.ornaments (id, loan_id, name, purity, gross_weight, deduction_weight, net_weight, quantity, gold_value, remarks, created_at, updated_at, tenant_id) FROM stdin;
5	5	Ring	22K	5	0	5	1	27500.00		2026-08-10 18:29:08.875162+05:30	2026-08-10 18:29:08.875162+05:30	1
4	4	Chain	22K	10	0	10	1	55000.00		2026-08-10 18:28:24.485457+05:30	2026-08-10 18:28:24.485457+05:30	1
6	6	Gold Chain	22K	2	0	2	1	11000.00		2026-08-10 18:44:24.269485+05:30	2026-08-10 18:44:24.269485+05:30	1
8	8	Gold Chain	22K	1	0	1	1	8000.00		2026-08-11 11:36:27.511307+05:30	2026-08-11 11:36:27.511307+05:30	1
13	13	Gold Chain	22K	12	0	12	1	99000.00		2026-08-13 15:49:47.210652+05:30	2026-08-13 15:49:47.210652+05:30	1
1	1	Gold Chain	22K	10	0	10	1	66900.00		2026-08-10 17:06:42.671955+05:30	2026-08-10 17:06:42.671955+05:30	1
2	2	Gold Chain	22K	10	0	10	1	70000.00		2026-08-10 17:03:19.778655+05:30	2026-08-10 17:03:19.778655+05:30	1
16	16	Ring	22K	10	0	10	1	143350.00		2026-08-18 15:04:52.576475+05:30	2026-08-18 15:04:52.576475+05:30	1
21	21	bangles	22K	1	0	1	1	12833.00		2026-08-28 10:14:31.205728+05:30	2026-08-28 10:14:31.205728+05:30	1
14	14	Gold Chain	22K	12	0	12	1	171228.00		2026-08-17 13:56:09.991838+05:30	2026-08-17 13:56:09.991838+05:30	1
9	9	bangles	24K	10	0	10	1	100000.00		2026-08-12 14:54:31.888431+05:30	2026-08-12 14:54:31.888431+05:30	1
15	15	Gold Chain	22K	12	0	12	1	171228.00		2026-08-17 13:56:15.69277+05:30	2026-08-17 13:56:15.69277+05:30	1
11	11	Gold Chain	22K	10	0	10	1	82500.00		2026-08-13 15:40:31.73371+05:30	2026-08-13 15:40:31.73371+05:30	1
12	12	bangles	22K	10	0	10	1	82500.00		2026-08-13 15:47:00.977489+05:30	2026-08-13 15:47:00.977489+05:30	1
17	17	Gold Chain	22K	1	0	1	1	14335.00		2026-08-18 18:08:08.652115+05:30	2026-08-18 18:08:08.652115+05:30	1
20	20	bangles	22K	1	0	1	1	14442.00		2026-08-24 16:51:44.510795+05:30	2026-08-24 16:51:44.510795+05:30	1
10	10	Gold Chain	24K	10	0	10	1	100000.00		2026-08-12 17:07:11.337105+05:30	2026-08-12 17:07:11.337105+05:30	1
19	19	Bangle	22K	1	0	1	1	14442.00		2026-08-19 14:38:56.522912+05:30	2026-08-19 14:38:56.522912+05:30	1
18	18	Gold Chain	22K	1	0	1	1	14442.00		2026-08-19 14:25:34.983108+05:30	2026-08-19 14:25:34.983108+05:30	1
7	7	Gold Chain	22K	7	0	7	1	56000.00		2026-08-11 11:08:01.5848+05:30	2026-08-11 11:08:01.5848+05:30	1
\.


--
-- Data for Name: packet_movements; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.packet_movements (id, packet_id, from_status, to_status, locker_id, actor_employee_id, remarks, created_at, tenant_id) FROM stdin;
4	2		Packet Generated	\N	0		2026-08-10 18:28:24.489644+05:30	1
5	2	Packet Generated	Locker Stored	2	1		2026-08-10 18:28:59.299346+05:30	1
6	3		Packet Generated	\N	0		2026-08-10 18:29:08.878+05:30	1
7	2	Locker Stored	Bank Pledged	\N	0	Bank pledge: TestBank	2026-08-10 18:29:27.165176+05:30	1
8	2	Bank Pledged	Returned	\N	0	Gold returned from bank: TestBank	2026-08-10 18:29:44.359925+05:30	1
9	4		Packet Generated	\N	0		2026-08-10 18:44:24.277199+05:30	1
10	4	Packet Generated	Locker Stored	2	1		2026-08-11 10:57:15.085735+05:30	1
11	5		Packet Generated	\N	0		2026-08-11 11:08:01.588971+05:30	1
12	5	Packet Generated	Locker Stored	2	1		2026-08-11 11:34:46.920792+05:30	1
13	6		Packet Generated	\N	0		2026-08-11 11:36:27.515055+05:30	1
14	6	Packet Generated	Locker Stored	2	1		2026-08-11 11:38:40.295561+05:30	1
15	6	Locker Stored	Bank Pledged	\N	0	Bank pledge: SBI back	2026-08-11 11:39:52.186921+05:30	1
16	6	Bank Pledged	Returned	\N	0	Gold returned from bank: SBI back	2026-08-11 11:46:58.748402+05:30	1
17	7		Locker Stored	2	0	Locker assigned at packet creation	2026-08-12 14:54:31.895258+05:30	1
18	8		Locker Stored	2	0	Locker assigned at packet creation	2026-08-12 17:07:11.342316+05:30	1
19	9		Packet Generated	\N	0		2026-08-13 15:40:31.745453+05:30	1
20	10		Packet Generated	\N	0		2026-08-13 15:47:00.9804+05:30	1
21	11		Locker Stored	2	0	Locker assigned at packet creation	2026-08-13 15:49:47.225948+05:30	1
22	12		Locker Stored	2	0	Locker assigned at packet creation	2026-08-17 13:56:15.700185+05:30	1
23	12	Locker Stored	Ready For Release	\N	1		2026-08-17 17:58:17.102502+05:30	1
24	12	Ready For Release	Released	\N	1		2026-08-17 17:58:19.850152+05:30	1
25	10	Packet Generated	Locker Stored	2	1		2026-08-18 10:42:37.182103+05:30	1
26	13		Packet Generated	\N	0		2026-08-18 15:04:52.593028+05:30	1
27	14		Locker Stored	2	0	Locker assigned at packet creation	2026-08-18 18:08:08.667316+05:30	1
28	15		Packet Generated	\N	0		2026-08-19 14:25:35.002815+05:30	1
29	16		Packet Generated	\N	0		2026-08-19 14:38:56.529472+05:30	1
30	17		Locker Stored	2	0	Locker assigned at packet creation	2026-08-24 16:51:44.527884+05:30	1
31	17	Locker Stored	Bank Pledged	\N	1		2026-08-24 16:52:38.95722+05:30	1
32	14	Locker Stored	Bank Pledged	\N	1		2026-08-24 16:52:53.506788+05:30	1
33	16	Packet Generated	Locker Stored	2	1		2026-08-25 08:54:28.844608+05:30	1
34	16	Locker Stored	Bank Pledged	\N	0	Bank pledge: SBI back	2026-08-25 08:55:00.993865+05:30	1
35	16	Bank Pledged	Returned	\N	0	Gold returned from bank: SBI back	2026-08-25 08:55:25.263422+05:30	1
36	13	Packet Generated	Locker Stored	2	1		2026-08-28 10:13:32.836455+05:30	1
37	18		Locker Stored	4	0	Locker assigned at packet creation	2026-08-28 10:14:31.218371+05:30	1
38	16	Returned	Ready For Release	\N	0	Gold released to customer	2026-08-28 18:25:09.143159+05:30	1
39	16	Ready For Release	Released	\N	0	Gold released to customer	2026-08-28 18:25:09.148164+05:30	1
40	6	Returned	Ready For Release	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.094122+05:30	1
41	6	Ready For Release	Released	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.096959+05:30	1
42	15	Packet Generated	Ready For Release	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.098004+05:30	1
43	15	Ready For Release	Released	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.098568+05:30	1
44	17	Bank Pledged	Ready For Release	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.099153+05:30	1
45	17	Ready For Release	Released	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.099712+05:30	1
46	14	Bank Pledged	Ready For Release	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.10028+05:30	1
47	14	Ready For Release	Released	\N	0	Backfill: loan's gold already left custody	2026-09-04 14:39:52.10028+05:30	1
\.


--
-- Data for Name: packets; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.packets (id, code, loan_id, status, current_locker_id, created_at, updated_at, tenant_id) FROM stdin;
3	PKT-000002	5	Packet Generated	\N	2026-08-10 18:29:08.877404+05:30	2026-08-10 18:29:08.877404+05:30	1
2	PKT-000001	4	Returned	\N	2026-08-10 18:28:24.488857+05:30	2026-08-10 18:29:44.359925+05:30	1
4	PKT-000003	6	Locker Stored	2	2026-08-10 18:44:24.276631+05:30	2026-08-11 10:57:15.082494+05:30	1
5	PKT-000004	7	Locker Stored	2	2026-08-11 11:08:01.587938+05:30	2026-08-11 11:34:46.920189+05:30	1
7	PKT-000006	9	Locker Stored	2	2026-08-12 14:54:31.893986+05:30	2026-08-12 14:54:31.893986+05:30	1
8	PKT-000007	10	Locker Stored	2	2026-08-12 17:07:11.341147+05:30	2026-08-12 17:07:11.341147+05:30	1
9	PKT-000008	11	Packet Generated	\N	2026-08-13 15:40:31.744825+05:30	2026-08-13 15:40:31.744825+05:30	1
11	PKT-000010	13	Locker Stored	2	2026-08-13 15:49:47.224786+05:30	2026-08-13 15:49:47.224786+05:30	1
12	PKT-000011	15	Released	\N	2026-08-17 13:56:15.696122+05:30	2026-08-17 17:58:19.849625+05:30	1
10	PKT-000009	12	Locker Stored	2	2026-08-13 15:47:00.979849+05:30	2026-08-18 10:42:37.17795+05:30	1
13	PKT-000012	16	Locker Stored	2	2026-08-18 15:04:52.59057+05:30	2026-08-28 10:13:32.83557+05:30	1
18	PKT-000017	21	Locker Stored	4	2026-08-28 10:14:31.217806+05:30	2026-08-28 10:14:31.217806+05:30	1
16	PKT-000015	19	Released	\N	2026-08-19 14:38:56.527846+05:30	2026-08-28 18:25:09.147624+05:30	1
6	PKT-000005	8	Released	\N	2026-08-11 11:36:27.514403+05:30	2026-09-04 14:39:52.097487+05:30	1
15	PKT-000014	18	Released	\N	2026-08-19 14:25:35.001776+05:30	2026-09-04 14:39:52.098568+05:30	1
17	PKT-000016	20	Released	\N	2026-08-24 16:51:44.525954+05:30	2026-09-04 14:39:52.099712+05:30	1
14	PKT-000013	17	Released	\N	2026-08-18 18:08:08.666455+05:30	2026-09-04 14:39:52.100796+05:30	1
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.permissions (id, name, description, module_name, is_active) FROM stdin;
1	can view branch	View branches	Branch Management	t
3	can view scheme	View loan schemes	Scheme Management	t
5	can view gold rate	View gold rate history	Gold Rate Management	t
7	can view purity standard	View gold purity standards	Purity Standard Management	t
9	can view employee	View employees	Employee Management	t
11	can view cash	View cash movements, expenses and opening balance	Cash Management	t
13	can view setting	View integration API key settings	Settings Management	t
15	can view customer	View customers and KYC	Customer Management	t
17	can view loan	View loans, ornaments, approvals, payments, requests and auctions	Loan Management	t
19	can view bank pledge	View bank pledge records	Bank Pledge Management	t
21	can view upload	View uploaded files	Upload Management	t
23	can view ornament type	View ornament types	Ornament Type Management	t
25	can view bank	View banks (gold re-pledging counterparties)	Bank Management	t
27	can view locker	View lockers	Locker Management	t
29	can view packet	View gold packets	Packet Management	t
31	can view reminder	View reminders	Reminder Management	t
33	can view report	View and export management reports	Report Management	t
34	can view role and permission	View roles and their permission grants	Role Management	t
67	can create bank pledge	Create bank pledges	Bank Pledge Management	t
36	can create role	Create new roles	Role Management	t
37	can update role	Rename roles and edit their descriptions	Role Management	t
38	can delete role	Delete roles	Role Management	t
40	can create branch	Create branches	Branch Management	t
41	can update branch	Update branches	Branch Management	t
42	can delete branch	Delete branches	Branch Management	t
43	can create scheme	Create loan schemes	Scheme Management	t
44	can update scheme	Update loan schemes	Scheme Management	t
45	can delete scheme	Delete loan schemes	Scheme Management	t
46	can create gold rate	Record a new gold rate	Gold Rate Management	t
47	can update gold rate	Update a gold rate record	Gold Rate Management	t
48	can delete gold rate	Delete a gold rate record	Gold Rate Management	t
49	can create purity standard	Create purity standards	Purity Standard Management	t
50	can update purity standard	Update purity standards	Purity Standard Management	t
51	can delete purity standard	Delete purity standards	Purity Standard Management	t
52	can create employee	Create employees	Employee Management	t
53	can update employee	Update employees	Employee Management	t
54	can delete employee	Delete employees	Employee Management	t
55	can create cash	Record cash movements and expenses	Cash Management	t
56	can update cash	Update cash movements and expenses	Cash Management	t
57	can delete cash	Delete cash movements and expenses	Cash Management	t
58	can create setting	Create integration API key settings	Settings Management	t
59	can update setting	Update integration API key settings	Settings Management	t
60	can delete setting	Delete integration API key settings	Settings Management	t
61	can create customer	Create customers	Customer Management	t
62	can update customer	Update customers	Customer Management	t
63	can delete customer	Delete customers	Customer Management	t
64	can create loan	Create loans, ornaments, drafts, requests and payments	Loan Management	t
65	can update loan	Update and act on loans, ornaments, approvals, payments, requests and auctions	Loan Management	t
66	can delete loan	Delete loans, ornaments, drafts, requests and payments	Loan Management	t
68	can update bank pledge	Update, release and void bank pledges	Bank Pledge Management	t
69	can delete bank pledge	Delete bank pledges	Bank Pledge Management	t
70	can create upload	Upload files	Upload Management	t
71	can update upload	Update uploaded files	Upload Management	t
72	can delete upload	Delete uploaded files	Upload Management	t
73	can create ornament type	Create ornament types	Ornament Type Management	t
74	can update ornament type	Update ornament types	Ornament Type Management	t
75	can delete ornament type	Delete ornament types	Ornament Type Management	t
76	can create bank	Create banks	Bank Management	t
77	can update bank	Update banks	Bank Management	t
78	can delete bank	Delete banks	Bank Management	t
79	can create locker	Create lockers	Locker Management	t
80	can update locker	Update lockers	Locker Management	t
81	can delete locker	Delete lockers	Locker Management	t
82	can create packet	Create gold packets	Packet Management	t
83	can update packet	Update gold packets	Packet Management	t
84	can delete packet	Delete gold packets	Packet Management	t
85	can create reminder	Create reminders	Reminder Management	t
86	can update reminder	Update reminders	Reminder Management	t
87	can delete reminder	Delete reminders	Reminder Management	t
88	can view audit log	View the record of employee and branch changes	Audit Log	t
89	can manage billing	Subscribe to or renew this business's plan, and view billing status	Billing	t
90	can view personal loan	View personal loans, schedules and payments	Personal Loan Management	t
91	can create personal loan	Create personal loans	Personal Loan Management	t
92	can update personal loan	Record payments, renew and manage personal loans	Personal Loan Management	t
93	can delete personal loan	Delete personal loans	Personal Loan Management	t
94	can verify loan	Verify a loan at the Loan Operator sanction stage	Loan Sanction	t
95	can approve branch manager stage	Approve a loan at the Branch Manager sanction stage	Loan Sanction	t
96	can sanction loan	Give final sanction to a loan (Management stage)	Loan Sanction	t
97	can verify the loan extension	Verify a loan extension request at the Loan Officer stage	Loan Extension Approval	t
98	can approve extension branch manager stage	Approve a loan extension request at the Branch Manager stage	Loan Extension Approval	t
99	can approve extension management stage	Approve a loan extension request at the Management stage	Loan Extension Approval	t
100	can verify release checklist	Verify a gold release request's checklist (payment, packet, bank pledge, customer confirmation) before it goes to the Manager/Management approval stages	Release Approval	t
101	can approve release manager stage	Approve a gold release request at the Manager stage	Release Approval	t
102	can approve release management stage	Approve a gold release request at the Management stage	Release Approval	t
103	can decide auction partial repayment	Decide whether a loan stays in or is removed from auction after a partial repayment	Auction Workflow	t
104	can decide auction shortfall	Decide whether an auction shortfall is pursued or written off	Auction Workflow	t
105	can mark loan auction eligible	Mark a defaulted loan eligible for auction	Auction Workflow	t
106	can issue auction notice	Issue an auction notice to the customer	Auction Workflow	t
107	can schedule auction	Schedule an auction date for a loan	Auction Workflow	t
108	can record auction sale	Record the sale amount and expenses of a conducted auction	Auction Workflow	t
109	can settle auction	Settle an auction's surplus disposition	Auction Workflow	t
\.


--
-- Data for Name: personal_loan_installments; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.personal_loan_installments (id, personal_loan_id, sequence_no, due_date, amount, status, paid_amount, created_at, updated_at, tenant_id) FROM stdin;
1	1	1	2026-10-04 14:46:08.554256+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.773331+05:30	2026-09-04 14:46:08.773331+05:30	0
2	1	2	2026-11-04 14:46:08.554256+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.773331+05:30	2026-09-04 14:46:08.773331+05:30	0
3	1	3	2026-12-04 14:46:08.554256+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.773331+05:30	2026-09-04 14:46:08.773331+05:30	0
4	1	4	2027-01-04 14:46:08.554256+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.773331+05:30	2026-09-04 14:46:08.773331+05:30	0
5	1	5	2027-02-04 14:46:08.554256+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.773331+05:30	2026-09-04 14:46:08.773331+05:30	0
6	1	6	2027-03-04 14:46:08.554256+05:30	1666.65	Pending	0.00	2026-09-04 14:46:08.773331+05:30	2026-09-04 14:46:08.773331+05:30	0
7	2	1	2026-10-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
8	2	2	2026-11-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
9	2	3	2026-12-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
10	2	4	2027-01-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
11	2	5	2027-02-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
12	2	6	2027-03-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
13	2	7	2027-04-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
14	2	8	2027-05-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
15	2	9	2027-06-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
16	2	10	2027-07-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
17	2	11	2027-08-04 14:46:08.778255+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
18	2	12	2027-09-04 14:46:08.778255+05:30	2083.37	Pending	0.00	2026-09-04 14:46:08.779535+05:30	2026-09-04 14:46:08.779535+05:30	0
19	3	1	2026-09-11 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
20	3	2	2026-09-18 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
21	3	3	2026-09-25 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
22	3	4	2026-10-02 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
23	3	5	2026-10-09 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
24	3	6	2026-10-16 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
25	3	7	2026-10-23 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
26	3	8	2026-10-30 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
27	3	9	2026-11-06 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
28	3	10	2026-11-13 14:46:08.780781+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.781373+05:30	2026-09-04 14:46:08.781373+05:30	0
29	4	1	2026-10-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
30	4	2	2026-11-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
31	4	3	2026-12-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
32	4	4	2027-01-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
33	4	5	2027-02-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
34	4	6	2027-03-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
35	4	7	2027-04-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
36	4	8	2027-05-04 14:46:08.782449+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
37	4	9	2027-06-04 14:46:08.782449+05:30	1666.64	Pending	0.00	2026-09-04 14:46:08.78314+05:30	2026-09-04 14:46:08.78314+05:30	0
38	5	1	2026-09-05 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
39	5	2	2026-09-06 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
40	5	3	2026-09-07 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
41	5	4	2026-09-08 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
42	5	5	2026-09-09 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
43	5	6	2026-09-10 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
44	5	7	2026-09-11 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
45	5	8	2026-09-12 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
46	5	9	2026-09-13 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
47	5	10	2026-09-14 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
48	5	11	2026-09-15 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
49	5	12	2026-09-16 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
50	5	13	2026-09-17 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
51	5	14	2026-09-18 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
52	5	15	2026-09-19 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
53	5	16	2026-09-20 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
54	5	17	2026-09-21 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
55	5	18	2026-09-22 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
56	5	19	2026-09-23 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
57	5	20	2026-09-24 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
58	5	21	2026-09-25 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
59	5	22	2026-09-26 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
60	5	23	2026-09-27 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
61	5	24	2026-09-28 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
62	5	25	2026-09-29 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
63	5	26	2026-09-30 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
64	5	27	2026-10-01 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
65	5	28	2026-10-02 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
66	5	29	2026-10-03 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
67	5	30	2026-10-04 14:46:08.78421+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.784733+05:30	2026-09-04 14:46:08.784733+05:30	0
68	6	1	2026-10-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
69	6	2	2026-11-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
70	6	3	2026-12-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
71	6	4	2027-01-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
72	6	5	2027-02-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
73	6	6	2027-03-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
74	6	7	2027-04-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
75	6	8	2027-05-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
76	6	9	2027-06-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
77	6	10	2027-07-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
78	6	11	2027-08-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
79	6	12	2027-09-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
80	6	13	2027-10-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
81	6	14	2027-11-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
82	6	15	2027-12-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
83	6	16	2028-01-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
84	6	17	2028-02-04 14:46:08.787157+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
85	6	18	2028-03-04 14:46:08.787157+05:30	2777.74	Pending	0.00	2026-09-04 14:46:08.787679+05:30	2026-09-04 14:46:08.787679+05:30	0
86	7	1	2026-09-11 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
87	7	2	2026-09-18 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
88	7	3	2026-09-25 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
89	7	4	2026-10-02 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
90	7	5	2026-10-09 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
91	7	6	2026-10-16 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
92	7	7	2026-10-23 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
93	7	8	2026-10-30 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
94	7	9	2026-11-06 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
95	7	10	2026-11-13 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
96	7	11	2026-11-20 14:46:08.789996+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
97	7	12	2026-11-27 14:46:08.789996+05:30	666.63	Pending	0.00	2026-09-04 14:46:08.790542+05:30	2026-09-04 14:46:08.790542+05:30	0
98	8	1	2026-10-04 14:46:08.791232+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.791814+05:30	2026-09-04 14:46:08.791814+05:30	0
99	8	2	2026-11-04 14:46:08.791232+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.791814+05:30	2026-09-04 14:46:08.791814+05:30	0
100	8	3	2026-12-04 14:46:08.791232+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.791814+05:30	2026-09-04 14:46:08.791814+05:30	0
101	8	4	2027-01-04 14:46:08.791232+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.791814+05:30	2026-09-04 14:46:08.791814+05:30	0
102	8	5	2027-02-04 14:46:08.791232+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.791814+05:30	2026-09-04 14:46:08.791814+05:30	0
103	8	6	2027-03-04 14:46:08.791232+05:30	1666.65	Pending	0.00	2026-09-04 14:46:08.791814+05:30	2026-09-04 14:46:08.791814+05:30	0
104	9	1	2026-10-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
105	9	2	2026-11-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
106	9	3	2026-12-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
107	9	4	2027-01-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
108	9	5	2027-02-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
109	9	6	2027-03-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
110	9	7	2027-04-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
111	9	8	2027-05-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
112	9	9	2027-06-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
113	9	10	2027-07-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
114	9	11	2027-08-04 14:46:08.79241+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
115	9	12	2027-09-04 14:46:08.79241+05:30	2083.37	Pending	0.00	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	0
116	10	1	2026-09-11 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
117	10	2	2026-09-18 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
118	10	3	2026-09-25 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
119	10	4	2026-10-02 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
120	10	5	2026-10-09 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
121	10	6	2026-10-16 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
122	10	7	2026-10-23 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
123	10	8	2026-10-30 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
124	10	9	2026-11-06 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
125	10	10	2026-11-13 14:46:08.793642+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	0
126	11	1	2026-10-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
127	11	2	2026-11-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
128	11	3	2026-12-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
129	11	4	2027-01-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
130	11	5	2027-02-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
131	11	6	2027-03-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
132	11	7	2027-04-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
133	11	8	2027-05-04 14:46:08.794692+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
134	11	9	2027-06-04 14:46:08.794692+05:30	1666.64	Pending	0.00	2026-09-04 14:46:08.795205+05:30	2026-09-04 14:46:08.795205+05:30	0
135	12	1	2026-09-05 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
136	12	2	2026-09-06 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
137	12	3	2026-09-07 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
138	12	4	2026-09-08 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
139	12	5	2026-09-09 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
140	12	6	2026-09-10 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
141	12	7	2026-09-11 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
142	12	8	2026-09-12 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
143	12	9	2026-09-13 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
144	12	10	2026-09-14 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
145	12	11	2026-09-15 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
146	12	12	2026-09-16 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
147	12	13	2026-09-17 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
148	12	14	2026-09-18 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
149	12	15	2026-09-19 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
150	12	16	2026-09-20 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
151	12	17	2026-09-21 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
152	12	18	2026-09-22 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
153	12	19	2026-09-23 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
154	12	20	2026-09-24 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
155	12	21	2026-09-25 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
156	12	22	2026-09-26 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
157	12	23	2026-09-27 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
158	12	24	2026-09-28 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
159	12	25	2026-09-29 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
160	12	26	2026-09-30 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
161	12	27	2026-10-01 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
162	12	28	2026-10-02 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
163	12	29	2026-10-03 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
164	12	30	2026-10-04 14:46:08.795849+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.796421+05:30	2026-09-04 14:46:08.796421+05:30	0
165	13	1	2026-10-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
166	13	2	2026-11-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
167	13	3	2026-12-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
168	13	4	2027-01-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
169	13	5	2027-02-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
170	13	6	2027-03-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
171	13	7	2027-04-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
172	13	8	2027-05-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
173	13	9	2027-06-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
174	13	10	2027-07-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
175	13	11	2027-08-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
176	13	12	2027-09-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
177	13	13	2027-10-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
178	13	14	2027-11-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
179	13	15	2027-12-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
180	13	16	2028-01-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
181	13	17	2028-02-04 14:46:08.797199+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
182	13	18	2028-03-04 14:46:08.797199+05:30	2777.74	Pending	0.00	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	0
183	14	1	2026-09-11 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
184	14	2	2026-09-18 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
185	14	3	2026-09-25 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
186	14	4	2026-10-02 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
187	14	5	2026-10-09 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
188	14	6	2026-10-16 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
189	14	7	2026-10-23 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
190	14	8	2026-10-30 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
191	14	9	2026-11-06 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
192	14	10	2026-11-13 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
193	14	11	2026-11-20 14:46:08.798423+05:30	666.67	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
194	14	12	2026-11-27 14:46:08.798423+05:30	666.63	Pending	0.00	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	0
195	15	1	2026-10-04 14:46:08.799531+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.800065+05:30	2026-09-04 14:46:08.800065+05:30	0
196	15	2	2026-11-04 14:46:08.799531+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.800065+05:30	2026-09-04 14:46:08.800065+05:30	0
197	15	3	2026-12-04 14:46:08.799531+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.800065+05:30	2026-09-04 14:46:08.800065+05:30	0
198	15	4	2027-01-04 14:46:08.799531+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.800065+05:30	2026-09-04 14:46:08.800065+05:30	0
199	15	5	2027-02-04 14:46:08.799531+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.800065+05:30	2026-09-04 14:46:08.800065+05:30	0
200	15	6	2027-03-04 14:46:08.799531+05:30	1666.65	Pending	0.00	2026-09-04 14:46:08.800065+05:30	2026-09-04 14:46:08.800065+05:30	0
201	16	1	2026-10-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
202	16	2	2026-11-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
203	16	3	2026-12-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
204	16	4	2027-01-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
205	16	5	2027-02-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
206	16	6	2027-03-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
207	16	7	2027-04-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
208	16	8	2027-05-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
209	16	9	2027-06-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
210	16	10	2027-07-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
211	16	11	2027-08-04 14:46:08.800616+05:30	2083.33	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
212	16	12	2027-09-04 14:46:08.800616+05:30	2083.37	Pending	0.00	2026-09-04 14:46:08.801156+05:30	2026-09-04 14:46:08.801156+05:30	0
213	17	1	2026-09-11 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
214	17	2	2026-09-18 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
215	17	3	2026-09-25 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
216	17	4	2026-10-02 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
217	17	5	2026-10-09 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
218	17	6	2026-10-16 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
219	17	7	2026-10-23 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
220	17	8	2026-10-30 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
221	17	9	2026-11-06 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
222	17	10	2026-11-13 14:46:08.801663+05:30	500.00	Pending	0.00	2026-09-04 14:46:08.802251+05:30	2026-09-04 14:46:08.802251+05:30	0
223	18	1	2026-10-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
224	18	2	2026-11-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
225	18	3	2026-12-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
226	18	4	2027-01-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
227	18	5	2027-02-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
228	18	6	2027-03-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
229	18	7	2027-04-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
230	18	8	2027-05-04 14:46:08.802766+05:30	1666.67	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
231	18	9	2027-06-04 14:46:08.802766+05:30	1666.64	Pending	0.00	2026-09-04 14:46:08.803273+05:30	2026-09-04 14:46:08.803273+05:30	0
232	19	1	2026-09-05 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
233	19	2	2026-09-06 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
234	19	3	2026-09-07 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
235	19	4	2026-09-08 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
236	19	5	2026-09-09 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
237	19	6	2026-09-10 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
238	19	7	2026-09-11 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
239	19	8	2026-09-12 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
240	19	9	2026-09-13 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
241	19	10	2026-09-14 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
242	19	11	2026-09-15 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
243	19	12	2026-09-16 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
244	19	13	2026-09-17 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
245	19	14	2026-09-18 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
246	19	15	2026-09-19 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
247	19	16	2026-09-20 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
248	19	17	2026-09-21 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
249	19	18	2026-09-22 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
250	19	19	2026-09-23 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
251	19	20	2026-09-24 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
252	19	21	2026-09-25 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
253	19	22	2026-09-26 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
254	19	23	2026-09-27 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
255	19	24	2026-09-28 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
256	19	25	2026-09-29 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
257	19	26	2026-09-30 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
258	19	27	2026-10-01 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
259	19	28	2026-10-02 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
260	19	29	2026-10-03 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
261	19	30	2026-10-04 14:46:08.803788+05:30	100.00	Pending	0.00	2026-09-04 14:46:08.80437+05:30	2026-09-04 14:46:08.80437+05:30	0
262	20	1	2026-10-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
263	20	2	2026-11-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
264	20	3	2026-12-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
265	20	4	2027-01-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
266	20	5	2027-02-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
267	20	6	2027-03-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
268	20	7	2027-04-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
269	20	8	2027-05-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
270	20	9	2027-06-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
271	20	10	2027-07-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
272	20	11	2027-08-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
273	20	12	2027-09-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
274	20	13	2027-10-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
275	20	14	2027-11-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
276	20	15	2027-12-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
277	20	16	2028-01-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
278	20	17	2028-02-04 14:46:08.805418+05:30	2777.78	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
279	20	18	2028-03-04 14:46:08.805418+05:30	2777.74	Pending	0.00	2026-09-04 14:46:08.805935+05:30	2026-09-04 14:46:08.805935+05:30	0
280	21	1	2026-10-04 14:47:47.787608+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.836931+05:30	2026-09-04 14:47:47.836931+05:30	0
281	21	2	2026-11-04 14:47:47.787608+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.836931+05:30	2026-09-04 14:47:47.836931+05:30	0
282	21	3	2026-12-04 14:47:47.787608+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.836931+05:30	2026-09-04 14:47:47.836931+05:30	0
283	21	4	2027-01-04 14:47:47.787608+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.836931+05:30	2026-09-04 14:47:47.836931+05:30	0
284	21	5	2027-02-04 14:47:47.787608+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.836931+05:30	2026-09-04 14:47:47.836931+05:30	0
285	21	6	2027-03-04 14:47:47.787608+05:30	1666.65	Pending	0.00	2026-09-04 14:47:47.836931+05:30	2026-09-04 14:47:47.836931+05:30	0
286	22	1	2026-10-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
287	22	2	2026-11-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
288	22	3	2026-12-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
289	22	4	2027-01-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
290	22	5	2027-02-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
291	22	6	2027-03-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
292	22	7	2027-04-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
293	22	8	2027-05-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
294	22	9	2027-06-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
295	22	10	2027-07-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
296	22	11	2027-08-04 14:47:47.848703+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
297	22	12	2027-09-04 14:47:47.848703+05:30	2083.37	Pending	0.00	2026-09-04 14:47:47.849557+05:30	2026-09-04 14:47:47.849557+05:30	0
298	23	1	2026-09-11 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
299	23	2	2026-09-18 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
300	23	3	2026-09-25 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
301	23	4	2026-10-02 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
302	23	5	2026-10-09 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
303	23	6	2026-10-16 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
304	23	7	2026-10-23 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
305	23	8	2026-10-30 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
306	23	9	2026-11-06 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
307	23	10	2026-11-13 14:47:47.850598+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	0
308	24	1	2026-10-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
309	24	2	2026-11-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
310	24	3	2026-12-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
311	24	4	2027-01-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
312	24	5	2027-02-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
313	24	6	2027-03-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
314	24	7	2027-04-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
315	24	8	2027-05-04 14:47:47.852695+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
316	24	9	2027-06-04 14:47:47.852695+05:30	1666.64	Pending	0.00	2026-09-04 14:47:47.853429+05:30	2026-09-04 14:47:47.853429+05:30	0
317	25	1	2026-09-05 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
318	25	2	2026-09-06 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
319	25	3	2026-09-07 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
320	25	4	2026-09-08 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
321	25	5	2026-09-09 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
322	25	6	2026-09-10 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
323	25	7	2026-09-11 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
324	25	8	2026-09-12 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
325	25	9	2026-09-13 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
326	25	10	2026-09-14 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
327	25	11	2026-09-15 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
328	25	12	2026-09-16 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
329	25	13	2026-09-17 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
330	25	14	2026-09-18 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
331	25	15	2026-09-19 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
332	25	16	2026-09-20 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
333	25	17	2026-09-21 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
334	25	18	2026-09-22 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
335	25	19	2026-09-23 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
336	25	20	2026-09-24 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
337	25	21	2026-09-25 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
338	25	22	2026-09-26 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
339	25	23	2026-09-27 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
340	25	24	2026-09-28 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
341	25	25	2026-09-29 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
342	25	26	2026-09-30 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
343	25	27	2026-10-01 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
344	25	28	2026-10-02 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
345	25	29	2026-10-03 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
346	25	30	2026-10-04 14:47:47.854802+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	0
347	26	1	2026-10-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
348	26	2	2026-11-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
349	26	3	2026-12-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
350	26	4	2027-01-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
351	26	5	2027-02-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
352	26	6	2027-03-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
353	26	7	2027-04-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
354	26	8	2027-05-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
355	26	9	2027-06-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
356	26	10	2027-07-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
357	26	11	2027-08-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
358	26	12	2027-09-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
359	26	13	2027-10-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
360	26	14	2027-11-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
361	26	15	2027-12-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
362	26	16	2028-01-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
363	26	17	2028-02-04 14:47:47.857702+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
364	26	18	2028-03-04 14:47:47.857702+05:30	2777.74	Pending	0.00	2026-09-04 14:47:47.858757+05:30	2026-09-04 14:47:47.858757+05:30	0
365	27	1	2026-09-11 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
366	27	2	2026-09-18 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
367	27	3	2026-09-25 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
368	27	4	2026-10-02 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
369	27	5	2026-10-09 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
370	27	6	2026-10-16 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
371	27	7	2026-10-23 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
372	27	8	2026-10-30 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
373	27	9	2026-11-06 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
374	27	10	2026-11-13 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
375	27	11	2026-11-20 14:47:47.861443+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
376	27	12	2026-11-27 14:47:47.861443+05:30	666.63	Pending	0.00	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	0
377	28	1	2026-10-04 14:47:47.862572+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.863158+05:30	2026-09-04 14:47:47.863158+05:30	0
378	28	2	2026-11-04 14:47:47.862572+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.863158+05:30	2026-09-04 14:47:47.863158+05:30	0
379	28	3	2026-12-04 14:47:47.862572+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.863158+05:30	2026-09-04 14:47:47.863158+05:30	0
380	28	4	2027-01-04 14:47:47.862572+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.863158+05:30	2026-09-04 14:47:47.863158+05:30	0
381	28	5	2027-02-04 14:47:47.862572+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.863158+05:30	2026-09-04 14:47:47.863158+05:30	0
382	28	6	2027-03-04 14:47:47.862572+05:30	1666.65	Pending	0.00	2026-09-04 14:47:47.863158+05:30	2026-09-04 14:47:47.863158+05:30	0
383	29	1	2026-10-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
384	29	2	2026-11-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
385	29	3	2026-12-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
386	29	4	2027-01-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
387	29	5	2027-02-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
388	29	6	2027-03-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
389	29	7	2027-04-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
390	29	8	2027-05-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
391	29	9	2027-06-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
392	29	10	2027-07-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
393	29	11	2027-08-04 14:47:47.864307+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
394	29	12	2027-09-04 14:47:47.864307+05:30	2083.37	Pending	0.00	2026-09-04 14:47:47.864963+05:30	2026-09-04 14:47:47.864963+05:30	0
395	30	1	2026-09-11 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
396	30	2	2026-09-18 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
397	30	3	2026-09-25 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
398	30	4	2026-10-02 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
399	30	5	2026-10-09 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
400	30	6	2026-10-16 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
401	30	7	2026-10-23 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
402	30	8	2026-10-30 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
403	30	9	2026-11-06 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
404	30	10	2026-11-13 14:47:47.866088+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	0
405	31	1	2026-10-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
406	31	2	2026-11-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
407	31	3	2026-12-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
408	31	4	2027-01-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
409	31	5	2027-02-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
410	31	6	2027-03-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
411	31	7	2027-04-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
412	31	8	2027-05-04 14:47:47.867385+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
413	31	9	2027-06-04 14:47:47.867385+05:30	1666.64	Pending	0.00	2026-09-04 14:47:47.867915+05:30	2026-09-04 14:47:47.867915+05:30	0
414	32	1	2026-09-05 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
415	32	2	2026-09-06 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
416	32	3	2026-09-07 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
417	32	4	2026-09-08 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
418	32	5	2026-09-09 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
419	32	6	2026-09-10 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
420	32	7	2026-09-11 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
421	32	8	2026-09-12 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
422	32	9	2026-09-13 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
423	32	10	2026-09-14 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
424	32	11	2026-09-15 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
425	32	12	2026-09-16 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
426	32	13	2026-09-17 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
427	32	14	2026-09-18 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
428	32	15	2026-09-19 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
429	32	16	2026-09-20 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
430	32	17	2026-09-21 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
431	32	18	2026-09-22 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
432	32	19	2026-09-23 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
433	32	20	2026-09-24 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
434	32	21	2026-09-25 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
435	32	22	2026-09-26 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
436	32	23	2026-09-27 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
437	32	24	2026-09-28 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
438	32	25	2026-09-29 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
439	32	26	2026-09-30 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
440	32	27	2026-10-01 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
441	32	28	2026-10-02 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
442	32	29	2026-10-03 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
443	32	30	2026-10-04 14:47:47.870534+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.871052+05:30	2026-09-04 14:47:47.871052+05:30	0
444	33	1	2026-10-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
445	33	2	2026-11-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
446	33	3	2026-12-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
447	33	4	2027-01-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
448	33	5	2027-02-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
449	33	6	2027-03-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
450	33	7	2027-04-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
451	33	8	2027-05-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
452	33	9	2027-06-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
453	33	10	2027-07-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
454	33	11	2027-08-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
455	33	12	2027-09-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
456	33	13	2027-10-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
457	33	14	2027-11-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
458	33	15	2027-12-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
459	33	16	2028-01-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
460	33	17	2028-02-04 14:47:47.872557+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
461	33	18	2028-03-04 14:47:47.872557+05:30	2777.74	Pending	0.00	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	0
462	34	1	2026-09-11 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
463	34	2	2026-09-18 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
464	34	3	2026-09-25 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
465	34	4	2026-10-02 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
466	34	5	2026-10-09 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
467	34	6	2026-10-16 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
468	34	7	2026-10-23 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
469	34	8	2026-10-30 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
470	34	9	2026-11-06 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
471	34	10	2026-11-13 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
472	34	11	2026-11-20 14:47:47.874529+05:30	666.67	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
473	34	12	2026-11-27 14:47:47.874529+05:30	666.63	Pending	0.00	2026-09-04 14:47:47.87516+05:30	2026-09-04 14:47:47.87516+05:30	0
474	35	1	2026-10-04 14:47:47.876211+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.876716+05:30	2026-09-04 14:47:47.876716+05:30	0
475	35	2	2026-11-04 14:47:47.876211+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.876716+05:30	2026-09-04 14:47:47.876716+05:30	0
476	35	3	2026-12-04 14:47:47.876211+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.876716+05:30	2026-09-04 14:47:47.876716+05:30	0
477	35	4	2027-01-04 14:47:47.876211+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.876716+05:30	2026-09-04 14:47:47.876716+05:30	0
478	35	5	2027-02-04 14:47:47.876211+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.876716+05:30	2026-09-04 14:47:47.876716+05:30	0
479	35	6	2027-03-04 14:47:47.876211+05:30	1666.65	Pending	0.00	2026-09-04 14:47:47.876716+05:30	2026-09-04 14:47:47.876716+05:30	0
480	36	1	2026-10-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
481	36	2	2026-11-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
482	36	3	2026-12-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
483	36	4	2027-01-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
484	36	5	2027-02-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
485	36	6	2027-03-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
486	36	7	2027-04-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
487	36	8	2027-05-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
488	36	9	2027-06-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
489	36	10	2027-07-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
490	36	11	2027-08-04 14:47:47.877951+05:30	2083.33	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
491	36	12	2027-09-04 14:47:47.877951+05:30	2083.37	Pending	0.00	2026-09-04 14:47:47.878726+05:30	2026-09-04 14:47:47.878726+05:30	0
492	37	1	2026-09-11 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
493	37	2	2026-09-18 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
494	37	3	2026-09-25 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
495	37	4	2026-10-02 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
496	37	5	2026-10-09 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
497	37	6	2026-10-16 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
498	37	7	2026-10-23 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
499	37	8	2026-10-30 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
500	37	9	2026-11-06 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
501	37	10	2026-11-13 14:47:47.879903+05:30	500.00	Pending	0.00	2026-09-04 14:47:47.880421+05:30	2026-09-04 14:47:47.880421+05:30	0
502	38	1	2026-10-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
503	38	2	2026-11-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
504	38	3	2026-12-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
505	38	4	2027-01-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
506	38	5	2027-02-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
507	38	6	2027-03-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
508	38	7	2027-04-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
509	38	8	2027-05-04 14:47:47.881661+05:30	1666.67	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
510	38	9	2027-06-04 14:47:47.881661+05:30	1666.64	Pending	0.00	2026-09-04 14:47:47.882189+05:30	2026-09-04 14:47:47.882189+05:30	0
511	39	1	2026-09-05 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
512	39	2	2026-09-06 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
513	39	3	2026-09-07 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
514	39	4	2026-09-08 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
515	39	5	2026-09-09 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
516	39	6	2026-09-10 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
517	39	7	2026-09-11 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
518	39	8	2026-09-12 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
519	39	9	2026-09-13 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
520	39	10	2026-09-14 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
521	39	11	2026-09-15 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
522	39	12	2026-09-16 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
523	39	13	2026-09-17 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
524	39	14	2026-09-18 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
525	39	15	2026-09-19 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
526	39	16	2026-09-20 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
527	39	17	2026-09-21 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
528	39	18	2026-09-22 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
529	39	19	2026-09-23 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
530	39	20	2026-09-24 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
531	39	21	2026-09-25 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
532	39	22	2026-09-26 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
533	39	23	2026-09-27 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
534	39	24	2026-09-28 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
535	39	25	2026-09-29 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
536	39	26	2026-09-30 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
537	39	27	2026-10-01 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
538	39	28	2026-10-02 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
539	39	29	2026-10-03 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
540	39	30	2026-10-04 14:47:47.883449+05:30	100.00	Pending	0.00	2026-09-04 14:47:47.883974+05:30	2026-09-04 14:47:47.883974+05:30	0
541	40	1	2026-10-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
542	40	2	2026-11-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
543	40	3	2026-12-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
544	40	4	2027-01-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
545	40	5	2027-02-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
546	40	6	2027-03-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
547	40	7	2027-04-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
548	40	8	2027-05-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
549	40	9	2027-06-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
550	40	10	2027-07-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
551	40	11	2027-08-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
552	40	12	2027-09-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
553	40	13	2027-10-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
554	40	14	2027-11-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
555	40	15	2027-12-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
556	40	16	2028-01-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
557	40	17	2028-02-04 14:47:47.885568+05:30	2777.78	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
558	40	18	2028-03-04 14:47:47.885568+05:30	2777.74	Pending	0.00	2026-09-04 14:47:47.8861+05:30	2026-09-04 14:47:47.8861+05:30	0
\.


--
-- Data for Name: personal_loan_payments; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.personal_loan_payments (id, personal_loan_id, amount, paid_on, received_by_employee_id, method, reference, description, running_balance, installment_id, created_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: personal_loans; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.personal_loans (id, loan_number, branch_id, customer_id, created_by_employee_id, principal_amount, interest_type, interest_value, interest_amount, disbursed_amount, frequency, tenure_count, installment_amount, outstanding_amount, total_paid, status, opened_date, disbursed_at, closed_at, renewed_from_loan_id, renewed_to_loan_id, created_at, updated_at, deleted_at, tenant_id) FROM stdin;
1	PL-00001	1	3	5	10000.00	Flat	500.00	500.00	9500.00	Monthly	6	1666.67	10000.00	0.00	Active	2026-09-04 14:46:08.554256+05:30	2026-09-04 14:46:08.554256+05:30	\N	\N	\N	2026-09-04 14:46:08.75432+05:30	2026-09-04 14:46:08.75432+05:30	\N	0
2	PL-00002	1	4	5	25000.00	Percentage	12.00	3000.00	22000.00	Monthly	12	2083.33	25000.00	0.00	Active	2026-09-04 14:46:08.778255+05:30	2026-09-04 14:46:08.778255+05:30	\N	\N	\N	2026-09-04 14:46:08.77836+05:30	2026-09-04 14:46:08.77836+05:30	\N	0
3	PL-00003	1	5	5	5000.00	Flat	250.00	250.00	4750.00	Weekly	10	500.00	5000.00	0.00	Active	2026-09-04 14:46:08.780781+05:30	2026-09-04 14:46:08.780781+05:30	\N	\N	\N	2026-09-04 14:46:08.780781+05:30	2026-09-04 14:46:08.780781+05:30	\N	0
4	PL-00004	1	6	5	15000.00	Percentage	10.00	1500.00	13500.00	Monthly	9	1666.67	15000.00	0.00	Active	2026-09-04 14:46:08.782449+05:30	2026-09-04 14:46:08.782449+05:30	\N	\N	\N	2026-09-04 14:46:08.782449+05:30	2026-09-04 14:46:08.782449+05:30	\N	0
5	PL-00005	1	7	5	3000.00	Flat	150.00	150.00	2850.00	Daily	30	100.00	3000.00	0.00	Active	2026-09-04 14:46:08.78421+05:30	2026-09-04 14:46:08.78421+05:30	\N	\N	\N	2026-09-04 14:46:08.78421+05:30	2026-09-04 14:46:08.78421+05:30	\N	0
6	PL-00006	1	8	5	50000.00	Percentage	15.00	7500.00	42500.00	Monthly	18	2777.78	50000.00	0.00	Active	2026-09-04 14:46:08.787157+05:30	2026-09-04 14:46:08.787157+05:30	\N	\N	\N	2026-09-04 14:46:08.787157+05:30	2026-09-04 14:46:08.787157+05:30	\N	0
7	PL-00007	1	9	5	8000.00	Flat	400.00	400.00	7600.00	Weekly	12	666.67	8000.00	0.00	Active	2026-09-04 14:46:08.789996+05:30	2026-09-04 14:46:08.789996+05:30	\N	\N	\N	2026-09-04 14:46:08.79004+05:30	2026-09-04 14:46:08.79004+05:30	\N	0
8	PL-00008	1	10	5	10000.00	Flat	500.00	500.00	9500.00	Monthly	6	1666.67	10000.00	0.00	Active	2026-09-04 14:46:08.791232+05:30	2026-09-04 14:46:08.791232+05:30	\N	\N	\N	2026-09-04 14:46:08.791814+05:30	2026-09-04 14:46:08.791814+05:30	\N	0
9	PL-00009	1	11	5	25000.00	Percentage	12.00	3000.00	22000.00	Monthly	12	2083.33	25000.00	0.00	Active	2026-09-04 14:46:08.79241+05:30	2026-09-04 14:46:08.79241+05:30	\N	\N	\N	2026-09-04 14:46:08.79293+05:30	2026-09-04 14:46:08.79293+05:30	\N	0
10	PL-00010	1	3	5	5000.00	Flat	250.00	250.00	4750.00	Weekly	10	500.00	5000.00	0.00	Active	2026-09-04 14:46:08.793642+05:30	2026-09-04 14:46:08.793642+05:30	\N	\N	\N	2026-09-04 14:46:08.79418+05:30	2026-09-04 14:46:08.79418+05:30	\N	0
11	PL-00011	1	4	5	15000.00	Percentage	10.00	1500.00	13500.00	Monthly	9	1666.67	15000.00	0.00	Active	2026-09-04 14:46:08.794692+05:30	2026-09-04 14:46:08.794692+05:30	\N	\N	\N	2026-09-04 14:46:08.794692+05:30	2026-09-04 14:46:08.794692+05:30	\N	0
12	PL-00012	1	5	5	3000.00	Flat	150.00	150.00	2850.00	Daily	30	100.00	3000.00	0.00	Active	2026-09-04 14:46:08.795849+05:30	2026-09-04 14:46:08.795849+05:30	\N	\N	\N	2026-09-04 14:46:08.795849+05:30	2026-09-04 14:46:08.795849+05:30	\N	0
13	PL-00013	1	6	5	50000.00	Percentage	15.00	7500.00	42500.00	Monthly	18	2777.78	50000.00	0.00	Active	2026-09-04 14:46:08.797199+05:30	2026-09-04 14:46:08.797199+05:30	\N	\N	\N	2026-09-04 14:46:08.797754+05:30	2026-09-04 14:46:08.797754+05:30	\N	0
14	PL-00014	1	7	5	8000.00	Flat	400.00	400.00	7600.00	Weekly	12	666.67	8000.00	0.00	Active	2026-09-04 14:46:08.798423+05:30	2026-09-04 14:46:08.798423+05:30	\N	\N	\N	2026-09-04 14:46:08.798932+05:30	2026-09-04 14:46:08.798932+05:30	\N	0
15	PL-00015	1	8	5	10000.00	Flat	500.00	500.00	9500.00	Monthly	6	1666.67	10000.00	0.00	Active	2026-09-04 14:46:08.799531+05:30	2026-09-04 14:46:08.799531+05:30	\N	\N	\N	2026-09-04 14:46:08.800065+05:30	2026-09-04 14:46:08.800065+05:30	\N	0
16	PL-00016	1	9	5	25000.00	Percentage	12.00	3000.00	22000.00	Monthly	12	2083.33	25000.00	0.00	Active	2026-09-04 14:46:08.800616+05:30	2026-09-04 14:46:08.800616+05:30	\N	\N	\N	2026-09-04 14:46:08.800616+05:30	2026-09-04 14:46:08.800616+05:30	\N	0
17	PL-00017	1	10	5	5000.00	Flat	250.00	250.00	4750.00	Weekly	10	500.00	5000.00	0.00	Active	2026-09-04 14:46:08.801663+05:30	2026-09-04 14:46:08.801663+05:30	\N	\N	\N	2026-09-04 14:46:08.801663+05:30	2026-09-04 14:46:08.801663+05:30	\N	0
18	PL-00018	1	11	5	15000.00	Percentage	10.00	1500.00	13500.00	Monthly	9	1666.67	15000.00	0.00	Active	2026-09-04 14:46:08.802766+05:30	2026-09-04 14:46:08.802766+05:30	\N	\N	\N	2026-09-04 14:46:08.802766+05:30	2026-09-04 14:46:08.802766+05:30	\N	0
19	PL-00019	1	3	5	3000.00	Flat	150.00	150.00	2850.00	Daily	30	100.00	3000.00	0.00	Active	2026-09-04 14:46:08.803788+05:30	2026-09-04 14:46:08.803788+05:30	\N	\N	\N	2026-09-04 14:46:08.803788+05:30	2026-09-04 14:46:08.803788+05:30	\N	0
20	PL-00020	1	4	5	50000.00	Percentage	15.00	7500.00	42500.00	Monthly	18	2777.78	50000.00	0.00	Active	2026-09-04 14:46:08.805418+05:30	2026-09-04 14:46:08.805418+05:30	\N	\N	\N	2026-09-04 14:46:08.805418+05:30	2026-09-04 14:46:08.805418+05:30	\N	0
21	PL-00021	1	3	5	10000.00	Flat	500.00	500.00	9500.00	Monthly	6	1666.67	10000.00	0.00	Active	2026-09-04 14:47:47.787608+05:30	2026-09-04 14:47:47.787608+05:30	\N	\N	\N	2026-09-04 14:47:47.835007+05:30	2026-09-04 14:47:47.835007+05:30	\N	0
22	PL-00022	1	4	5	25000.00	Percentage	12.00	3000.00	22000.00	Monthly	12	2083.33	25000.00	0.00	Active	2026-09-04 14:47:47.848703+05:30	2026-09-04 14:47:47.848703+05:30	\N	\N	\N	2026-09-04 14:47:47.848703+05:30	2026-09-04 14:47:47.848703+05:30	\N	0
23	PL-00023	1	5	5	5000.00	Flat	250.00	250.00	4750.00	Weekly	10	500.00	5000.00	0.00	Active	2026-09-04 14:47:47.850598+05:30	2026-09-04 14:47:47.850598+05:30	\N	\N	\N	2026-09-04 14:47:47.851117+05:30	2026-09-04 14:47:47.851117+05:30	\N	0
24	PL-00024	1	6	5	15000.00	Percentage	10.00	1500.00	13500.00	Monthly	9	1666.67	15000.00	0.00	Active	2026-09-04 14:47:47.852695+05:30	2026-09-04 14:47:47.852695+05:30	\N	\N	\N	2026-09-04 14:47:47.852695+05:30	2026-09-04 14:47:47.852695+05:30	\N	0
25	PL-00025	1	7	5	3000.00	Flat	150.00	150.00	2850.00	Daily	30	100.00	3000.00	0.00	Active	2026-09-04 14:47:47.854802+05:30	2026-09-04 14:47:47.854802+05:30	\N	\N	\N	2026-09-04 14:47:47.855348+05:30	2026-09-04 14:47:47.855348+05:30	\N	0
26	PL-00026	1	8	5	50000.00	Percentage	15.00	7500.00	42500.00	Monthly	18	2777.78	50000.00	0.00	Active	2026-09-04 14:47:47.857702+05:30	2026-09-04 14:47:47.857702+05:30	\N	\N	\N	2026-09-04 14:47:47.858243+05:30	2026-09-04 14:47:47.858243+05:30	\N	0
27	PL-00027	1	9	5	8000.00	Flat	400.00	400.00	7600.00	Weekly	12	666.67	8000.00	0.00	Active	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	\N	\N	\N	2026-09-04 14:47:47.861443+05:30	2026-09-04 14:47:47.861443+05:30	\N	0
28	PL-00028	1	10	5	10000.00	Flat	500.00	500.00	9500.00	Monthly	6	1666.67	10000.00	0.00	Active	2026-09-04 14:47:47.862572+05:30	2026-09-04 14:47:47.862572+05:30	\N	\N	\N	2026-09-04 14:47:47.863158+05:30	2026-09-04 14:47:47.863158+05:30	\N	0
29	PL-00029	1	11	5	25000.00	Percentage	12.00	3000.00	22000.00	Monthly	12	2083.33	25000.00	0.00	Active	2026-09-04 14:47:47.864307+05:30	2026-09-04 14:47:47.864307+05:30	\N	\N	\N	2026-09-04 14:47:47.864307+05:30	2026-09-04 14:47:47.864307+05:30	\N	0
30	PL-00030	1	3	5	5000.00	Flat	250.00	250.00	4750.00	Weekly	10	500.00	5000.00	0.00	Active	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	\N	\N	\N	2026-09-04 14:47:47.866088+05:30	2026-09-04 14:47:47.866088+05:30	\N	0
31	PL-00031	1	4	5	15000.00	Percentage	10.00	1500.00	13500.00	Monthly	9	1666.67	15000.00	0.00	Active	2026-09-04 14:47:47.867385+05:30	2026-09-04 14:47:47.867385+05:30	\N	\N	\N	2026-09-04 14:47:47.867385+05:30	2026-09-04 14:47:47.867385+05:30	\N	0
32	PL-00032	1	5	5	3000.00	Flat	150.00	150.00	2850.00	Daily	30	100.00	3000.00	0.00	Active	2026-09-04 14:47:47.870534+05:30	2026-09-04 14:47:47.870534+05:30	\N	\N	\N	2026-09-04 14:47:47.870534+05:30	2026-09-04 14:47:47.870534+05:30	\N	0
33	PL-00033	1	6	5	50000.00	Percentage	15.00	7500.00	42500.00	Monthly	18	2777.78	50000.00	0.00	Active	2026-09-04 14:47:47.872557+05:30	2026-09-04 14:47:47.872557+05:30	\N	\N	\N	2026-09-04 14:47:47.87321+05:30	2026-09-04 14:47:47.87321+05:30	\N	0
34	PL-00034	1	7	5	8000.00	Flat	400.00	400.00	7600.00	Weekly	12	666.67	8000.00	0.00	Active	2026-09-04 14:47:47.874529+05:30	2026-09-04 14:47:47.874529+05:30	\N	\N	\N	2026-09-04 14:47:47.874529+05:30	2026-09-04 14:47:47.874529+05:30	\N	0
35	PL-00035	1	8	5	10000.00	Flat	500.00	500.00	9500.00	Monthly	6	1666.67	10000.00	0.00	Active	2026-09-04 14:47:47.876211+05:30	2026-09-04 14:47:47.876211+05:30	\N	\N	\N	2026-09-04 14:47:47.876211+05:30	2026-09-04 14:47:47.876211+05:30	\N	0
36	PL-00036	1	9	5	25000.00	Percentage	12.00	3000.00	22000.00	Monthly	12	2083.33	25000.00	0.00	Active	2026-09-04 14:47:47.877951+05:30	2026-09-04 14:47:47.877951+05:30	\N	\N	\N	2026-09-04 14:47:47.877985+05:30	2026-09-04 14:47:47.877985+05:30	\N	0
37	PL-00037	1	10	5	5000.00	Flat	250.00	250.00	4750.00	Weekly	10	500.00	5000.00	0.00	Active	2026-09-04 14:47:47.879903+05:30	2026-09-04 14:47:47.879903+05:30	\N	\N	\N	2026-09-04 14:47:47.879903+05:30	2026-09-04 14:47:47.879903+05:30	\N	0
38	PL-00038	1	11	5	15000.00	Percentage	10.00	1500.00	13500.00	Monthly	9	1666.67	15000.00	0.00	Active	2026-09-04 14:47:47.881661+05:30	2026-09-04 14:47:47.881661+05:30	\N	\N	\N	2026-09-04 14:47:47.881661+05:30	2026-09-04 14:47:47.881661+05:30	\N	0
39	PL-00039	1	3	5	3000.00	Flat	150.00	150.00	2850.00	Daily	30	100.00	3000.00	0.00	Active	2026-09-04 14:47:47.883449+05:30	2026-09-04 14:47:47.883449+05:30	\N	\N	\N	2026-09-04 14:47:47.883449+05:30	2026-09-04 14:47:47.883449+05:30	\N	0
40	PL-00040	1	4	5	50000.00	Percentage	15.00	7500.00	42500.00	Monthly	18	2777.78	50000.00	0.00	Active	2026-09-04 14:47:47.885568+05:30	2026-09-04 14:47:47.885568+05:30	\N	\N	\N	2026-09-04 14:47:47.885568+05:30	2026-09-04 14:47:47.885568+05:30	\N	0
\.


--
-- Data for Name: purity_standards; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.purity_standards (id, karat, fineness_percent, label, is_active, created_at, updated_at, tenant_id) FROM stdin;
1	24	100	24K (100.0%)	t	2026-08-12 16:58:33.290421+05:30	2026-08-12 16:58:33.290421+05:30	1
2	23	95.8	23K (95.8%)	t	2026-08-12 16:58:33.291933+05:30	2026-08-12 16:58:33.291933+05:30	1
3	22	91.7	22K (91.7%)	t	2026-08-12 16:58:33.292459+05:30	2026-08-12 16:58:33.292459+05:30	1
4	21	87.5	21K (87.5%)	t	2026-08-12 16:58:33.293038+05:30	2026-08-12 16:58:33.293038+05:30	1
5	20	83.3	20K (83.3%)	t	2026-08-12 16:58:33.294076+05:30	2026-08-12 16:58:33.294076+05:30	1
6	19	79.2	19K (79.2%)	t	2026-08-12 16:58:33.294591+05:30	2026-08-12 16:58:33.294591+05:30	1
7	18	75	18K (75.0%)	t	2026-08-12 16:58:33.295105+05:30	2026-08-12 16:58:33.295105+05:30	1
8	17	70.8	17K (70.8%)	t	2026-08-12 16:58:33.29562+05:30	2026-08-12 16:58:33.29562+05:30	1
9	16	66.7	16K (66.7%)	t	2026-08-12 16:58:33.296683+05:30	2026-08-12 16:58:33.296683+05:30	1
10	15	62.5	15K (62.5%)	t	2026-08-12 16:58:33.297207+05:30	2026-08-12 16:58:33.297207+05:30	1
11	14	58.3	14K (58.3%)	t	2026-08-12 16:58:33.297745+05:30	2026-08-12 16:58:33.297745+05:30	1
12	13	54.2	13K (54.2%)	t	2026-08-12 16:58:33.298286+05:30	2026-08-12 16:58:33.298286+05:30	1
13	12	50	12K (50.0%)	t	2026-08-12 16:58:33.299316+05:30	2026-08-12 16:58:33.299316+05:30	1
14	11	45.8	11K (45.8%)	t	2026-08-12 16:58:33.299841+05:30	2026-08-12 16:58:33.299841+05:30	1
15	10	41.7	10K (41.7%)	t	2026-08-12 16:58:33.302396+05:30	2026-08-12 16:58:33.302396+05:30	1
\.


--
-- Data for Name: reminders; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.reminders (id, customer_id, loan_id, type, due_date, note, status, created_by_employee_id, created_at, updated_at, deleted_at, tenant_id) FROM stdin;
1	3	\N	Follow-Up	2026-08-18 05:30:00+05:30	Loan needs a reminder	Pending	6	2026-08-18 10:14:02.194454+05:30	2026-08-18 10:14:02.194454+05:30	\N	1
\.


--
-- Data for Name: request_approvals; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.request_approvals (id, request_id, stage, action, actor_employee_id, remarks, created_at, tenant_id) FROM stdin;
1	3	LoanOfficer	Approved	6		2026-08-18 19:50:20.158161+05:30	1
2	3	BranchManager	Approved	6		2026-08-18 19:50:20.980132+05:30	1
3	3	Management	Approved	6		2026-08-18 19:50:21.710724+05:30	1
4	4	LoanOfficer	Approved	6		2026-08-18 19:52:46.710717+05:30	1
5	4	BranchManager	Approved	6		2026-08-18 19:52:46.970296+05:30	1
6	4	Management	Approved	6		2026-08-18 19:52:47.167632+05:30	1
7	5	Manager	Approved	6		2026-08-28 10:11:15.183631+05:30	1
8	5	Management	Approved	6		2026-08-28 10:11:29.776283+05:30	1
9	6	Manager	Approved	6		2026-08-28 17:33:47.464233+05:30	1
10	6	Management	Approved	6		2026-08-28 17:34:03.121883+05:30	1
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.role_permissions (id, role_id, permission_id, permission, tenant_id) FROM stdin;
1	1	1	t	1
110	4	5	t	1
3	1	3	t	1
5	1	5	t	1
7	1	7	t	1
9	1	9	t	1
11	1	11	t	1
13	1	13	t	1
15	1	15	t	1
17	1	17	t	1
19	1	19	t	1
21	1	21	t	1
23	1	23	t	1
25	1	25	t	1
27	1	27	t	1
29	1	29	t	1
31	1	31	t	1
33	1	33	t	1
34	1	34	t	1
36	2	1	t	1
38	2	3	t	1
40	2	5	t	1
42	2	7	t	1
44	2	9	t	1
46	2	11	t	1
48	2	13	t	1
50	2	15	t	1
52	2	17	t	1
54	2	19	t	1
784	1	88	t	1
56	2	21	t	1
785	1	89	t	1
58	2	23	t	1
786	2	88	t	1
60	2	25	t	1
787	2	89	f	1
788	3	88	f	1
62	2	27	t	1
789	3	89	f	1
64	2	29	t	1
790	4	88	f	1
66	2	31	t	1
791	4	89	f	1
68	2	33	t	1
792	5	88	f	1
69	2	34	t	1
793	5	89	f	1
71	3	1	t	1
794	6	88	f	1
73	3	3	t	1
795	6	89	f	1
75	3	5	t	1
796	7	88	f	1
77	3	7	t	1
797	7	89	f	1
79	3	9	t	1
798	8	88	f	1
81	3	11	t	1
799	8	89	f	1
83	3	13	t	1
800	9	88	t	1
85	3	15	t	1
801	9	89	f	1
87	3	17	t	1
89	3	19	t	1
91	3	21	t	1
93	3	23	t	1
95	3	25	t	1
97	3	27	t	1
99	3	29	t	1
101	3	31	t	1
103	3	33	t	1
104	3	34	t	1
106	4	1	t	1
108	4	3	t	1
112	4	7	t	1
120	4	15	t	1
122	4	17	t	1
803	1	90	t	1
124	4	19	t	1
126	4	21	t	1
128	4	23	t	1
130	4	25	t	1
132	4	27	t	1
134	4	29	t	1
141	5	1	t	1
143	5	3	t	1
145	5	5	t	1
147	5	7	t	1
149	5	9	t	1
151	5	11	t	1
153	5	13	t	1
155	5	15	t	1
157	5	17	t	1
159	5	19	t	1
161	5	21	t	1
163	5	23	t	1
165	5	25	t	1
167	5	27	t	1
169	5	29	t	1
171	5	31	t	1
174	5	34	t	1
211	7	1	t	1
213	7	3	t	1
215	7	5	t	1
217	7	7	t	1
219	7	9	t	1
221	7	11	t	1
223	7	13	t	1
225	7	15	t	1
227	7	17	t	1
229	7	19	t	1
231	7	21	t	1
233	7	23	t	1
235	7	25	t	1
237	7	27	t	1
239	7	29	t	1
241	7	31	t	1
244	7	34	t	1
246	8	1	t	1
248	8	3	t	1
250	8	5	t	1
252	8	7	t	1
254	8	9	t	1
256	8	11	t	1
258	8	13	t	1
260	8	15	t	1
262	8	17	t	1
264	8	19	t	1
266	8	21	t	1
268	8	23	t	1
270	8	25	t	1
272	8	27	t	1
138	4	33	f	1
173	5	33	f	1
139	4	34	f	1
243	7	33	f	1
176	6	1	f	1
322	2	38	t	1
324	3	36	t	1
326	3	38	t	1
332	5	36	t	1
334	5	38	t	1
336	6	36	t	1
338	6	38	t	1
340	7	36	t	1
342	7	38	t	1
344	8	36	t	1
346	8	38	t	1
348	9	36	t	1
350	9	38	t	1
844	3	91	t	1
274	8	29	t	1
276	8	31	t	1
279	8	34	t	1
281	9	1	t	1
283	9	3	t	1
285	9	5	t	1
287	9	7	t	1
289	9	9	t	1
291	9	11	t	1
293	9	13	t	1
295	9	15	t	1
297	9	17	t	1
299	9	19	t	1
301	9	21	t	1
303	9	23	t	1
305	9	25	t	1
307	9	27	t	1
309	9	29	t	1
311	9	31	t	1
313	9	33	t	1
314	9	34	t	1
353	2	40	f	1
278	8	33	f	1
178	6	3	f	1
182	6	7	f	1
184	6	9	f	1
186	6	11	f	1
188	6	13	f	1
192	6	17	f	1
194	6	19	f	1
196	6	21	f	1
198	6	23	f	1
202	6	27	f	1
206	6	31	f	1
209	6	34	f	1
208	6	33	f	1
190	6	15	t	1
354	3	40	f	1
200	6	25	f	1
352	1	40	t	1
180	6	5	t	1
204	6	29	t	1
355	4	40	f	1
316	1	36	t	1
318	1	38	t	1
320	2	36	t	1
892	5	99	f	1
361	1	41	t	1
370	1	42	t	1
317	1	37	t	1
321	2	37	t	1
325	3	37	t	1
804	1	91	t	1
805	1	92	t	1
806	1	93	t	1
807	1	94	t	1
808	1	95	t	1
809	1	96	t	1
333	5	37	t	1
810	1	97	t	1
811	1	98	t	1
812	1	99	t	1
813	1	100	t	1
814	1	101	t	1
815	1	102	t	1
816	1	103	t	1
817	1	104	t	1
818	1	105	t	1
819	1	106	t	1
820	1	107	t	1
821	1	108	t	1
822	1	109	t	1
823	2	90	t	1
824	2	91	t	1
825	2	92	t	1
826	2	93	t	1
828	2	95	f	1
829	2	96	t	1
831	2	98	f	1
832	2	99	t	1
833	2	100	f	1
834	2	101	f	1
835	2	102	t	1
836	2	103	t	1
837	2	104	t	1
838	2	105	t	1
839	2	106	t	1
840	2	107	t	1
841	2	108	t	1
842	2	109	t	1
843	3	90	t	1
845	3	92	t	1
846	3	93	t	1
848	3	95	t	1
356	5	40	f	1
849	3	96	f	1
850	3	97	f	1
851	3	98	t	1
852	3	99	f	1
853	3	100	t	1
854	3	101	t	1
855	3	102	f	1
856	3	103	t	1
357	6	40	f	1
857	3	104	t	1
858	3	105	t	1
859	3	106	t	1
860	3	107	t	1
861	3	108	t	1
862	3	109	t	1
863	4	90	t	1
864	4	91	t	1
358	7	40	f	1
865	4	92	t	1
866	4	93	t	1
867	4	94	t	1
868	4	95	f	1
869	4	96	f	1
870	4	97	t	1
871	4	98	f	1
872	4	99	f	1
359	8	40	f	1
873	4	100	t	1
874	4	101	f	1
875	4	102	f	1
966	9	93	t	1
967	9	94	f	1
968	9	95	f	1
969	9	96	f	1
970	9	97	f	1
971	9	98	f	1
972	9	99	f	1
973	9	100	f	1
974	9	101	f	1
975	9	102	f	1
976	9	103	f	1
977	9	104	f	1
978	9	105	f	1
979	9	106	f	1
980	9	107	f	1
876	4	103	f	1
877	4	104	f	1
878	4	105	f	1
879	4	106	f	1
881	4	108	f	1
882	4	109	f	1
883	5	90	t	1
360	9	40	f	1
884	5	91	t	1
885	5	92	t	1
886	5	93	t	1
887	5	94	f	1
889	5	96	f	1
890	5	97	f	1
891	5	98	f	1
893	5	100	f	1
362	2	41	f	1
894	5	101	f	1
895	5	102	f	1
896	5	103	f	1
897	5	104	f	1
898	5	105	f	1
899	5	106	f	1
900	5	107	f	1
901	5	108	f	1
363	3	41	f	1
902	5	109	f	1
903	6	90	t	1
904	6	91	t	1
905	6	92	t	1
906	6	93	t	1
909	6	96	f	1
910	6	97	f	1
911	6	98	f	1
912	6	99	f	1
914	6	101	f	1
915	6	102	f	1
916	6	103	f	1
917	6	104	f	1
918	6	105	f	1
919	6	106	f	1
920	6	107	f	1
921	6	108	f	1
922	6	109	f	1
923	7	90	t	1
924	7	91	t	1
925	7	92	t	1
926	7	93	t	1
927	7	94	f	1
928	7	95	f	1
929	7	96	f	1
930	7	97	f	1
931	7	98	f	1
932	7	99	f	1
933	7	100	f	1
934	7	101	f	1
935	7	102	f	1
936	7	103	f	1
937	7	104	f	1
938	7	105	f	1
939	7	106	f	1
940	7	107	f	1
941	7	108	f	1
942	7	109	f	1
943	8	90	t	1
944	8	91	t	1
945	8	92	t	1
946	8	93	t	1
947	8	94	f	1
948	8	95	f	1
949	8	96	f	1
950	8	97	f	1
951	8	98	f	1
952	8	99	f	1
953	8	100	f	1
954	8	101	f	1
955	8	102	f	1
956	8	103	t	1
958	8	105	t	1
959	8	106	t	1
960	8	107	t	1
961	8	108	t	1
962	8	109	t	1
963	9	90	t	1
964	9	91	t	1
965	9	92	t	1
981	9	108	f	1
982	9	109	f	1
827	2	94	f	1
847	3	94	f	1
907	6	94	f	1
888	5	95	f	1
908	6	95	f	1
830	2	97	f	1
913	6	100	f	1
957	8	104	f	1
880	4	107	f	1
364	4	41	f	1
365	5	41	f	1
366	6	41	f	1
367	7	41	f	1
368	8	41	f	1
369	9	41	f	1
371	2	42	f	1
372	3	42	f	1
373	4	42	f	1
379	1	43	t	1
380	2	43	t	1
381	3	43	t	1
383	5	43	t	1
384	6	43	t	1
385	7	43	t	1
386	8	43	t	1
387	9	43	t	1
388	1	44	t	1
389	2	44	t	1
390	3	44	t	1
392	5	44	t	1
393	6	44	t	1
394	7	44	t	1
395	8	44	t	1
396	9	44	t	1
397	1	45	t	1
398	2	45	t	1
399	3	45	t	1
401	5	45	t	1
402	6	45	t	1
403	7	45	t	1
404	8	45	t	1
405	9	45	t	1
406	1	46	t	1
407	2	46	t	1
408	3	46	t	1
410	5	46	t	1
411	6	46	t	1
412	7	46	t	1
413	8	46	t	1
414	9	46	t	1
415	1	47	t	1
416	2	47	t	1
417	3	47	t	1
419	5	47	t	1
420	6	47	t	1
421	7	47	t	1
422	8	47	t	1
423	9	47	t	1
424	1	48	t	1
425	2	48	t	1
426	3	48	t	1
428	5	48	t	1
429	6	48	t	1
430	7	48	t	1
431	8	48	t	1
432	9	48	t	1
433	1	49	t	1
434	2	49	t	1
435	3	49	t	1
436	4	49	t	1
437	5	49	t	1
438	6	49	t	1
439	7	49	t	1
440	8	49	t	1
441	9	49	t	1
442	1	50	t	1
443	2	50	t	1
444	3	50	t	1
445	4	50	t	1
446	5	50	t	1
447	6	50	t	1
448	7	50	t	1
449	8	50	t	1
450	9	50	t	1
451	1	51	t	1
452	2	51	t	1
453	3	51	t	1
454	4	51	t	1
455	5	51	t	1
456	6	51	t	1
457	7	51	t	1
458	8	51	t	1
459	9	51	t	1
460	1	52	t	1
461	2	52	t	1
462	3	52	t	1
464	5	52	t	1
465	6	52	t	1
466	7	52	t	1
467	8	52	t	1
468	9	52	t	1
469	1	53	t	1
470	2	53	t	1
471	3	53	t	1
473	5	53	t	1
474	6	53	t	1
475	7	53	t	1
476	8	53	t	1
477	9	53	t	1
478	1	54	t	1
479	2	54	t	1
480	3	54	t	1
482	5	54	t	1
483	6	54	t	1
484	7	54	t	1
485	8	54	t	1
486	9	54	t	1
487	1	55	t	1
488	2	55	t	1
489	3	55	t	1
491	5	55	t	1
492	6	55	t	1
493	7	55	t	1
494	8	55	t	1
495	9	55	t	1
496	1	56	t	1
497	2	56	t	1
498	3	56	t	1
500	5	56	t	1
501	6	56	t	1
502	7	56	t	1
503	8	56	t	1
504	9	56	t	1
505	1	57	t	1
506	2	57	t	1
507	3	57	t	1
509	5	57	t	1
374	5	42	f	1
375	6	42	f	1
376	7	42	f	1
377	8	42	f	1
378	9	42	f	1
510	6	57	t	1
511	7	57	t	1
512	8	57	t	1
513	9	57	t	1
514	1	58	t	1
515	2	58	t	1
516	3	58	t	1
518	5	58	t	1
519	6	58	t	1
520	7	58	t	1
521	8	58	t	1
522	9	58	t	1
523	1	59	t	1
524	2	59	t	1
525	3	59	t	1
527	5	59	t	1
528	6	59	t	1
529	7	59	t	1
530	8	59	t	1
531	9	59	t	1
532	1	60	t	1
533	2	60	t	1
534	3	60	t	1
536	5	60	t	1
537	6	60	t	1
538	7	60	t	1
539	8	60	t	1
540	9	60	t	1
541	1	61	t	1
542	2	61	t	1
543	3	61	t	1
544	4	61	t	1
545	5	61	t	1
546	6	61	t	1
547	7	61	t	1
548	8	61	t	1
549	9	61	t	1
550	1	62	t	1
551	2	62	t	1
552	3	62	t	1
553	4	62	t	1
554	5	62	t	1
555	6	62	t	1
556	7	62	t	1
557	8	62	t	1
558	9	62	t	1
559	1	63	t	1
560	2	63	t	1
561	3	63	t	1
562	4	63	t	1
563	5	63	t	1
564	6	63	t	1
565	7	63	t	1
566	8	63	t	1
567	9	63	t	1
568	1	64	t	1
569	2	64	t	1
570	3	64	t	1
571	4	64	t	1
572	5	64	t	1
573	6	64	t	1
574	7	64	t	1
575	8	64	t	1
576	9	64	t	1
577	1	65	t	1
578	2	65	t	1
579	3	65	t	1
580	4	65	t	1
581	5	65	t	1
582	6	65	t	1
583	7	65	t	1
584	8	65	t	1
585	9	65	t	1
586	1	66	t	1
587	2	66	t	1
588	3	66	t	1
589	4	66	t	1
590	5	66	t	1
591	6	66	t	1
592	7	66	t	1
593	8	66	t	1
594	9	66	t	1
595	1	67	t	1
596	2	67	t	1
597	3	67	t	1
598	4	67	t	1
599	5	67	t	1
600	6	67	t	1
601	7	67	t	1
602	8	67	t	1
603	9	67	t	1
604	1	68	t	1
605	2	68	t	1
606	3	68	t	1
607	4	68	t	1
608	5	68	t	1
609	6	68	t	1
610	7	68	t	1
611	8	68	t	1
612	9	68	t	1
613	1	69	t	1
614	2	69	t	1
615	3	69	t	1
616	4	69	t	1
617	5	69	t	1
618	6	69	t	1
619	7	69	t	1
620	8	69	t	1
621	9	69	t	1
622	1	70	t	1
623	2	70	t	1
624	3	70	t	1
625	4	70	t	1
626	5	70	t	1
627	6	70	t	1
628	7	70	t	1
629	8	70	t	1
630	9	70	t	1
631	1	71	t	1
632	2	71	t	1
633	3	71	t	1
634	4	71	t	1
635	5	71	t	1
636	6	71	t	1
637	7	71	t	1
638	8	71	t	1
639	9	71	t	1
640	1	72	t	1
641	2	72	t	1
642	3	72	t	1
644	5	72	t	1
645	6	72	t	1
646	7	72	t	1
647	8	72	t	1
648	9	72	t	1
649	1	73	t	1
650	2	73	t	1
651	3	73	t	1
652	4	73	t	1
653	5	73	t	1
654	6	73	t	1
655	7	73	t	1
656	8	73	t	1
657	9	73	t	1
658	1	74	t	1
659	2	74	t	1
660	3	74	t	1
661	4	74	t	1
662	5	74	t	1
663	6	74	t	1
664	7	74	t	1
665	8	74	t	1
666	9	74	t	1
667	1	75	t	1
668	2	75	t	1
669	3	75	t	1
670	4	75	t	1
671	5	75	t	1
672	6	75	t	1
673	7	75	t	1
674	8	75	t	1
675	9	75	t	1
676	1	76	t	1
677	2	76	t	1
678	3	76	t	1
679	4	76	t	1
680	5	76	t	1
681	6	76	t	1
682	7	76	t	1
683	8	76	t	1
684	9	76	t	1
685	1	77	t	1
686	2	77	t	1
687	3	77	t	1
688	4	77	t	1
689	5	77	t	1
690	6	77	t	1
691	7	77	t	1
692	8	77	t	1
693	9	77	t	1
694	1	78	t	1
695	2	78	t	1
696	3	78	t	1
697	4	78	t	1
698	5	78	t	1
699	6	78	t	1
700	7	78	t	1
701	8	78	t	1
702	9	78	t	1
703	1	79	t	1
704	2	79	t	1
705	3	79	t	1
706	4	79	t	1
707	5	79	t	1
708	6	79	t	1
709	7	79	t	1
710	8	79	t	1
711	9	79	t	1
712	1	80	t	1
713	2	80	t	1
714	3	80	t	1
715	4	80	t	1
716	5	80	t	1
717	6	80	t	1
718	7	80	t	1
719	8	80	t	1
720	9	80	t	1
721	1	81	t	1
722	2	81	t	1
723	3	81	t	1
724	4	81	t	1
725	5	81	t	1
726	6	81	t	1
727	7	81	t	1
728	8	81	t	1
729	9	81	t	1
730	1	82	t	1
731	2	82	t	1
732	3	82	t	1
733	4	82	t	1
734	5	82	t	1
735	6	82	t	1
736	7	82	t	1
737	8	82	t	1
738	9	82	t	1
739	1	83	t	1
740	2	83	t	1
741	3	83	t	1
742	4	83	t	1
743	5	83	t	1
744	6	83	t	1
745	7	83	t	1
746	8	83	t	1
747	9	83	t	1
748	1	84	t	1
749	2	84	t	1
750	3	84	t	1
751	4	84	t	1
752	5	84	t	1
753	6	84	t	1
754	7	84	t	1
755	8	84	t	1
756	9	84	t	1
757	1	85	t	1
758	2	85	t	1
759	3	85	t	1
761	5	85	t	1
762	6	85	t	1
763	7	85	t	1
764	8	85	t	1
765	9	85	t	1
766	1	86	t	1
767	2	86	t	1
768	3	86	t	1
770	5	86	t	1
771	6	86	t	1
772	7	86	t	1
773	8	86	t	1
774	9	86	t	1
775	1	87	t	1
776	2	87	t	1
777	3	87	t	1
779	5	87	t	1
780	6	87	t	1
781	7	87	t	1
782	8	87	t	1
783	9	87	t	1
114	4	9	f	1
116	4	11	f	1
118	4	13	f	1
136	4	31	f	1
328	4	36	f	1
329	4	37	f	1
330	4	38	f	1
382	4	43	f	1
391	4	44	f	1
400	4	45	f	1
409	4	46	f	1
418	4	47	f	1
427	4	48	f	1
463	4	52	f	1
472	4	53	f	1
481	4	54	f	1
490	4	55	f	1
499	4	56	f	1
508	4	57	f	1
517	4	58	f	1
526	4	59	f	1
535	4	60	f	1
643	4	72	t	1
760	4	85	f	1
769	4	86	f	1
778	4	87	f	1
337	6	37	t	1
341	7	37	t	1
345	8	37	t	1
349	9	37	t	1
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.roles (id, name, description, is_active, is_system, created_at, updated_at, tenant_id) FROM stdin;
1	Administrator		t	t	2026-08-24 15:21:06.009571+05:30	2026-08-24 15:21:06.009571+05:30	1
2	Management		t	f	2026-08-24 15:21:06.010775+05:30	2026-08-24 15:21:06.010775+05:30	1
3	Branch Manager		t	f	2026-08-24 15:21:06.011296+05:30	2026-08-24 15:21:06.011296+05:30	1
4	Loan Operator		t	f	2026-08-24 15:21:06.011828+05:30	2026-08-24 15:21:06.011828+05:30	1
5	Cashier		t	f	2026-08-24 15:21:06.012346+05:30	2026-08-24 15:21:06.012346+05:30	1
6	Accountant		t	f	2026-08-24 15:21:06.012916+05:30	2026-08-24 15:21:06.012916+05:30	1
7	Collection Staff		t	f	2026-08-24 15:21:06.013463+05:30	2026-08-24 15:21:06.013463+05:30	1
8	Auction Administrator		t	f	2026-08-24 15:21:06.013463+05:30	2026-08-24 15:21:06.013463+05:30	1
9	Auditor		t	f	2026-08-24 15:21:06.014012+05:30	2026-08-24 15:21:06.014012+05:30	1
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.schema_migrations (id, version) FROM stdin;
1	2026-08-29-billing
\.


--
-- Data for Name: schemes; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.schemes (id, code, name, interest_rate, ltv_percent, interest_method, penal_rate, conditions, is_active, created_at, updated_at, deleted_at, duration_months, branch_id, tenant_id) FROM stdin;
1	SCH-01	Swarna Classic Plus	13	78	Monthly simple interest	2.5	Updated conditions	f	2026-08-07 15:35:39.04135+05:30	2026-08-07 15:35:51.315407+05:30	2026-08-07 15:35:51.369193+05:30	5	1	1
2	SCH-02	Test Scheme	12.5	75	Monthly simple interest	2	test	t	2026-08-10 10:24:39.210651+05:30	2026-08-10 10:24:39.210651+05:30	2026-08-10 10:26:35.542323+05:30	12	1	1
4	SCH-04	TestScheme	12	75	Simple	2		f	2026-08-10 18:28:17.034046+05:30	2026-08-10 18:28:17.034046+05:30	\N	12	1	1
5	SCH-05	gold loan test scheme2	10.02	90	Monthly simple interest	2		t	2026-08-12 14:49:52.167156+05:30	2026-08-12 14:49:52.167156+05:30	\N	12	1	1
6	SCH-06	TestScheme2	10	75	Monthly simple interest	2		t	2026-08-19 14:05:54.075572+05:30	2026-08-19 14:07:25.398971+05:30	\N	12	1	1
3	SCH-03	Golden Shower	12	90	Monthly simple interest	0		t	2026-08-10 14:39:50.478842+05:30	2026-08-25 07:17:16.621131+05:30	\N	12	1	1
8	SCH-08	Test 3	12	90	Monthly simple interest	0		t	2026-08-25 07:17:50.305915+05:30	2026-08-25 07:17:50.305915+05:30	\N	12	1	1
9	SCH-09	test 3	10	90	Monthly simple interest	1		t	2026-08-25 10:00:38.216656+05:30	2026-08-25 10:00:38.216656+05:30	\N	12	1	1
7	SCH-07	Golden	12	90	Monthly simple interest	0	loan are only valid till the end It allows you to create an eKYC request, which generates a verification URL. Once the aadhaar holder completes the Aadhaar verification process, the eKYC data can be retrieved.	t	2026-08-25 07:17:33.579876+05:30	2026-08-25 10:07:37.889749+05:30	\N	12	1	1
\.


--
-- Data for Name: sequences; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.sequences (tenant_id, kind, last_value, updated_at) FROM stdin;
1	loan	21	2026-09-04 14:39:52.305365+05:30
1	customer	11	2026-09-04 14:39:52.307373+05:30
1	employee	15	2026-09-04 14:39:52.308861+05:30
1	packet	17	2026-09-04 14:39:52.310206+05:30
1	scheme	9	2026-09-04 14:39:52.311413+05:30
\.


--
-- Data for Name: superadmin_audit_logs; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.superadmin_audit_logs (id, super_admin_user_id, actor_name, action, tenant_id, tenant_name, detail, reason, ip_address, created_at) FROM stdin;
\.


--
-- Data for Name: superadmin_users; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.superadmin_users (id, name, username, password_hash, is_active, created_at, updated_at) FROM stdin;
1	admin@cloudstick.io	superadmin	$2a$12$xq.gv3yaQZ5Bjo06/AkGQeqHPAGQjxhGZ.q6DAjHQRUDpOQwFjoXq	t	2026-08-31 10:22:39.396217+05:30	2026-08-31 10:22:39.396217+05:30
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.tenants (id, name, code, tier_id, status, subscription_expires_at, grace_period_ends_at, created_at, updated_at, deleted_at, razorpay_subscription_id, subscription_notified_at) FROM stdin;
1	Default Business	default	3	active	\N	\N	2026-08-28 18:01:24.95856+05:30	2026-08-28 18:01:24.95856+05:30	\N	\N	\N
\.


--
-- Data for Name: tiers; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.tiers (id, name, branch_quota, is_active, created_at, updated_at, price_in_paise, razorpay_plan_id) FROM stdin;
1	Starter	1	t	2026-08-28 18:01:24.9515+05:30	2026-08-28 18:01:24.9515+05:30	0	\N
2	Growth	3	t	2026-08-28 18:01:24.952952+05:30	2026-08-28 18:01:24.952952+05:30	0	\N
3	Enterprise	10	t	2026-08-28 18:01:24.953523+05:30	2026-08-28 18:01:24.953523+05:30	0	\N
\.


--
-- Data for Name: uploaded_files; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.uploaded_files (tenant_id, id, storage_key, original_name, content_type, size_bytes, uploaded_by_employee_id, created_at) FROM stdin;
1	1	060dce96723e5cb9-marvels-spider-man-3840x2160-11990.jpeg	060dce96723e5cb9-marvels-spider-man-3840x2160-11990.jpeg		0	\N	2026-08-28 18:01:25.18159+05:30
1	2	3e5c2c0ee21b47dd-photo.png	3e5c2c0ee21b47dd-photo.png		0	\N	2026-08-28 18:01:25.18159+05:30
1	3	7528c5846d28eccf-upload_1787063874353_1000088108.jpg	7528c5846d28eccf-upload_1787063874353_1000088108.jpg		0	\N	2026-08-28 18:01:25.18159+05:30
1	4	f4828a061a481858-PROCESS_FLOW-_India.pdf	f4828a061a481858-PROCESS_FLOW-_India.pdf		0	\N	2026-08-28 18:01:25.183946+05:30
1	5	26c4f864d71337da-marvels-spider-man-3840x2160-11990.jpeg	26c4f864d71337da-marvels-spider-man-3840x2160-11990.jpeg		0	\N	2026-08-28 18:01:25.184373+05:30
1	6	3b93af65355ebab9-images.jfif	3b93af65355ebab9-images.jfif		0	\N	2026-08-28 18:01:25.184373+05:30
1	7	3d3e126487b04f76-WhatsApp_Image_2026-07-23_at_4.14.01_PM.jpeg	3d3e126487b04f76-WhatsApp_Image_2026-07-23_at_4.14.01_PM.jpeg		0	\N	2026-08-28 18:01:25.184373+05:30
1	8	6728ad9f1dd25fa1-marvels-spider-man-3840x2160-11990.jpeg	6728ad9f1dd25fa1-marvels-spider-man-3840x2160-11990.jpeg		0	\N	2026-08-28 18:01:25.184373+05:30
1	9	ca785471306deab4-images.jfif	ca785471306deab4-images.jfif		0	\N	2026-08-28 18:01:25.184373+05:30
1	10	d170850c2b7ac2b7-ChatGPT_Image_Jul_17_2026_10_37_11_AM.png	d170850c2b7ac2b7-ChatGPT_Image_Jul_17_2026_10_37_11_AM.png		0	\N	2026-08-28 18:01:25.184373+05:30
1	11	dafa1318a1260da2-marvels-spider-man-3840x2160-11990.jpeg	dafa1318a1260da2-marvels-spider-man-3840x2160-11990.jpeg		0	\N	2026-08-28 18:01:25.184373+05:30
1	12	d0bcfaf528337925-ambika_gold_finance_logo_1_.svg	d0bcfaf528337925-ambika_gold_finance_logo_1_.svg		0	\N	2026-08-28 18:01:25.185758+05:30
\.


--
-- Data for Name: usage_counters; Type: TABLE DATA; Schema: public; Owner: ambikagold
--

COPY public.usage_counters (tenant_id, category, day, count) FROM stdin;
\.


--
-- Name: api_key_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.api_key_settings_id_seq', 1, true);


--
-- Name: approval_limits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.approval_limits_id_seq', 1, true);


--
-- Name: auction_decision_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.auction_decision_requests_id_seq', 4, true);


--
-- Name: auction_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.auction_events_id_seq', 16, true);


--
-- Name: auction_notices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.auction_notices_id_seq', 12, true);


--
-- Name: auction_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.auction_records_id_seq', 3, true);


--
-- Name: audit_log_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.audit_log_entries_id_seq', 1, false);


--
-- Name: bank_pledge_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.bank_pledge_events_id_seq', 4, true);


--
-- Name: bank_pledge_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.bank_pledge_records_id_seq', 5, true);


--
-- Name: banks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.banks_id_seq', 5, true);


--
-- Name: branches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.branches_id_seq', 3, true);


--
-- Name: cash_movements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.cash_movements_id_seq', 43, true);


--
-- Name: communication_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.communication_logs_id_seq', 246, true);


--
-- Name: customer_device_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.customer_device_tokens_id_seq', 4, true);


--
-- Name: customer_otp_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.customer_otp_id_seq', 6, true);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.customers_id_seq', 11, true);


--
-- Name: dashboard_snapshots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.dashboard_snapshots_id_seq', 2, true);


--
-- Name: employees_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.employees_id_seq', 19, true);


--
-- Name: expenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.expenses_id_seq', 4, true);


--
-- Name: gold_rates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.gold_rates_id_seq', 18, true);


--
-- Name: loan_approvals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.loan_approvals_id_seq', 56, true);


--
-- Name: loan_draft_ornaments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.loan_draft_ornaments_id_seq', 1, false);


--
-- Name: loan_drafts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.loan_drafts_id_seq', 1, false);


--
-- Name: loan_payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.loan_payments_id_seq', 23, true);


--
-- Name: loan_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.loan_requests_id_seq', 6, true);


--
-- Name: loans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.loans_id_seq', 21, true);


--
-- Name: lockers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.lockers_id_seq', 4, true);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.notifications_id_seq', 212, true);


--
-- Name: opening_cash_balances_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.opening_cash_balances_id_seq', 2, true);


--
-- Name: ornament_images_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.ornament_images_id_seq', 7, true);


--
-- Name: ornament_purity_tests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.ornament_purity_tests_id_seq', 1, false);


--
-- Name: ornament_types_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.ornament_types_id_seq', 3, true);


--
-- Name: ornaments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.ornaments_id_seq', 21, true);


--
-- Name: packet_movements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.packet_movements_id_seq', 47, true);


--
-- Name: packets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.packets_id_seq', 18, true);


--
-- Name: permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.permissions_id_seq', 109, true);


--
-- Name: personal_loan_installments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.personal_loan_installments_id_seq', 558, true);


--
-- Name: personal_loan_payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.personal_loan_payments_id_seq', 1, false);


--
-- Name: personal_loans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.personal_loans_id_seq', 40, true);


--
-- Name: purity_standards_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.purity_standards_id_seq', 15, true);


--
-- Name: reminders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.reminders_id_seq', 1, true);


--
-- Name: request_approvals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.request_approvals_id_seq', 10, true);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.role_permissions_id_seq', 982, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.roles_id_seq', 9, true);


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.schema_migrations_id_seq', 1, false);


--
-- Name: schemes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.schemes_id_seq', 9, true);


--
-- Name: superadmin_audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.superadmin_audit_logs_id_seq', 1, false);


--
-- Name: superadmin_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.superadmin_users_id_seq', 1, true);


--
-- Name: tenants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.tenants_id_seq', 1, true);


--
-- Name: tiers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.tiers_id_seq', 3, true);


--
-- Name: uploaded_files_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ambikagold
--

SELECT pg_catalog.setval('public.uploaded_files_id_seq', 12, true);


--
-- Name: api_key_settings api_key_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.api_key_settings
    ADD CONSTRAINT api_key_settings_pkey PRIMARY KEY (id);


--
-- Name: approval_limits approval_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.approval_limits
    ADD CONSTRAINT approval_limits_pkey PRIMARY KEY (id);


--
-- Name: auction_decision_requests auction_decision_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_decision_requests
    ADD CONSTRAINT auction_decision_requests_pkey PRIMARY KEY (id);


--
-- Name: auction_events auction_events_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_events
    ADD CONSTRAINT auction_events_pkey PRIMARY KEY (id);


--
-- Name: auction_notices auction_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_notices
    ADD CONSTRAINT auction_notices_pkey PRIMARY KEY (id);


--
-- Name: auction_records auction_records_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_records
    ADD CONSTRAINT auction_records_pkey PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: bank_pledge_events bank_pledge_events_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.bank_pledge_events
    ADD CONSTRAINT bank_pledge_events_pkey PRIMARY KEY (id);


--
-- Name: bank_pledge_records bank_pledge_records_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.bank_pledge_records
    ADD CONSTRAINT bank_pledge_records_pkey PRIMARY KEY (id);


--
-- Name: banks banks_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: cash_movements cash_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);


--
-- Name: communication_logs communication_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.communication_logs
    ADD CONSTRAINT communication_logs_pkey PRIMARY KEY (id);


--
-- Name: customer_device_tokens customer_device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.customer_device_tokens
    ADD CONSTRAINT customer_device_tokens_pkey PRIMARY KEY (id);


--
-- Name: customer_otp customer_otp_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.customer_otp
    ADD CONSTRAINT customer_otp_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: dashboard_snapshots dashboard_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.dashboard_snapshots
    ADD CONSTRAINT dashboard_snapshots_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: gold_rates gold_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.gold_rates
    ADD CONSTRAINT gold_rates_pkey PRIMARY KEY (id);


--
-- Name: loan_approvals loan_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_approvals
    ADD CONSTRAINT loan_approvals_pkey PRIMARY KEY (id);


--
-- Name: loan_draft_ornaments loan_draft_ornaments_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_draft_ornaments
    ADD CONSTRAINT loan_draft_ornaments_pkey PRIMARY KEY (id);


--
-- Name: loan_drafts loan_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_drafts
    ADD CONSTRAINT loan_drafts_pkey PRIMARY KEY (id);


--
-- Name: loan_payments loan_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_payments
    ADD CONSTRAINT loan_payments_pkey PRIMARY KEY (id);


--
-- Name: loan_requests loan_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_requests
    ADD CONSTRAINT loan_requests_pkey PRIMARY KEY (id);


--
-- Name: loans loans_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_pkey PRIMARY KEY (id);


--
-- Name: lockers lockers_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT lockers_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: opening_cash_balances opening_cash_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.opening_cash_balances
    ADD CONSTRAINT opening_cash_balances_pkey PRIMARY KEY (id);


--
-- Name: ornament_images ornament_images_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_images
    ADD CONSTRAINT ornament_images_pkey PRIMARY KEY (id);


--
-- Name: ornament_purity_tests ornament_purity_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_purity_tests
    ADD CONSTRAINT ornament_purity_tests_pkey PRIMARY KEY (id);


--
-- Name: ornament_types ornament_types_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_types
    ADD CONSTRAINT ornament_types_pkey PRIMARY KEY (id);


--
-- Name: ornaments ornaments_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornaments
    ADD CONSTRAINT ornaments_pkey PRIMARY KEY (id);


--
-- Name: packet_movements packet_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.packet_movements
    ADD CONSTRAINT packet_movements_pkey PRIMARY KEY (id);


--
-- Name: packets packets_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.packets
    ADD CONSTRAINT packets_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: personal_loan_installments personal_loan_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loan_installments
    ADD CONSTRAINT personal_loan_installments_pkey PRIMARY KEY (id);


--
-- Name: personal_loan_payments personal_loan_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loan_payments
    ADD CONSTRAINT personal_loan_payments_pkey PRIMARY KEY (id);


--
-- Name: personal_loans personal_loans_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loans
    ADD CONSTRAINT personal_loans_pkey PRIMARY KEY (id);


--
-- Name: purity_standards purity_standards_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.purity_standards
    ADD CONSTRAINT purity_standards_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: request_approvals request_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.request_approvals
    ADD CONSTRAINT request_approvals_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: schemes schemes_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.schemes
    ADD CONSTRAINT schemes_pkey PRIMARY KEY (id);


--
-- Name: sequences sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_pkey PRIMARY KEY (tenant_id, kind);


--
-- Name: superadmin_audit_logs superadmin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.superadmin_audit_logs
    ADD CONSTRAINT superadmin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: superadmin_users superadmin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.superadmin_users
    ADD CONSTRAINT superadmin_users_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tiers tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_pkey PRIMARY KEY (id);


--
-- Name: uploaded_files uploaded_files_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);


--
-- Name: usage_counters usage_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.usage_counters
    ADD CONSTRAINT usage_counters_pkey PRIMARY KEY (tenant_id, category, day);


--
-- Name: idx_api_key_settings_category; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_api_key_settings_category ON public.api_key_settings USING btree (category);


--
-- Name: idx_approval_limits_role; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_approval_limits_role ON public.approval_limits USING btree (role);


--
-- Name: idx_approval_limits_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_approval_limits_tenant_id ON public.approval_limits USING btree (tenant_id);


--
-- Name: idx_auction_decision_requests_auction_record_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_decision_requests_auction_record_id ON public.auction_decision_requests USING btree (auction_record_id);


--
-- Name: idx_auction_decision_requests_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_decision_requests_loan_id ON public.auction_decision_requests USING btree (loan_id);


--
-- Name: idx_auction_decision_requests_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_decision_requests_tenant_id ON public.auction_decision_requests USING btree (tenant_id);


--
-- Name: idx_auction_events_auction_record_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_events_auction_record_id ON public.auction_events USING btree (auction_record_id);


--
-- Name: idx_auction_events_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_events_tenant_id ON public.auction_events USING btree (tenant_id);


--
-- Name: idx_auction_notices_auction_record_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_notices_auction_record_id ON public.auction_notices USING btree (auction_record_id);


--
-- Name: idx_auction_notices_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_notices_tenant_id ON public.auction_notices USING btree (tenant_id);


--
-- Name: idx_auction_records_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_records_loan_id ON public.auction_records USING btree (loan_id);


--
-- Name: idx_auction_records_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_auction_records_tenant_id ON public.auction_records USING btree (tenant_id);


--
-- Name: idx_audit_log_entries_action; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_audit_log_entries_action ON public.audit_log_entries USING btree (action);


--
-- Name: idx_audit_log_entries_actor_employee_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_audit_log_entries_actor_employee_id ON public.audit_log_entries USING btree (actor_employee_id);


--
-- Name: idx_audit_log_entries_entity_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_audit_log_entries_entity_id ON public.audit_log_entries USING btree (entity_id);


--
-- Name: idx_audit_log_entries_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_audit_log_entries_tenant_id ON public.audit_log_entries USING btree (tenant_id);


--
-- Name: idx_bank_pledge_events_bank_pledge_record_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_bank_pledge_events_bank_pledge_record_id ON public.bank_pledge_events USING btree (bank_pledge_record_id);


--
-- Name: idx_bank_pledge_events_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_bank_pledge_events_tenant_id ON public.bank_pledge_events USING btree (tenant_id);


--
-- Name: idx_bank_pledge_records_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_bank_pledge_records_loan_id ON public.bank_pledge_records USING btree (loan_id);


--
-- Name: idx_bank_pledge_records_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_bank_pledge_records_tenant_id ON public.bank_pledge_records USING btree (tenant_id);


--
-- Name: idx_banks_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_banks_name ON public.banks USING btree (name);


--
-- Name: idx_banks_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_banks_tenant_id ON public.banks USING btree (tenant_id);


--
-- Name: idx_branch_date; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_branch_date ON public.opening_cash_balances USING btree (branch_id, balance_date);


--
-- Name: idx_branches_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_branches_code ON public.branches USING btree (code);


--
-- Name: idx_branches_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_branches_deleted_at ON public.branches USING btree (deleted_at);


--
-- Name: idx_branches_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_branches_name ON public.branches USING btree (name);


--
-- Name: idx_branches_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_branches_tenant_id ON public.branches USING btree (tenant_id);


--
-- Name: idx_cash_movements_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_cash_movements_tenant_id ON public.cash_movements USING btree (tenant_id);


--
-- Name: idx_communication_logs_channel; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_channel ON public.communication_logs USING btree (channel);


--
-- Name: idx_communication_logs_created_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_created_at ON public.communication_logs USING btree (created_at);


--
-- Name: idx_communication_logs_recipient_phone; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_recipient_phone ON public.communication_logs USING btree (recipient_phone);


--
-- Name: idx_communication_logs_related_entity_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_related_entity_id ON public.communication_logs USING btree (related_entity_id);


--
-- Name: idx_communication_logs_related_entity_type; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_related_entity_type ON public.communication_logs USING btree (related_entity_type);


--
-- Name: idx_communication_logs_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_tenant_id ON public.communication_logs USING btree (tenant_id);


--
-- Name: idx_communication_logs_trigger_type; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_trigger_type ON public.communication_logs USING btree (trigger_type);


--
-- Name: idx_communication_logs_triggered_by_employee_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_communication_logs_triggered_by_employee_id ON public.communication_logs USING btree (triggered_by_employee_id);


--
-- Name: idx_customer_device_tokens_customer_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customer_device_tokens_customer_id ON public.customer_device_tokens USING btree (customer_id);


--
-- Name: idx_customer_device_tokens_device_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customer_device_tokens_device_id ON public.customer_device_tokens USING btree (device_id);


--
-- Name: idx_customer_device_tokens_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customer_device_tokens_tenant_id ON public.customer_device_tokens USING btree (tenant_id);


--
-- Name: idx_customer_device_tokens_token_hash; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_customer_device_tokens_token_hash ON public.customer_device_tokens USING btree (token_hash);


--
-- Name: idx_customer_otp_phone; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customer_otp_phone ON public.customer_otp USING btree (phone);


--
-- Name: idx_customer_otp_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customer_otp_tenant_id ON public.customer_otp USING btree (tenant_id);


--
-- Name: idx_customers_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customers_code ON public.customers USING btree (code);


--
-- Name: idx_customers_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customers_deleted_at ON public.customers USING btree (deleted_at);


--
-- Name: idx_customers_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_customers_tenant_id ON public.customers USING btree (tenant_id);


--
-- Name: idx_dashboard_snapshots_date; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_dashboard_snapshots_date ON public.dashboard_snapshots USING btree (date);


--
-- Name: idx_employees_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_employees_code ON public.employees USING btree (code);


--
-- Name: idx_employees_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_employees_deleted_at ON public.employees USING btree (deleted_at);


--
-- Name: idx_employees_email; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_employees_email ON public.employees USING btree (email);


--
-- Name: idx_employees_phone; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_employees_phone ON public.employees USING btree (phone);


--
-- Name: idx_employees_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_employees_tenant_id ON public.employees USING btree (tenant_id);


--
-- Name: idx_employees_username; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_employees_username ON public.employees USING btree (username);


--
-- Name: idx_expenses_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_expenses_tenant_id ON public.expenses USING btree (tenant_id);


--
-- Name: idx_gold_rates_date; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_gold_rates_date ON public.gold_rates USING btree (date);


--
-- Name: idx_gold_rates_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_gold_rates_tenant_id ON public.gold_rates USING btree (tenant_id);


--
-- Name: idx_loan_approvals_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_approvals_loan_id ON public.loan_approvals USING btree (loan_id);


--
-- Name: idx_loan_approvals_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_approvals_tenant_id ON public.loan_approvals USING btree (tenant_id);


--
-- Name: idx_loan_draft_ornaments_draft_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_draft_ornaments_draft_id ON public.loan_draft_ornaments USING btree (draft_id);


--
-- Name: idx_loan_draft_ornaments_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_draft_ornaments_tenant_id ON public.loan_draft_ornaments USING btree (tenant_id);


--
-- Name: idx_loan_drafts_branch_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_drafts_branch_id ON public.loan_drafts USING btree (branch_id);


--
-- Name: idx_loan_drafts_created_by_employee_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_drafts_created_by_employee_id ON public.loan_drafts USING btree (created_by_employee_id);


--
-- Name: idx_loan_drafts_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_drafts_tenant_id ON public.loan_drafts USING btree (tenant_id);


--
-- Name: idx_loan_payments_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_payments_loan_id ON public.loan_payments USING btree (loan_id);


--
-- Name: idx_loan_payments_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_payments_tenant_id ON public.loan_payments USING btree (tenant_id);


--
-- Name: idx_loan_requests_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_requests_loan_id ON public.loan_requests USING btree (loan_id);


--
-- Name: idx_loan_requests_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loan_requests_tenant_id ON public.loan_requests USING btree (tenant_id);


--
-- Name: idx_loans_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loans_deleted_at ON public.loans USING btree (deleted_at);


--
-- Name: idx_loans_loan_number; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loans_loan_number ON public.loans USING btree (loan_number);


--
-- Name: idx_loans_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_loans_tenant_id ON public.loans USING btree (tenant_id);


--
-- Name: idx_lockers_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_lockers_code ON public.lockers USING btree (code);


--
-- Name: idx_lockers_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_lockers_deleted_at ON public.lockers USING btree (deleted_at);


--
-- Name: idx_lockers_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_lockers_tenant_id ON public.lockers USING btree (tenant_id);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at);


--
-- Name: idx_notifications_customer_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_customer_id ON public.notifications USING btree (customer_id);


--
-- Name: idx_notifications_delivered; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_delivered ON public.notifications USING btree (delivered);


--
-- Name: idx_notifications_read; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_read ON public.notifications USING btree (read);


--
-- Name: idx_notifications_related_entity_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_related_entity_id ON public.notifications USING btree (related_entity_id);


--
-- Name: idx_notifications_related_entity_type; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_related_entity_type ON public.notifications USING btree (related_entity_type);


--
-- Name: idx_notifications_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_tenant_id ON public.notifications USING btree (tenant_id);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (type);


--
-- Name: idx_opening_cash_balances_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_opening_cash_balances_tenant_id ON public.opening_cash_balances USING btree (tenant_id);


--
-- Name: idx_ornament_images_ornament_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_ornament_images_ornament_id ON public.ornament_images USING btree (ornament_id);


--
-- Name: idx_ornament_images_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_ornament_images_tenant_id ON public.ornament_images USING btree (tenant_id);


--
-- Name: idx_ornament_purity_tests_ornament_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_ornament_purity_tests_ornament_id ON public.ornament_purity_tests USING btree (ornament_id);


--
-- Name: idx_ornament_purity_tests_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_ornament_purity_tests_tenant_id ON public.ornament_purity_tests USING btree (tenant_id);


--
-- Name: idx_ornament_types_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_ornament_types_name ON public.ornament_types USING btree (name);


--
-- Name: idx_ornament_types_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_ornament_types_tenant_id ON public.ornament_types USING btree (tenant_id);


--
-- Name: idx_ornaments_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_ornaments_loan_id ON public.ornaments USING btree (loan_id);


--
-- Name: idx_ornaments_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_ornaments_tenant_id ON public.ornaments USING btree (tenant_id);


--
-- Name: idx_packet_movements_packet_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_packet_movements_packet_id ON public.packet_movements USING btree (packet_id);


--
-- Name: idx_packet_movements_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_packet_movements_tenant_id ON public.packet_movements USING btree (tenant_id);


--
-- Name: idx_packets_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_packets_code ON public.packets USING btree (code);


--
-- Name: idx_packets_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_packets_loan_id ON public.packets USING btree (loan_id);


--
-- Name: idx_packets_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_packets_tenant_id ON public.packets USING btree (tenant_id);


--
-- Name: idx_permissions_module_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_permissions_module_name ON public.permissions USING btree (module_name);


--
-- Name: idx_permissions_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_permissions_name ON public.permissions USING btree (name);


--
-- Name: idx_personal_loan_installments_personal_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_personal_loan_installments_personal_loan_id ON public.personal_loan_installments USING btree (personal_loan_id);


--
-- Name: idx_personal_loan_installments_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_personal_loan_installments_tenant_id ON public.personal_loan_installments USING btree (tenant_id);


--
-- Name: idx_personal_loan_payments_personal_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_personal_loan_payments_personal_loan_id ON public.personal_loan_payments USING btree (personal_loan_id);


--
-- Name: idx_personal_loan_payments_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_personal_loan_payments_tenant_id ON public.personal_loan_payments USING btree (tenant_id);


--
-- Name: idx_personal_loans_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_personal_loans_deleted_at ON public.personal_loans USING btree (deleted_at);


--
-- Name: idx_personal_loans_loan_number; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_personal_loans_loan_number ON public.personal_loans USING btree (loan_number);


--
-- Name: idx_personal_loans_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_personal_loans_tenant_id ON public.personal_loans USING btree (tenant_id);


--
-- Name: idx_purity_standards_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_purity_standards_tenant_id ON public.purity_standards USING btree (tenant_id);


--
-- Name: idx_reminders_customer_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_reminders_customer_id ON public.reminders USING btree (customer_id);


--
-- Name: idx_reminders_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_reminders_deleted_at ON public.reminders USING btree (deleted_at);


--
-- Name: idx_reminders_due_date; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_reminders_due_date ON public.reminders USING btree (due_date);


--
-- Name: idx_reminders_loan_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_reminders_loan_id ON public.reminders USING btree (loan_id);


--
-- Name: idx_reminders_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_reminders_tenant_id ON public.reminders USING btree (tenant_id);


--
-- Name: idx_request_approvals_request_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_request_approvals_request_id ON public.request_approvals USING btree (request_id);


--
-- Name: idx_request_approvals_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_request_approvals_tenant_id ON public.request_approvals USING btree (tenant_id);


--
-- Name: idx_role_permission; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_role_permission ON public.role_permissions USING btree (role_id, permission_id);


--
-- Name: idx_role_permissions_permission_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions USING btree (permission_id);


--
-- Name: idx_role_permissions_role_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_role_permissions_role_id ON public.role_permissions USING btree (role_id);


--
-- Name: idx_role_permissions_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_role_permissions_tenant_id ON public.role_permissions USING btree (tenant_id);


--
-- Name: idx_roles_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_roles_name ON public.roles USING btree (name);


--
-- Name: idx_roles_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_roles_tenant_id ON public.roles USING btree (tenant_id);


--
-- Name: idx_schemes_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_schemes_code ON public.schemes USING btree (code);


--
-- Name: idx_schemes_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_schemes_deleted_at ON public.schemes USING btree (deleted_at);


--
-- Name: idx_schemes_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_schemes_tenant_id ON public.schemes USING btree (tenant_id);


--
-- Name: idx_single_active_auction_per_loan; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_single_active_auction_per_loan ON public.auction_records USING btree (loan_id) WHERE ((stage)::text <> ALL ((ARRAY['Settled'::character varying, 'Withdrawn'::character varying])::text[]));


--
-- Name: idx_single_pending_auction_decision; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_single_pending_auction_decision ON public.auction_decision_requests USING btree (auction_record_id, kind) WHERE ((status)::text = 'Pending'::text);


--
-- Name: idx_superadmin_audit_logs_action; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_superadmin_audit_logs_action ON public.superadmin_audit_logs USING btree (action);


--
-- Name: idx_superadmin_audit_logs_super_admin_user_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_superadmin_audit_logs_super_admin_user_id ON public.superadmin_audit_logs USING btree (super_admin_user_id);


--
-- Name: idx_superadmin_audit_logs_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_superadmin_audit_logs_tenant_id ON public.superadmin_audit_logs USING btree (tenant_id);


--
-- Name: idx_superadmin_users_username; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_superadmin_users_username ON public.superadmin_users USING btree (username);


--
-- Name: idx_tenants_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_tenants_code ON public.tenants USING btree (code);


--
-- Name: idx_tenants_deleted_at; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_tenants_deleted_at ON public.tenants USING btree (deleted_at);


--
-- Name: idx_tenants_razorpay_subscription_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_tenants_razorpay_subscription_id ON public.tenants USING btree (razorpay_subscription_id);


--
-- Name: idx_tenants_status; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_tenants_status ON public.tenants USING btree (status);


--
-- Name: idx_tenants_tier_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_tenants_tier_id ON public.tenants USING btree (tier_id);


--
-- Name: idx_tiers_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX idx_tiers_name ON public.tiers USING btree (name);


--
-- Name: idx_uploaded_files_storage_key; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_uploaded_files_storage_key ON public.uploaded_files USING btree (storage_key);


--
-- Name: idx_uploaded_files_tenant_id; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE INDEX idx_uploaded_files_tenant_id ON public.uploaded_files USING btree (tenant_id);


--
-- Name: uq_approval_limits_tenant_role; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_approval_limits_tenant_role ON public.approval_limits USING btree (tenant_id, role);


--
-- Name: uq_banks_tenant_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_banks_tenant_name ON public.banks USING btree (tenant_id, name);


--
-- Name: uq_branches_tenant_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_branches_tenant_code ON public.branches USING btree (tenant_id, code);


--
-- Name: uq_branches_tenant_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_branches_tenant_name ON public.branches USING btree (tenant_id, name);


--
-- Name: uq_customer_otp_tenant_phone; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_customer_otp_tenant_phone ON public.customer_otp USING btree (tenant_id, phone);


--
-- Name: uq_customers_tenant_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_customers_tenant_code ON public.customers USING btree (tenant_id, code);


--
-- Name: uq_employees_tenant_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_employees_tenant_code ON public.employees USING btree (tenant_id, code);


--
-- Name: uq_employees_tenant_email; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_employees_tenant_email ON public.employees USING btree (tenant_id, email) WHERE ((email)::text <> ''::text);


--
-- Name: uq_employees_tenant_phone; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_employees_tenant_phone ON public.employees USING btree (tenant_id, phone) WHERE ((phone)::text <> ''::text);


--
-- Name: uq_employees_tenant_username; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_employees_tenant_username ON public.employees USING btree (tenant_id, username) WHERE ((username)::text <> ''::text);


--
-- Name: uq_loans_tenant_loan_number; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_loans_tenant_loan_number ON public.loans USING btree (tenant_id, loan_number);


--
-- Name: uq_lockers_tenant_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_lockers_tenant_code ON public.lockers USING btree (tenant_id, code);


--
-- Name: uq_ornament_types_tenant_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_ornament_types_tenant_name ON public.ornament_types USING btree (tenant_id, name);


--
-- Name: uq_packets_tenant_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_packets_tenant_code ON public.packets USING btree (tenant_id, code);


--
-- Name: uq_roles_tenant_name; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_roles_tenant_name ON public.roles USING btree (tenant_id, name);


--
-- Name: uq_schemes_tenant_code; Type: INDEX; Schema: public; Owner: ambikagold
--

CREATE UNIQUE INDEX uq_schemes_tenant_code ON public.schemes USING btree (tenant_id, code);


--
-- Name: auction_decision_requests fk_auction_records_decision_requests; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_decision_requests
    ADD CONSTRAINT fk_auction_records_decision_requests FOREIGN KEY (auction_record_id) REFERENCES public.auction_records(id);


--
-- Name: auction_events fk_auction_records_events; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_events
    ADD CONSTRAINT fk_auction_records_events FOREIGN KEY (auction_record_id) REFERENCES public.auction_records(id);


--
-- Name: auction_notices fk_auction_records_notices; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.auction_notices
    ADD CONSTRAINT fk_auction_records_notices FOREIGN KEY (auction_record_id) REFERENCES public.auction_records(id);


--
-- Name: bank_pledge_events fk_bank_pledge_records_events; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.bank_pledge_events
    ADD CONSTRAINT fk_bank_pledge_records_events FOREIGN KEY (bank_pledge_record_id) REFERENCES public.bank_pledge_records(id);


--
-- Name: cash_movements fk_cash_movements_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT fk_cash_movements_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: customers fk_customers_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT fk_customers_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: employees fk_employees_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT fk_employees_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: expenses fk_expenses_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT fk_expenses_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: loan_drafts fk_loan_drafts_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_drafts
    ADD CONSTRAINT fk_loan_drafts_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: loan_drafts fk_loan_drafts_customer; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_drafts
    ADD CONSTRAINT fk_loan_drafts_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: loan_draft_ornaments fk_loan_drafts_ornaments; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_draft_ornaments
    ADD CONSTRAINT fk_loan_drafts_ornaments FOREIGN KEY (draft_id) REFERENCES public.loan_drafts(id);


--
-- Name: loan_drafts fk_loan_drafts_scheme; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_drafts
    ADD CONSTRAINT fk_loan_drafts_scheme FOREIGN KEY (scheme_id) REFERENCES public.schemes(id);


--
-- Name: loan_requests fk_loan_requests_loan; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_requests
    ADD CONSTRAINT fk_loan_requests_loan FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: loan_approvals fk_loans_approvals; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_approvals
    ADD CONSTRAINT fk_loans_approvals FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: loans fk_loans_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT fk_loans_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: loans fk_loans_customer; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT fk_loans_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: ornaments fk_loans_ornaments; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornaments
    ADD CONSTRAINT fk_loans_ornaments FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: loan_payments fk_loans_payments; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loan_payments
    ADD CONSTRAINT fk_loans_payments FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: bank_pledge_records fk_loans_pledges; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.bank_pledge_records
    ADD CONSTRAINT fk_loans_pledges FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: loans fk_loans_scheme; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT fk_loans_scheme FOREIGN KEY (scheme_id) REFERENCES public.schemes(id);


--
-- Name: lockers fk_lockers_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT fk_lockers_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: opening_cash_balances fk_opening_cash_balances_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.opening_cash_balances
    ADD CONSTRAINT fk_opening_cash_balances_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: ornament_images fk_ornaments_images; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_images
    ADD CONSTRAINT fk_ornaments_images FOREIGN KEY (ornament_id) REFERENCES public.ornaments(id);


--
-- Name: ornament_purity_tests fk_ornaments_purity_test; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.ornament_purity_tests
    ADD CONSTRAINT fk_ornaments_purity_test FOREIGN KEY (ornament_id) REFERENCES public.ornaments(id);


--
-- Name: packets fk_packets_loan; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.packets
    ADD CONSTRAINT fk_packets_loan FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: packet_movements fk_packets_movements; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.packet_movements
    ADD CONSTRAINT fk_packets_movements FOREIGN KEY (packet_id) REFERENCES public.packets(id);


--
-- Name: personal_loans fk_personal_loans_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loans
    ADD CONSTRAINT fk_personal_loans_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: personal_loans fk_personal_loans_customer; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loans
    ADD CONSTRAINT fk_personal_loans_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: personal_loan_installments fk_personal_loans_installments; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loan_installments
    ADD CONSTRAINT fk_personal_loans_installments FOREIGN KEY (personal_loan_id) REFERENCES public.personal_loans(id);


--
-- Name: personal_loan_payments fk_personal_loans_payments; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.personal_loan_payments
    ADD CONSTRAINT fk_personal_loans_payments FOREIGN KEY (personal_loan_id) REFERENCES public.personal_loans(id);


--
-- Name: reminders fk_reminders_customer; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT fk_reminders_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: schemes fk_schemes_branch; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.schemes
    ADD CONSTRAINT fk_schemes_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: tenants fk_tenants_tier; Type: FK CONSTRAINT; Schema: public; Owner: ambikagold
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT fk_tenants_tier FOREIGN KEY (tier_id) REFERENCES public.tiers(id);


--
-- PostgreSQL database dump complete
--


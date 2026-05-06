-- ═══════════════════════════════════════════════════════════════════════════
-- SevaSuite Production Schema — v3 (Sprint 3: Multi-Tenancy + RLS + DPDP)
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable pgvector extension for AI embeddings
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 0. Multi-Tenancy: NGO Registry ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ngos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,      -- e.g. "india-ngo-trust"
    pan         VARCHAR(20),
    fcra_reg    VARCHAR(50),
    reg_no      VARCHAR(100),
    state       VARCHAR(100),
    tier        VARCHAR(20) DEFAULT 'standard',    -- standard | pro | enterprise
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active   BOOLEAN DEFAULT true
);

-- ── 1. Users & RBAC ────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('ed', 'finance', 'programs', 'field', 'board');

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id          UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,               -- bcrypt hash; NEVER store plaintext
    full_name       VARCHAR(150) NOT NULL,
    role            user_role NOT NULL DEFAULT 'field',
    avatar_url      TEXT,
    last_login_at   TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active       BOOLEAN DEFAULT true
);

CREATE INDEX idx_users_ngo ON users(ngo_id);

-- ── 2. Core CRM: Donors Table (ngo_id scoped) ─────────────────────────────
CREATE TABLE IF NOT EXISTS donors (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id                UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    donor_code            VARCHAR(20) NOT NULL,
    full_name             VARCHAR(150) NOT NULL,
    email                 VARCHAR(255),
    phone                 VARCHAR(20),
    preferred_language    VARCHAR(50) DEFAULT 'English',
    total_lifetime_value  DECIMAL(12, 2) DEFAULT 0.00,
    consent_given         BOOLEAN DEFAULT false,    -- DPDP: must be true to process
    consent_date          TIMESTAMP WITH TIME ZONE,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ngo_id, donor_code)
);

CREATE INDEX idx_donors_ngo ON donors(ngo_id);

-- Optional app metadata for SevaSuite UI (safe to apply repeatedly)
ALTER TABLE donors ADD COLUMN IF NOT EXISTS donor_type TEXT;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS pan_masked TEXT;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS location_text TEXT;
ALTER TABLE donors ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE donors ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

-- ── 3. Finance: Transactions (ngo_id scoped) ───────────────────────────────
CREATE TYPE fund_type AS ENUM ('General', 'FCRA', 'CSR', 'Restricted Grant');

CREATE TABLE IF NOT EXISTS transactions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id               UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    donor_id             UUID REFERENCES donors(id),
    amount               DECIMAL(12, 2) NOT NULL,
    fund_classification  fund_type NOT NULL,
    payment_method       VARCHAR(50),
    transaction_date     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    requires_review      BOOLEAN DEFAULT false,
    receipt_generated    BOOLEAN DEFAULT false
);

CREATE INDEX idx_transactions_ngo ON transactions(ngo_id);
CREATE INDEX idx_transactions_donor ON transactions(donor_id);

-- Optional app metadata for SevaSuite UI (safe to apply repeatedly)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS donor_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS campaign_title TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
-- Cross-module join fields (Data Foundation — Task #34)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS grant_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS programme_id TEXT;

-- ── 3b. Fundraising: Campaigns (ngo_id scoped) ─────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
    id           TEXT PRIMARY KEY,                 -- frontend-friendly id e.g. c1, c2
    ngo_id       TEXT NOT NULL,
    title        VARCHAR(255) NOT NULL,
    cause        VARCHAR(120),
    goal         DECIMAL(14, 2) NOT NULL DEFAULT 0,
    raised       DECIMAL(14, 2) NOT NULL DEFAULT 0,
    donors_count INTEGER NOT NULL DEFAULT 0,
    status       VARCHAR(20) NOT NULL DEFAULT 'active', -- active | draft
    image        TEXT,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaigns_ngo ON campaigns(ngo_id);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 3c. CSR: Pipeline Cards (ngo_id scoped) ────────────────────────────────
CREATE TABLE IF NOT EXISTS csr_pipeline_cards (
    id          TEXT PRIMARY KEY,         -- frontend-friendly id
    ngo_id      TEXT NOT NULL,
    company     VARCHAR(255) NOT NULL,
    amount      DECIMAL(14, 2) NOT NULL DEFAULT 0,
    project     TEXT,
    tags        TEXT[] DEFAULT '{}',
    agent       TEXT,
    col         VARCHAR(40) NOT NULL DEFAULT 'prospecting',
    date_label  TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE csr_pipeline_cards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE csr_pipeline_cards ADD COLUMN IF NOT EXISTS win_probability INTEGER NOT NULL DEFAULT 55;
ALTER TABLE csr_pipeline_cards ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Per-card grant lifecycle state (parser approvals, deliverables progress,
-- reports, budget heads, closure checklist, isClosed flag). Read/written by
-- GrantDetail.tsx through GET/PUT /csr/cards/{id}/grant-state. Stored as one
-- JSONB blob so the shape can evolve without migrations.
ALTER TABLE csr_pipeline_cards ADD COLUMN IF NOT EXISTS grant_state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE csr_pipeline_cards ADD COLUMN IF NOT EXISTS grant_state_updated_at TIMESTAMP WITH TIME ZONE;
-- Last result of the Grant Parser extraction over the card's MoU/contract.
-- Stored as one JSONB blob: {rows: [...], source: 'llm'|'heuristic', doc_id,
-- doc_name, extracted_at}. Read by GET and overwritten by POST on
-- /csr/cards/{id}/parser-rows. Re-runs are user-initiated.
ALTER TABLE csr_pipeline_cards ADD COLUMN IF NOT EXISTS parser_extraction JSONB;

CREATE INDEX IF NOT EXISTS idx_csr_pipeline_ngo ON csr_pipeline_cards(ngo_id);

-- CSR: Document rooms per pipeline card (ngo_id scoped)
CREATE TABLE IF NOT EXISTS csr_card_documents (
    id         TEXT PRIMARY KEY,
    ngo_id     TEXT NOT NULL,
    card_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    doc_type   TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    s3_key     TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_csr_card_docs_ngo ON csr_card_documents(ngo_id);
CREATE INDEX IF NOT EXISTS idx_csr_card_docs_card ON csr_card_documents(card_id);

-- ── 3d. Volunteers: Shifts + Signups (ngo_id scoped) ───────────────────────
CREATE TABLE IF NOT EXISTS volunteer_shifts (
    id          INTEGER PRIMARY KEY,
    ngo_id      TEXT NOT NULL,
    title       TEXT NOT NULL,
    date_label  TEXT NOT NULL,
    location    TEXT NOT NULL,
    filled      INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    role        TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_volunteer_shifts_ngo ON volunteer_shifts(ngo_id);

CREATE TABLE IF NOT EXISTS volunteer_shift_signups (
    id             TEXT PRIMARY KEY,
    ngo_id         TEXT NOT NULL,
    shift_id       INTEGER NOT NULL,
    volunteer_name TEXT NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_volunteer_signups_ngo ON volunteer_shift_signups(ngo_id);
ALTER TABLE volunteer_shift_signups ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 3g. Volunteers: Events (reminders/broadcasts) for Inbox UX ──────────────
CREATE TABLE IF NOT EXISTS volunteer_events (
    id            TEXT PRIMARY KEY,
    ngo_id        TEXT NOT NULL,
    type          TEXT NOT NULL,                -- reminder | broadcast | signup | etc
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_volunteer_events_ngo ON volunteer_events(ngo_id);

-- ── 3e. Programs: Beneficiaries (ngo_id scoped) ────────────────────────────
CREATE TABLE IF NOT EXISTS program_beneficiaries (
    id          TEXT PRIMARY KEY,  -- frontend-friendly
    ngo_id      TEXT NOT NULL,
    name        TEXT NOT NULL,
    program     TEXT NOT NULL,
    location    TEXT NOT NULL,
    aadhaar     BOOLEAN NOT NULL DEFAULT false,
    family_size INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_program_beneficiaries_ngo ON program_beneficiaries(ngo_id);
ALTER TABLE program_beneficiaries ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 3f. Volunteers: Roster (ngo_id scoped) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS volunteer_roster (
    id         TEXT PRIMARY KEY,
    ngo_id     TEXT NOT NULL,
    name       TEXT NOT NULL,
    skills     TEXT[] DEFAULT '{}',
    hours      INTEGER NOT NULL DEFAULT 0,
    verified   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_volunteer_roster_ngo ON volunteer_roster(ngo_id);
ALTER TABLE volunteer_roster ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 4. RAG Vector Store (ngo_id scoped) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS vector_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id          UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    document_title  VARCHAR(255) NOT NULL,
    document_type   VARCHAR(50) NOT NULL,
    chunk_index     INTEGER NOT NULL,
    chunk_text      TEXT NOT NULL,
    embedding       vector(1536),
    s3_key          TEXT,                          -- AWS S3 object key for full doc
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ON vector_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_vector_docs_ngo ON vector_documents(ngo_id);

-- ── 5. Audit Log (ngo_id scoped, append-only) ──────────────────────────────
CREATE TABLE IF NOT EXISTS agent_audit_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id            UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    agent_name        VARCHAR(100) NOT NULL,
    action_type       VARCHAR(100) NOT NULL,
    target_id         UUID,
    execution_details JSONB,
    status            VARCHAR(20) NOT NULL,
    performed_by      UUID REFERENCES users(id),
    timestamp         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_ngo ON agent_audit_log(ngo_id);

-- ── 6. DPDP Act 2023 — Consent Registry ────────────────────────────────────
-- Tracks consent from every data subject (donor / beneficiary / volunteer).
CREATE TYPE consent_purpose AS ENUM (
    'fundraising_comms', 'operational_reporting', 'third_party_sharing',
    'analytics', 'grant_reporting', 'whatsapp_outreach'
);

CREATE TABLE IF NOT EXISTS consent_registry (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id            UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    data_subject_id   UUID,                          -- donor_id / beneficiary_id
    data_subject_type VARCHAR(50) NOT NULL,           -- 'donor' | 'beneficiary' | 'volunteer'
    email             VARCHAR(255),
    phone             VARCHAR(20),
    purpose           consent_purpose NOT NULL,
    consent_given     BOOLEAN NOT NULL,
    consent_date      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address        INET,
    consent_text_hash TEXT,                           -- SHA256 of the exact notice shown
    withdrawn_at      TIMESTAMP WITH TIME ZONE,       -- populated on §12 withdrawal
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consent_ngo ON consent_registry(ngo_id);
CREATE INDEX idx_consent_subject ON consent_registry(data_subject_id);

-- ── 7. DPDP Act 2023 — Data Erasure Requests (§12) ─────────────────────────
CREATE TYPE erasure_status AS ENUM (
    'received', 'in_review', 'completed', 'rejected'
);

CREATE TABLE IF NOT EXISTS data_erasure_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id            UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    data_subject_id   UUID,
    data_subject_type VARCHAR(50) NOT NULL,
    email             VARCHAR(255) NOT NULL,
    phone             VARCHAR(20),
    request_reason    TEXT,
    status            erasure_status NOT NULL DEFAULT 'received',
    received_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- DPDP §12: must complete within 30 days
    deadline_at       TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS
                        (received_at + INTERVAL '30 days') STORED,
    completed_at      TIMESTAMP WITH TIME ZONE,
    completed_by      UUID REFERENCES users(id),
    rejection_reason  TEXT
);

CREATE INDEX idx_erasure_ngo ON data_erasure_requests(ngo_id);
CREATE INDEX idx_erasure_status ON data_erasure_requests(status);

-- ── 8. DPDP Act 2023 — Breach Log (§8: 72hr notification duty) ─────────────
CREATE TYPE breach_severity AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE IF NOT EXISTS breach_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id              UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    title               VARCHAR(255) NOT NULL,
    description         TEXT NOT NULL,
    severity            breach_severity NOT NULL,
    affected_records    INTEGER DEFAULT 0,
    discovered_at       TIMESTAMP WITH TIME ZONE NOT NULL,
    -- DPDP §8: notify DPB within 72 hours
    notification_due_at TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS
                          (discovered_at + INTERVAL '72 hours') STORED,
    notified_dpb_at     TIMESTAMP WITH TIME ZONE,    -- NULL = not yet notified
    remediation_notes   TEXT,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_breach_ngo ON breach_log(ngo_id);

-- ── 9. CSR Prospect DB (ngo_id scoped) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS csr_prospect_companies (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id             TEXT NOT NULL,
    company_name       VARCHAR(255) NOT NULL,
    sector             VARCHAR(120) NOT NULL,
    hq_city            VARCHAR(120) NOT NULL,
    annual_revenue_cr  DECIMAL(14, 2) DEFAULT 0,
    csr_obligation_cr  DECIMAL(14, 2) DEFAULT 0,
    focus_areas        TEXT[] DEFAULT '{}',
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_csr_prospect_companies_ngo ON csr_prospect_companies(ngo_id);
CREATE INDEX IF NOT EXISTS idx_csr_prospect_companies_name ON csr_prospect_companies(company_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_csr_prospect_companies_unique
    ON csr_prospect_companies (ngo_id, company_name, hq_city);

-- ── 10. Governance: Board Members (ngo_id scoped) ──────────────────────────
CREATE TABLE IF NOT EXISTS governance_board_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id      TEXT NOT NULL,
    full_name   VARCHAR(255) NOT NULL,
    role        VARCHAR(120) NOT NULL,
    din         VARCHAR(80) NOT NULL,
    tenure      VARCHAR(120),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_board_members_ngo ON governance_board_members(ngo_id);

-- ── 11. Agentic UX: Intent Queue / HITL Actions (ngo_id scoped) ─────────────
CREATE TYPE intent_status AS ENUM ('queued', 'approved', 'executed', 'rejected', 'failed');

CREATE TABLE IF NOT EXISTS intent_queue (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id        TEXT NOT NULL,
    created_by    TEXT,
    directive     TEXT NOT NULL,
    intent_type   VARCHAR(80),
    risk_level    VARCHAR(20),
    action_card   JSONB NOT NULL,
    status        intent_status NOT NULL DEFAULT 'queued',
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_intent_queue_ngo ON intent_queue(ngo_id);
CREATE INDEX IF NOT EXISTS idx_intent_queue_status ON intent_queue(status);

-- Forward-compatible columns (safe to apply repeatedly)
ALTER TABLE intent_queue ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE intent_queue ADD COLUMN IF NOT EXISTS execution_result JSONB;
ALTER TABLE intent_queue ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE intent_queue ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE intent_queue ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;

-- ── 12. DPDP Notice Versions (ngo_id scoped) ───────────────────────────────
CREATE TABLE IF NOT EXISTS dpdp_notice_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id      TEXT NOT NULL,
    version     INTEGER NOT NULL,
    notice_md   TEXT NOT NULL,
    created_by  TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpdp_notice_version
    ON dpdp_notice_versions (ngo_id, version);

-- ── 13. Finance: Grants / Budgets (ngo_id scoped) ──────────────────────────
CREATE TABLE IF NOT EXISTS finance_grants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id      TEXT NOT NULL,
    grant_code  VARCHAR(50),
    name        VARCHAR(255) NOT NULL,
    total       DECIMAL(14, 2) NOT NULL DEFAULT 0,
    spent       DECIMAL(14, 2) NOT NULL DEFAULT 0,
    variance    DECIMAL(14, 2) NOT NULL DEFAULT 0,
    status      VARCHAR(50) NOT NULL DEFAULT 'On Track',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finance_grants_ngo ON finance_grants(ngo_id);

-- ── 14. Compliance: Document metadata (ngo_id scoped) ──────────────────────
CREATE TABLE IF NOT EXISTS compliance_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id      TEXT NOT NULL,
    name        VARCHAR(255) NOT NULL,
    doc_type    VARCHAR(120) NOT NULL,
    status      VARCHAR(30) NOT NULL DEFAULT 'Valid', -- Valid | Expiring Soon | Expired
    expiry_date DATE,
    s3_key      TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_docs_ngo ON compliance_documents(ngo_id);
CREATE INDEX IF NOT EXISTS idx_compliance_docs_expiry ON compliance_documents(expiry_date);

ALTER TABLE compliance_documents ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE compliance_documents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE compliance_documents ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 15. Inbox item state (generic snooze/done for any kind) ─────────────────
CREATE TABLE IF NOT EXISTS inbox_item_states (
    ngo_id        TEXT NOT NULL,
    kind          TEXT NOT NULL,
    ref_id        TEXT NOT NULL,
    snoozed_until TIMESTAMP WITH TIME ZONE,
    resolved_at   TIMESTAMP WITH TIME ZONE,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ngo_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_states_ngo ON inbox_item_states(ngo_id);

-- ── 16. WhatsApp Touchpoints — per-recipient delivery tracking ──────────────
-- One row per donor per outreach batch. wamid is the message ID returned by
-- WhatsApp Business Cloud API; status is updated by the /crm/whatsapp/webhook
-- endpoint as delivery receipts arrive.
CREATE TABLE IF NOT EXISTS touchpoints (
    id          TEXT PRIMARY KEY,
    ngo_id      UUID NOT NULL,
    outreach_id TEXT NOT NULL,
    donor_id    TEXT NOT NULL,
    channel     TEXT NOT NULL DEFAULT 'whatsapp',
    wamid       TEXT,
    status      TEXT NOT NULL DEFAULT 'sent',  -- sent | delivered | read | failed
    error_msg   TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_touchpoints_ngo      ON touchpoints(ngo_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_outreach  ON touchpoints(outreach_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_wamid     ON touchpoints(wamid) WHERE wamid IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security (RLS) — One DB, many NGOs, zero data leakage
-- ═══════════════════════════════════════════════════════════════════════════
-- How it works:
--   1. App sets `SET app.current_ngo_id = '<uuid>'` at the start of each request.
--   2. RLS policies filter every SELECT/INSERT/UPDATE/DELETE to that ngo_id only.
--   3. Even if there is a query injection bug, data from other NGOs is invisible.

ALTER TABLE donors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vector_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_registry   ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE breach_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE touchpoints        ENABLE ROW LEVEL SECURITY;

-- Helper function: read ngo_id from session variable
CREATE OR REPLACE FUNCTION current_ngo_id() RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_ngo_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

-- RLS Policies (one per table)
CREATE POLICY ngo_isolate_donors
    ON donors USING (ngo_id = current_ngo_id());

CREATE POLICY ngo_isolate_transactions
    ON transactions USING (ngo_id = current_ngo_id());

CREATE POLICY ngo_isolate_vector_docs
    ON vector_documents USING (ngo_id = current_ngo_id());

CREATE POLICY ngo_isolate_audit_log
    ON agent_audit_log USING (ngo_id = current_ngo_id());

CREATE POLICY ngo_isolate_consent
    ON consent_registry USING (ngo_id = current_ngo_id());

CREATE POLICY ngo_isolate_erasure
    ON data_erasure_requests USING (ngo_id = current_ngo_id());

CREATE POLICY ngo_isolate_breach
    ON breach_log USING (ngo_id = current_ngo_id());

CREATE POLICY ngo_isolate_touchpoints
    ON touchpoints USING (ngo_id = current_ngo_id());

-- ── Seed data: default NGO + demo users ────────────────────────────────────
-- Passwords are demo-only hashes (bcrypt of "demo1234").
INSERT INTO ngos (id, name, slug, pan, fcra_reg, reg_no, state, tier)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'India NGO Trust', 'india-ngo-trust',
    'AABCI1234C', '231650212', 'MH/2015/0012345', 'Maharashtra', 'pro'
) ON CONFLICT DO NOTHING;

INSERT INTO users (id, ngo_id, email, password_hash, full_name, role)
VALUES
    ('00000000-0000-0000-0000-000000000010',
     '00000000-0000-0000-0000-000000000001',
     'admin@indiango.org',
     '$2b$12$demohashedpassword1..........................',
     'Anjali Mehta', 'ed'),
    ('00000000-0000-0000-0000-000000000011',
     '00000000-0000-0000-0000-000000000001',
     'finance@indiango.org',
     '$2b$12$demohashedpassword2..........................',
     'Rajan Sharma', 'finance'),
    ('00000000-0000-0000-0000-000000000012',
     '00000000-0000-0000-0000-000000000001',
     'programs@indiango.org',
     '$2b$12$demohashedpassword3..........................',
     'Priya Nair', 'programs'),
    ('00000000-0000-0000-0000-000000000013',
     '00000000-0000-0000-0000-000000000001',
     'field@indiango.org',
     '$2b$12$demohashedpassword4..........................',
     'Ramesh Kumar', 'field'),
    ('00000000-0000-0000-0000-000000000014',
     '00000000-0000-0000-0000-000000000001',
     'board@indiango.org',
     '$2b$12$demohashedpassword5..........................',
     'Dr. Sunita Rao', 'board')
ON CONFLICT DO NOTHING;

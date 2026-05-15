# GoodJobs QA — Tracks 1–4

Automated coverage map for DPDP, E2E workflows, security, and field degradation.

## Track 1 — DPDP

| Test | Command | Expected |
|------|---------|----------|
| Consent required | `cd backend && pytest tests/test_dpdp_security.py::test_beneficiary_create_without_consent_returns_400 -q` | HTTP 400 `dpdp_consent_required` |
| Consent OK | `pytest tests/test_dpdp_security.py::test_beneficiary_create_with_consent_succeeds -q` | HTTP 200 |
| Erasure | `pytest tests/test_dpdp_security.py::test_erasure_anonymizes_beneficiary_pii_preserves_metrics -q` | PII removed; `anonymized_metrics` kept |
| UI consent highlight | Manual: submit enroll without Section D → red consent box | Frontend `consentHighlight` |

**Data localization (manual):** In Railway → Project → Settings, confirm region **ap-south-1 (Mumbai)** for app and Postgres. Cross-border DB hosting without lawful transfer breaks DPDP transfer rules.

## Track 2 — E2E workflows

Requires Playwright web servers (see `playwright.config.ts`):

```bash
npx playwright test e2e/donation-lifecycle.spec.ts
npx playwright test e2e/fcra-guardrail.spec.ts
npx playwright test e2e/agent-intent.spec.ts
```

| Script | Checks |
|--------|--------|
| `donation-lifecycle.spec.ts` | `POST /public/donations` → donor in CRM, 80G PDF 200 |
| `fcra-guardrail.spec.ts` | `POST /finance/journal-entry` FCRA admin over 20% → 400 |
| `agent-intent.spec.ts` | Intent route → queue → approve → execute |

## Track 3 — Security (OWASP)

| Test | Command |
|------|---------|
| Field → finance UI | `npx playwright test e2e/rbac-ui.spec.ts` |
| Field → finance API | `pytest tests/test_dpdp_security.py::test_field_role_blocked_from_finance_journal_post -q` |
| Tenant isolation | `pytest tests/test_dpdp_security.py::test_tenant_cannot_read_other_ngo_donor -q` |
| Login rate limit | `pytest tests/test_dpdp_security.py::test_login_rate_limit_returns_429 -q` |

## Track 4 — Field degradation

| Test | Command |
|------|---------|
| Offline queue | `npx playwright test e2e/offline-enroll.spec.ts` |
| Hinglish field parse | `pytest tests/test_field_parse.py -q` |

**Fat finger / audio:** Use WhatsApp MIS or `POST /webhook/field-report/parse` with sample slang; fallback parser extracts beneficiary name and ration action without LLM.

## Run all backend security/DPDP tests

```bash
cd backend && pytest tests/test_dpdp_security.py tests/test_field_parse.py -q
```

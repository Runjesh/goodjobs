# Black-box RC day — GoodJobs

One release-candidate session focused on **inputs/outputs only** (no code inspection). Pair with automated suites in CI.

## Prerequisites

- Staging or local: `npm run dev` + `cd backend && PYTHONPATH=. .venv/bin/uvicorn api.main:app --port 8000`
- Demo accounts (`demo1234`): `admin@`, `finance@`, `programs@`, `field@`, `board@` @ `indiango.org`
- One Android Chrome + one iOS Safari device (or BrowserStack) for compatibility

## Automated RC pack (run first)

```bash
npm run test:api    # includes test_fcra_boundaries.py, test_tenant_isolation.py
npm run test:e2e    # includes e2e/blackbox-rc.spec.ts
```

## Session A — FCRA boundaries (decision table)

| Case | FCRA income | Prior admin spend | New admin expense | Expected |
|------|-------------|-------------------|-------------------|----------|
| A1 | ₹10,00,000 | ₹1,99,000 | ₹1,000 | **Allow** (~20.0%) |
| A2 | ₹10,00,000 | ₹2,00,000 | ₹10,000 | **Reject** 400 `fcra_admin_cap_exceeded` |
| A3 | ₹0 (no income rows) | ₹0 | ₹1,00,000 | **Reject** (fallback cap base) |

**How:** Finance → journal entry, fund FCRA, category Administrative, mark admin overhead. Confirm automated: `npm run test:api -- tests/test_fcra_boundaries.py`.

## Session B — Grant closure (state transition)

| State | Checklist complete | `isClosed` in LS | Begin Closure visible | Mark Closed visible |
|-------|-------------------|------------------|----------------------|---------------------|
| B1 Active | 0/6 | false | Yes | No |
| B2 Closing | 6/6 | false | No (back to active optional) | Yes |
| B3 Closed | 6/6 | true | No | No (after reload) |

**How:** `/grants/5` as ED. Automated: `e2e/grant-closure-gate.spec.ts`.

## Session C — Compatibility

| Check | Steps | Pass |
|-------|--------|------|
| C1 Mobile layout | Pixel-width viewport; Today + Programs | No horizontal scroll; nav tappable |
| C2 Hindi UI | Settings language → हिंदी | Sidebar + Today readable, no clipped labels |
| C3 Dark mode | Toggle dark | Finance + Grant readable contrast |
| C4 Intermittent network | Offline → enroll queue → online | Queue drains (see offline E2E) |

**Automated subset:** `npx playwright test e2e/blackbox-rc.spec.ts`

## Session D — Error guessing (30 min)

- Duplicate donor email on import
- `/tasks?focus=deleted-task-id`
- Save grant detail with expired token (clear `access_token` in DevTools)
- Browser **Back** after RBAC denied on `/finance` as field user
- Partial webhook body to `/crm/whatsapp/webhook` (if configured)

## Exit criteria

- No **Critical** defects open
- FCRA B2 and grant B3 verified
- Compatibility C1–C2 verified on at least one real mobile browser
- All P0 automated tests green on `main`

## Traceability

| Technique | Automated | Manual |
|-----------|-----------|--------|
| Boundary value (FCRA) | `test_fcra_boundaries.py` | Session A |
| State transition (closure) | `grant-closure-gate.spec.ts` | Session B |
| Compatibility | `blackbox-rc.spec.ts` | Session C |
| Error guessing | — | Session D |

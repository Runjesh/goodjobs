# GoodJobs — QA test suite (dead ends, resilience, PWA)

This document is the canonical catalog for **negative paths, invalid states, silent failures, and PWA behavior**. It complements happy-path demos by defining **reproducible** cases with steps, expectations, and edge conditions.

**References (external):** [PWA testing — testRigor](https://testrigor.com/blog/what-is-progressive-web-app-testing/), [SaaS testing checklist — QAwerk](https://qawerk.com/blog/saas-testing-checklist/), [Effective test case templates — TestRail](https://www.testrail.com/blog/effective-test-cases-templates/), [PWA testing with Edge — MotoCMS](https://www.motocms.com/blog/en/mastering-progressive-web-app-pwa-testing-with-microsoft-edge-online/)

---

## 1. Test strategy — five layers

Structure work so regressions are caught **at system boundaries**, not only on single screens.

| Layer | Intent |
|--------|--------|
| **Core user journeys** | Auth, inbox, money movement, MIS, CSR, agents — primary revenue/compliance flows |
| **Edge cases** | Validation, races, duplicates, stale data, malformed API payloads, unknown enum values |
| **Role / permission checks** | RBAC on routes, API 403, no flash of restricted data, back-button cache |
| **Offline / PWA** | Shell offline, SW update, install, reconnect, push (if enabled), cross-browser/device |
| **Agent / HITL** | Queue transitions, idempotent execute, audit visibility by role |

Core SaaS QA should repeatedly validate **auth, permissions, data processing, storage, error handling**, and **regression after every update** ([QAwerk](https://qawerk.com/blog/saas-testing-checklist/)).

---

## 2. Critical risk areas (GoodJobs)

Highest impact if they fail silently or mislead the user:

- **Auth + RBAC** — wrong screen visibility, token handling, session revocation
- **Unified Inbox** — actions, focus/deep links, mixed item types
- **Agent queue / HITL** — approve/execute, audit, role-scoped summaries
- **Transactions & fundraising** — double submit, reconciliation, reporting
- **Uploads / storage** — presigned URLs, vault listing, orphaned metadata
- **Offline / sync** — cached shell vs live API; user trust in “saved” state
- **Role-based visibility** — especially **finance**, **compliance**, **agent-hq**

PWA-specific focus: **offline loading**, **reconnect behavior**, **service worker updates**, **install flow**, **push** (when wired), **real Android/iOS** passes ([testRigor](https://testrigor.com/blog/what-is-progressive-web-app-testing/)).

---

## 3. Roles in this codebase

Front-end `UserRole` (`src/context/AuthContext.tsx`): **`ed`**, **`finance`**, **`programs`**, **`field`**, **`board`**.

| ID | Label |
|----|--------|
| `ed` | Executive Director |
| `finance` | Finance Officer |
| `programs` | Program Manager |
| `field` | Field Staff |
| `board` | Board Member |

**Gap to track:** FastAPI uses **`csr`** in some `require_role(...)` and brief/inbox logic; the React `UserRole` union does **not** include `csr`. Add cases that assert **API vs UI parity** once a dedicated CSR login exists, or document that CSR is exercised only via `ed` / `programs` today.

---

## 4. Standard test case template

Use this for **every** case so dead ends are easy to bisect.

| Field | Description |
|--------|-------------|
| **Test ID** | Stable identifier (e.g. `TC-AUTH-001`) |
| **Module** | Product area |
| **User role** | `ed` / `finance` / `programs` / `field` / `board` / Public |
| **Preconditions** | Data, env, feature flags, network |
| **Steps** | Numbered, exact UI/API |
| **Expected result** | Observable pass criteria |
| **Edge / failure condition** | What must not happen; negative paths |
| **Priority** | Critical / High / Medium / Low |
| **Automation candidate** | Yes / No (and suggested layer: unit / API / E2E) |
| **Lane** | **Smoke** (PR/deploy gate) · **Functional** (pre-release workflow) · **Exploratory** (RC / bug bash) |

### Lane definitions

| Lane | When to run | Exit rule |
|------|-------------|-----------|
| **Smoke** | Every PR / deploy | Login, dashboard, core routes — no blocker |
| **Functional** | Daily or before release | Critical user journeys pass |
| **Exploratory** | Release candidate | No critical usability / security / compliance gaps |

### Test case → lane registry

| Test ID | Lane(s) | Automated in repo |
|---------|---------|-------------------|
| TC-AUTH-001 | Smoke, Functional | `e2e/auth-login.spec.ts` |
| TC-AUTH-002 | Smoke, Functional | `e2e/rbac-ui.spec.ts` |
| TC-AUTH-003 | Functional | Manual |
| TC-AUTH-004 | Functional, Exploratory | Manual |
| TC-INBOX-001 | Functional | Partial (`tasks.test.ts`) |
| TC-INBOX-002 | Functional | Manual |
| TC-INBOX-003 | Functional, Exploratory | Manual |
| TC-INBOX-004 | Smoke, Functional | `e2e/tasks-deeplink.spec.ts` |
| TC-INBOX-005 | Functional | Manual |
| TC-FUND-001 | Smoke, Functional | `e2e/donation-lifecycle.spec.ts` |
| TC-FUND-002 | Functional | Manual |
| TC-FUND-003 | Functional | Manual |
| TC-CRM-001 | Functional | Manual |
| TC-CRM-002 | Functional | Manual |
| TC-FIN-001 | Functional | Manual |
| TC-FIN-002 | Functional | Manual |
| TC-COMP-001 | Functional | Manual |
| TC-COMP-002 | Functional | Manual |
| TC-DPDP-001 | Exploratory | `test_dpdp_security.py` (consent) |
| TC-DPDP-002 | Functional | `test_dpdp_security.py` (erasure) |
| TC-MIS-001 | Smoke, Functional | pytest + `e2e/offline-enroll.spec.ts` |
| TC-MIS-002 | Functional | `test_field_parse.py` |
| TC-MIS-003 | Exploratory | Manual |
| TC-VOL-001 | Exploratory | Manual |
| TC-VOL-002 | Functional | Manual |
| TC-CSR-001 | Exploratory | Manual |
| TC-CSR-002 | Functional | Manual |
| TC-RBAC-CSR-API | Functional | Manual |
| TC-AGENT-001 | Smoke, Functional | `e2e/agent-intent.spec.ts`, `e2e/command-bar-agent.spec.ts` |
| TC-AGENT-002 | Functional | Manual |
| TC-AGENT-003 | Exploratory | Manual |
| TC-PWA-001 | Exploratory | Manual |
| TC-PWA-002 | Exploratory | `e2e/offline-enroll.spec.ts` (partial) |
| TC-PWA-003 | Functional, Exploratory | `e2e/offline-enroll.spec.ts` |
| TC-PWA-004 | Exploratory | Manual |
| TC-PWA-005 | Exploratory | Manual |
| TC-A11Y-001 | Exploratory | Manual |
| TC-A11Y-002 | Exploratory | Planned |

**P1 additions (not yet TC-* IDs):** compliance renewal E2E (`e2e/compliance-renewal.spec.ts`), report readiness CTA (`e2e/report-readiness.spec.ts`), tenant isolation (`test_tenant_isolation.py`), FCRA boundaries (`test_fcra_boundaries.py`), black-box RC (`e2e/blackbox-rc.spec.ts`, `docs/qa/BLACKBOX_RC_DAY.md`).

**CI:** PR → Smoke (`.github/workflows/qa-regression.yml`); `main` nightly → `npm run test:all`.

---

## 5. Test cases — Auth and access

### TC-AUTH-001 — Login success

| Field | Value |
|--------|--------|
| **Module** | Auth |
| **User role** | Any |
| **Preconditions** | Valid user exists; API reachable |
| **Steps** | 1. Open login. 2. Enter valid email/password (or demo quick-access). 3. Submit. |
| **Expected result** | Session established; user lands on app shell; `/auth/me` (or equivalent) returns correct `role`, `ngoId`; navigation matches `ROLE_PERMISSIONS`. |
| **Edge / failure** | Invalid credentials show error, no partial auth state; no infinite spinner. |
| **Priority** | Critical |
| **Automation candidate** | Yes (E2E + API) |

### TC-AUTH-002 — RBAC direct URL

| Field | Value |
|--------|--------|
| **Module** | RBAC |
| **User role** | `field` |
| **Preconditions** | Logged in as field |
| **Steps** | 1. Manually navigate to `/finance`, `/compliance`, `/agent-hq` (and other restricted routes). |
| **Expected result** | Access denied UX or redirect; **no** sensitive rows/metrics rendered (including brief flash). |
| **Edge / failure** | **Back** after denied must not reveal cached restricted page from bfcache without re-check; hard refresh on restricted URL behaves consistently. |
| **Priority** | Critical |
| **Automation candidate** | Yes (E2E per role) |

### TC-AUTH-003 — Session revoke other devices

| Field | Value |
|--------|--------|
| **Module** | Sessions |
| **User role** | `ed` |
| **Preconditions** | Same user logged in on device A and B |
| **Steps** | 1. On A, call `POST /auth/sessions/revoke-other` (or UI equivalent). 2. On B, perform any authenticated action. |
| **Expected result** | A stays logged in; B forced to re-auth; no spurious logout on A. |
| **Edge / failure** | In-flight requests on B fail clearly, not “success” toast. |
| **Priority** | High |
| **Automation candidate** | Yes (API + two contexts) |

### TC-AUTH-004 — Expired token mid-session

| Field | Value |
|--------|--------|
| **Module** | Auth |
| **User role** | Any |
| **Preconditions** | Access token expired (simulate or wait) |
| **Steps** | 1. Trigger API call (save, list refresh). |
| **Expected result** | Redirect to login or refresh flow; **no** silent drop of request; user informed. |
| **Edge / failure** | Align with **TC-DEAD-006** (unsaved work). |
| **Priority** | Critical |
| **Automation candidate** | Partial (API mock) |

---

## 6. Test cases — Unified Inbox (`/tasks`)

### TC-INBOX-001 — Mixed item types render

| Field | Value |
|--------|--------|
| **Module** | Unified Inbox |
| **User role** | `ed` |
| **Preconditions** | Inbox seeded with multiple `kind` values |
| **Steps** | 1. Open `/tasks`. 2. Scroll list. 3. Expand/act on one item per type. |
| **Expected result** | Labels, due states, and actions match backend; no console errors. |
| **Edge / failure** | Unknown `kind`: fallback card, **no** white screen. |
| **Priority** | Critical |
| **Automation candidate** | Yes (E2E with fixture API) |

### TC-INBOX-002 — Snooze 24h

| Field | Value |
|--------|--------|
| **Module** | Unified Inbox |
| **User role** | `finance` |
| **Preconditions** | Snoozeable finance item exists |
| **Steps** | 1. Snooze 24h. 2. Refresh. 3. Advance clock or wait. |
| **Expected result** | Item leaves active list; persists; returns after snooze window. |
| **Edge / failure** | Timezone / `date_label` consistency across devices. |
| **Priority** | High |
| **Automation candidate** | Yes |

### TC-INBOX-003 — Double resolve

| Field | Value |
|--------|--------|
| **Module** | Unified Inbox |
| **User role** | `programs` |
| **Preconditions** | Item resolved on device B |
| **Steps** | 1. On device A (stale list), attempt resolve same item. |
| **Expected result** | “Already resolved” or idempotent success; **no** duplicate side effects. |
| **Edge / failure** | Optimistic UI rolls back on 409/422 with clear copy. |
| **Priority** | High |
| **Automation candidate** | Yes (API contract) |

### TC-INBOX-004 — Notification deep link to focus

| Field | Value |
|--------|--------|
| **Module** | Unified Inbox / Notifications |
| **User role** | Any |
| **Preconditions** | Notification payload includes `tasks_path` or parseable id → `kind:refId` |
| **Steps** | 1. Open notification center. 2. Click item that navigates to tasks. |
| **Expected result** | Lands on `/tasks` with correct `focus` query; target row visible or empty state explains missing ref. |
| **Edge / failure** | Malformed `focus` does not crash; invalid ref shows not-found within list UX. |
| **Priority** | High |
| **Automation candidate** | Yes |

### TC-INBOX-005 — Morning brief deep link

| Field | Value |
|--------|--------|
| **Module** | Dashboard / Morning brief |
| **User role** | Any |
| **Preconditions** | Brief API returns `tasks_deep_link_path` |
| **Steps** | 1. Open brief CTA linking to tasks. |
| **Expected result** | Same guarantees as TC-INBOX-004. |
| **Edge / failure** | Missing `APP_PUBLIC_URL` / path still yields relative navigation in-app. |
| **Priority** | Medium |
| **Automation candidate** | Yes |

---

## 7. Test cases — Fundraising and transactions

### TC-FUND-001 — Public donation

| Field | Value |
|--------|--------|
| **Module** | Public donations |
| **User role** | Public |
| **Preconditions** | Campaign exists; page `/public/donations` (or actual public route) live |
| **Steps** | 1. Submit valid donation. |
| **Expected result** | Transaction created; confirmation shows id; downstream nurture/agent hooks if configured. |
| **Edge / failure** | Double-click / double-submit: **one** persisted row if idempotency key enforced. |
| **Priority** | Critical |
| **Automation candidate** | Yes |

### TC-FUND-002 — Campaign validation

| Field | Value |
|--------|--------|
| **Module** | Campaign creation |
| **User role** | `ed` |
| **Preconditions** | Logged in |
| **Steps** | 1. Open create campaign. 2. Try blank title, negative goal, extremely long title. |
| **Expected result** | Inline validation; modal remains usable; dismiss and reopen clean. |
| **Edge / failure** | No stuck “loading” with no error. |
| **Priority** | High |
| **Automation candidate** | Yes |

### TC-FUND-003 — Finance transaction create

| Field | Value |
|--------|--------|
| **Module** | Finance transactions |
| **User role** | `finance` |
| **Preconditions** | Logged in |
| **Steps** | 1. Create transaction with valid payload. 2. Immediately refresh list. |
| **Expected result** | Row visible; dashboard aggregates consistent where designed. |
| **Edge / failure** | Network fail: no “success” without 2xx. |
| **Priority** | Critical |
| **Automation candidate** | Yes |

---

## 8. Test cases — CRM

### TC-CRM-001 — Donor import CSV

| Field | Value |
|--------|--------|
| **Module** | Donor import |
| **User role** | `ed` |
| **Preconditions** | CSV with valid + invalid rows |
| **Steps** | 1. Import. 2. Review summary. |
| **Expected result** | Valid rows imported; invalid reported with row refs; partial success explicit. |
| **Edge / failure** | Duplicates: merge/dedupe rules documented and tested. |
| **Priority** | Critical |
| **Automation candidate** | Yes (API + file upload) |

### TC-CRM-002 — Outreach modes

| Field | Value |
|--------|--------|
| **Module** | Outreach |
| **User role** | `ed` |
| **Preconditions** | Donor exists |
| **Steps** | 1. `draft`. 2. `send`. 3. `voice_event` (if implemented). |
| **Expected result** | State machine correct; audit/event where required. |
| **Edge / failure** | API 5xx: UI must not show “sent”. |
| **Priority** | High |
| **Automation candidate** | Partial |

---

## 9. Test cases — Finance and compliance

### TC-FIN-001 — Journal entry validation

| Field | Value |
|--------|--------|
| **Module** | Journal entry |
| **User role** | `finance` |
| **Preconditions** | Logged in |
| **Steps** | 1. Submit valid entry. 2. Submit with missing classification. |
| **Expected result** | Valid persisted; invalid blocked with clear message. |
| **Edge / failure** | No partial DB row. |
| **Priority** | Critical |
| **Automation candidate** | Yes |

### TC-FIN-002 — Utilization certificate PDF

| Field | Value |
|--------|--------|
| **Module** | UC PDF |
| **User role** | `finance` |
| **Preconditions** | Grant data present |
| **Steps** | 1. Request `/finance/uc.pdf` (or UI export). |
| **Expected result** | Valid PDF; correct NGO/grant fields. |
| **Edge / failure** | Missing data: JSON/HTML error, **not** corrupt download. |
| **Priority** | High |
| **Automation candidate** | Yes (API) |

### TC-COMP-001 — Vault upload presign

| Field | Value |
|--------|--------|
| **Module** | Compliance documents |
| **User role** | `finance` |
| **Preconditions** | S3-compatible storage configured |
| **Steps** | 1. Request presign. 2. PUT file. 3. Confirm list + download. |
| **Expected result** | End-to-end visible in vault. |
| **Edge / failure** | Expired URL: user can request fresh URL; no dead-end spinner. |
| **Priority** | Critical |
| **Automation candidate** | Partial (mock S3) |

### TC-COMP-002 — Filing package

| Field | Value |
|--------|--------|
| **Module** | Filings |
| **User role** | `ed` |
| **Preconditions** | Filing exists |
| **Steps** | 1. Open PDF/package. |
| **Expected result** | Opens or downloads. |
| **Edge / failure** | Deleted id: dedicated empty/error state, not blank canvas. |
| **Priority** | High |
| **Automation candidate** | Yes |

### TC-DPDP-001 — Consent registry stress

| Field | Value |
|--------|--------|
| **Module** | DPDP / Compliance |
| **User role** | `finance` or `ed` |
| **Preconditions** | Large consent list |
| **Steps** | 1. Open DPDP tab. 2. Scroll rapidly. 3. Filter/search if present. |
| **Expected result** | Virtualized list stable; no jank that hides actions; empty state has next step. |
| **Edge / failure** | Zero rows: helpful copy + CTA. |
| **Priority** | High |
| **Automation candidate** | Partial (render perf manual) |

### TC-DPDP-002 — Erasure / breach logs

| Field | Value |
|--------|--------|
| **Module** | DPDP |
| **User role** | `finance` |
| **Preconditions** | Sample erasure and breach rows |
| **Steps** | 1. Open each sub-tab. 2. Trigger add/export if any. |
| **Expected result** | Actions match backend; errors surfaced. |
| **Edge / failure** | Concurrent edit: no silent overwrite message. |
| **Priority** | High |
| **Automation candidate** | Partial |

---

## 10. Test cases — Programs MIS

### TC-MIS-001 — Beneficiary enroll

| Field | Value |
|--------|--------|
| **Module** | Beneficiary enrollment |
| **User role** | `field` |
| **Preconditions** | Logged in |
| **Steps** | 1. Submit full valid enrollment. |
| **Expected result** | Record visible in beneficiary list. |
| **Edge / failure** | Poor network double-tap: no duplicate beneficiary (idempotency or UI guard). |
| **Priority** | Critical |
| **Automation candidate** | Yes |

### TC-MIS-002 — Field report / agent webhook

| Field | Value |
|--------|--------|
| **Module** | Field report |
| **User role** | `field` |
| **Preconditions** | Agent endpoint available |
| **Steps** | 1. Submit conversational report. |
| **Expected result** | Confirmation + pending/processing state. |
| **Edge / failure** | Backend down: queued/local draft or explicit failure; **no** fake success. |
| **Priority** | Critical |
| **Automation candidate** | Partial |

### TC-MIS-003 — Form builder localStorage

| Field | Value |
|--------|--------|
| **Module** | Form builder |
| **User role** | `programs` |
| **Preconditions** | Saved form in `localStorage` |
| **Steps** | 1. Edit. 2. Refresh. |
| **Expected result** | Latest version loads. |
| **Edge / failure** | Corrupt JSON: recoverable reset path, no crash loop. |
| **Priority** | High |
| **Automation candidate** | Yes (unit) |

---

## 11. Test cases — Volunteers

### TC-VOL-001 — Last spot race

| Field | Value |
|--------|--------|
| **Module** | Shift signup |
| **User role** | `programs` (coordinator) / end volunteer UX as designed |
| **Preconditions** | Shift with 1 seat left |
| **Steps** | 1. Two users submit signup concurrently. |
| **Expected result** | One confirmed; second sees full/waitlist; DB integrity. |
| **Edge / failure** | UI refresh shows server truth. |
| **Priority** | Critical |
| **Automation candidate** | Partial (load test / API) |

### TC-VOL-002 — Broadcast / reminder

| Field | Value |
|--------|--------|
| **Module** | Volunteer comms |
| **User role** | `programs` |
| **Preconditions** | Roster exists |
| **Steps** | 1. Trigger reminder. 2. Double-click trigger. |
| **Expected result** | One logical event; inbox/notifications consistent. |
| **Edge / failure** | Idempotent server-side or UI debounce. |
| **Priority** | High |
| **Automation candidate** | Partial |

---

## 12. Test cases — CSR pipeline

### TC-CSR-001 — Rapid card moves

| Field | Value |
|--------|--------|
| **Module** | CSR kanban |
| **User role** | `ed` or `programs` |
| **Preconditions** | Card exists |
| **Steps** | 1. Drag across stages quickly (multi-step). |
| **Expected result** | Final stage matches server; history/audit coherent. |
| **Edge / failure** | Intermittent 4xx/5xx: UI reconciles or shows error; **no** silent desync. |
| **Priority** | Critical |
| **Automation candidate** | Partial (DnD flaky in CI) |

### TC-CSR-002 — Document room lifecycle

| Field | Value |
|--------|--------|
| **Module** | CSR documents |
| **User role** | `ed` |
| **Preconditions** | Card exists |
| **Steps** | 1. Upload. 2. List. 3. Download. 4. Delete. |
| **Expected result** | Full lifecycle works. |
| **Edge / failure** | After delete: no orphan link in UI. |
| **Priority** | High |
| **Automation candidate** | Yes |

### TC-RBAC-CSR-API — Backend `csr` role parity

| Field | Value |
|--------|--------|
| **Module** | RBAC / CSR API |
| **User role** | N/A (API token with `csr` if exists) |
| **Preconditions** | Document whether `csr` users are production reality |
| **Steps** | 1. Authenticate as `csr`. 2. Hit CSR list/create endpoints. 3. Compare with `programs`/`ed`. |
| **Expected result** | Documented matrix; UI login story matches API. |
| **Edge / failure** | If no `csr` login in UI, API-only `csr` must be supported knowingly or removed. |
| **Priority** | Medium |
| **Automation candidate** | Yes (API) |

---

## 13. Test cases — Agent HQ and HITL

### TC-AGENT-001 — Approve then execute

| Field | Value |
|--------|--------|
| **Module** | Intent queue |
| **User role** | `ed` |
| **Preconditions** | Queued item |
| **Steps** | 1. Approve. 2. Execute. |
| **Expected result** | Status transitions; audit entry. |
| **Edge / failure** | Second execute: safe no-op or clear error. |
| **Priority** | Critical |
| **Automation candidate** | Yes |

### TC-AGENT-002 — Board visibility

| Field | Value |
|--------|--------|
| **Module** | Agent HQ summary |
| **User role** | `board` |
| **Preconditions** | Agent events exist |
| **Steps** | 1. Open summary and audit feed. |
| **Expected result** | Only permitted fields; no PII/finance leakage. |
| **Edge / failure** | Direct API with board token same constraints. |
| **Priority** | Critical |
| **Automation candidate** | Yes (API) |

### TC-AGENT-003 — Malformed `/intent/process`

| Field | Value |
|--------|--------|
| **Module** | Intent processing |
| **User role** | `ed` |
| **Preconditions** | Valid session |
| **Steps** | 1. Submit empty, malformed, ambiguous directive bodies. |
| **Expected result** | 4xx with message or clarification flow; **no** 500 loop. |
| **Edge / failure** | Logged server-side without exposing stack to client. |
| **Priority** | High |
| **Automation candidate** | Yes (API) |

---

## 14. Test cases — PWA and offline

### TC-PWA-001 — Installability

| Field | Value |
|--------|--------|
| **Module** | Installability |
| **User role** | Any |
| **Preconditions** | HTTPS; manifest + SW from build (`vite-plugin-pwa`) |
| **Steps** | 1. Open on Android Chrome. 2. Add to Home Screen / install prompt. 3. Launch standalone. |
| **Expected result** | Correct **name**, **icons**, **start URL**; opens app shell. |
| **Edge / failure** | iOS Safari limitations documented (install UX differs). |
| **Priority** | High |
| **Automation candidate** | Partial (manual device) |

### TC-PWA-002 — Offline shell

| Field | Value |
|--------|--------|
| **Module** | Offline mode |
| **User role** | `field` |
| **Preconditions** | App loaded at least once |
| **Steps** | 1. Disable network. 2. Kill app / reopen PWA. 3. Navigate cached vs uncached route. |
| **Expected result** | Shell loads; offline messaging; uncached route shows fallback (Workbox offline page or app pattern). |
| **Edge / failure** | No infinite loading with no explanation. |
| **Priority** | Critical |
| **Automation candidate** | Yes (Playwright offline) |

### TC-PWA-003 — Reconnect after offline edits

| Field | Value |
|--------|--------|
| **Module** | Offline sync |
| **User role** | `field` |
| **Preconditions** | Document whether app queues writes (if not, case becomes “must block writes offline”) |
| **Steps** | 1. Offline. 2. Attempt create beneficiary (or any write). 3. Online. |
| **Expected result** | If queue exists: sync once, no dupes; conflicts surfaced. If **no** queue: UI must **block** or warn, not toast success. |
| **Edge / failure** | Server changed meanwhile: conflict UI. |
| **Priority** | Critical |
| **Automation candidate** | Partial |

### TC-PWA-004 — Service worker update

| Field | Value |
|--------|--------|
| **Module** | Service worker |
| **User role** | Any |
| **Preconditions** | Two deployments (old + new precache) |
| **Steps** | 1. Load old. 2. Deploy new. 3. Revisit / refresh until new SW activates. |
| **Expected result** | `virtual:pwa-register` behavior: prompt or smooth reload; no broken API/JS mismatch. |
| **Edge / failure** | Long-lived tab: user informed before stale bundle calls new API. |
| **Priority** | High |
| **Automation candidate** | Partial |

### TC-PWA-005 — Push (if enabled)

| Field | Value |
|--------|--------|
| **Module** | Push |
| **User role** | Any |
| **Preconditions** | VAPID / push wired |
| **Steps** | 1. Subscribe. 2. Send test push. 3. Tap notification. |
| **Expected result** | Deep link opens correct screen; focus params applied. |
| **Edge / failure** | Permission denied: graceful degradation. |
| **Priority** | Medium |
| **Automation candidate** | No (mostly manual) |

---

## 15. Dead-end and resilience suite

| ID | Theme | Steps (summary) | Expected | Edge / failure | Priority | Auto? |
|----|--------|-----------------|----------|----------------|----------|-------|
| **TC-DEAD-001** | Empty states | Visit every list with zero rows | Each empty state has **next action** or honest explanation | No static dead end | High | Partial |
| **TC-DEAD-002** | Errors | Force 404/500/API error routes | Retry + home/inbox escape hatch | No blank screen | Critical | Yes |
| **TC-DEAD-003** | Modals | Open modals | Close via button, **Esc**, backdrop; mobile gestures where applicable | Focus trap not permanent | High | Partial |
| **TC-DEAD-004** | Refresh | Hard refresh on deep links `/tasks?focus=...`, `/finance`, etc. | Valid state restored or safe landing | No auth shell stuck | Critical | Yes |
| **TC-DEAD-005** | Back button | Detail → back from deep link | No navigation loop | bfcache respects auth | High | Partial |
| **TC-DEAD-006** | Expired JWT on save | Edit form, expire token, save | Login path + **unsaved work** policy documented (draft/local or warn) | No silent loss | Critical | Partial |
| **TC-DEAD-007** | Backend down | Stop API during write | User sees failure; **no** fake success | Toasts match HTTP | Critical | Yes (mock) |
| **TC-DEAD-008** | Missing resource | Open deleted donor/grant/card id | “Not found” pattern | Not empty layout | High | Yes |

---

## 16. Accessibility and motion

### TC-A11Y-001 — Reduced motion

| Field | Value |
|--------|--------|
| **Module** | Global UX |
| **User role** | Any |
| **Preconditions** | OS “reduce motion” on |
| **Steps** | 1. Navigate pages with route transitions and list stagger. |
| **Expected result** | Essential motion only per `prefers-reduced-motion` CSS. |
| **Edge / failure** | No seizure-inducing animation. |
| **Priority** | Medium |
| **Automation candidate** | Partial |

### TC-A11Y-002 — axe smoke

| Field | Value |
|--------|--------|
| **Module** | Accessibility |
| **User role** | Any |
| **Preconditions** | CI runs `@axe-core/playwright` or RTL + axe |
| **Steps** | 1. Run on Dashboard, Tasks, Login. |
| **Expected result** | Zero critical violations (policy TBD). |
| **Edge / failure** | Document known false positives. |
| **Priority** | Medium |
| **Automation candidate** | Yes |

---

## 17. Automation priority (first wave)

Automate first ([MotoCMS PWA regression thinking](https://www.motocms.com/blog/en/mastering-progressive-web-app-pwa-testing-with-microsoft-edge-online/)):

1. Login + **RBAC** route matrix  
2. **Inbox** actions + **deep links**  
3. **Transaction** create/list  
4. **Donor import**  
5. **Beneficiary** create  
6. **CSR** card move (smoke, not every DnD edge)  
7. **Agent** approve/execute  
8. **Upload** presign happy path  
9. **Offline** shell + API failure mocks  
10. **Installability** smoke (manual device matrix alongside CI)

---

## 18. Recommended tooling (this stack)

| Layer | Tool |
|--------|------|
| Unit / component | Vitest + React Testing Library |
| E2E | Playwright (network offline, multi-context) |
| API | Pytest + httpx (FastAPI) |
| PWA / device | Playwright + **real** Android/iPhone passes |
| A11y | axe-core in CI |

### Automated runs (implemented in repo)

From repository root:

| Command | What it runs |
|--------|----------------|
| `npm run test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run test:e2e` | Playwright (`e2e/`) — starts Vite + FastAPI via `playwright.config.ts` |
| `npm run setup:api-venv` | One-time: `backend/.venv` + `pip install -r requirements.txt` |
| `npm run test:api` | Pytest in `backend/tests/` (uses `backend/.venv/bin/python`) |
| `npm run test:all` | Vitest + pytest + Playwright (CI-friendly full pass) |

**First-time setup:** `npm install`, `npx playwright install chromium`, `npm run setup:api-venv`.

**CI tip:** set `CI=1` so Playwright does not reuse already-running dev servers. **Local tip:** Vite must be reachable at `http://localhost:5173` (not only `127.0.0.1`) so the dev-server readiness check can pass.

---

## 19. Bug bash checklist by module (quick pass)

Use after each release candidate; tick + note build SHA.

- [ ] **Login / register** — errors, demo accounts, role select  
- [ ] **Dashboard** — morning brief, activity log modal scroll, stats load fail  
- [ ] **Tasks** — focus query, notification links, snooze/resolve  
- [ ] **Fundraising** — campaigns, validation, public donate  
- [ ] **CRM** — import, donor detail, outreach  
- [ ] **Finance** — exceptions, grants grid, UC PDF, journal validation  
- [ ] **Programs** — beneficiaries virtual list, forms  
- [ ] **CSR** — DnD, documents  
- [ ] **Volunteers** — shifts, roster  
- [ ] **Compliance** — vault upload/download, DPDP tabs  
- [ ] **Agent HQ** — queue, board read-only  
- [ ] **Settings** — session, preferences  
- [ ] **PWA** — offline, update, install on one Android + one iOS device  

---

## 20. Export to spreadsheet

To mirror TestRail columns, import this doc’s tables or generate CSV with columns:

`Test ID, Module, User role, Preconditions, Steps, Expected result, Edge/failure, Priority, Automation candidate`

---

*Document version: 1.0 — aligned with GoodJobs repo roles and PWA (Vite + vite-plugin-pwa). Update when new roles or offline sync semantics ship.*

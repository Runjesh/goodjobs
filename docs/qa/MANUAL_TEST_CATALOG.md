# GoodJobs — manual & regression test catalog

**515** checklist items in **21** areas. Cross-reference: [GOODJOBS_TEST_SUITE.md](./GOODJOBS_TEST_SUITE.md) (lanes, risk areas), [TESTING_TRACKS_1-4.md](./TESTING_TRACKS_1-4.md) (automated commands), [INTEGRATIONS_STATUS.md](../INTEGRATIONS_STATUS.md) (mock vs live).

For TestRail / Sheets import, use the companion **`MANUAL_TEST_CATALOG.tsv`** (same folder): columns `section_num`, `section_title`, `test_id`, `description`.

---

## 1. Auth, roles, onboarding

- AUTH-001 Login with valid ED credentials.
- AUTH-002 Login with valid Finance credentials.
- AUTH-003 Login with valid Programs credentials.
- AUTH-004 Login with valid Field credentials.
- AUTH-005 Login with valid Board credentials.
- AUTH-006 Login with invalid password returns error.
- AUTH-007 Login with unknown email returns error.
- AUTH-008 Login with empty email shows validation.
- AUTH-009 Login with empty password shows validation.
- AUTH-010 Login with malformed email shows validation.
- AUTH-011 Login button disabled while request is in progress.
- AUTH-012 Multiple rapid login attempts trigger rate limit.
- AUTH-013 Rate-limited login shows correct retry message.
- AUTH-014 Successful login stores session and redirects to correct landing page.
- AUTH-015 Refresh browser keeps active session.
- AUTH-016 Expired token redirects to login.
- AUTH-017 Revoked session logs user out on next protected action.
- AUTH-018 Logout clears session and returns to login page.
- AUTH-019 Browser back button after logout does not reveal protected screen.
- AUTH-020 Protected route without login redirects to login.
- AUTH-021 Direct URL to protected route after login works for authorized role.
- AUTH-022 Direct URL to protected route for unauthorized role shows Access Restricted.
- AUTH-023 Access Restricted page shows module-specific copy.
- AUTH-024 Unauthorized route does not flash protected data before denial.
- AUTH-025 Demo login for each demo user works.
- AUTH-026 Demo login skips onboarding wizard.
- AUTH-027 New signup creates account successfully.
- AUTH-028 Signup with existing email is rejected.
- AUTH-029 Signup with weak password is rejected.
- AUTH-030 Signup password confirmation mismatch is rejected.
- AUTH-031 Signup with missing required fields is rejected.
- AUTH-032 Successful signup redirects to onboarding wizard.
- AUTH-033 Onboarding wizard persists step progress on refresh.
- AUTH-034 Onboarding wizard resumes after logout/login.
- AUTH-035 Completing wizard sets needsWizard=false.
- AUTH-036 Role-based welcome modal appears on first run only.
- AUTH-037 Dismissing welcome modal stores state correctly.
- AUTH-038 Welcome modal does not reappear once acknowledged.
- AUTH-039 Trial start date is set correctly for new org.
- AUTH-040 Trial countdown shows correct remaining days.
- AUTH-041 Upgrade prompt appears during trial as expected.
- AUTH-042 Past-due state shows correct billing restriction prompt.
- AUTH-043 Starter to Growth mock checkout succeeds.
- AUTH-044 Billing state updates after successful upgrade.
- AUTH-045 User cannot bypass role restrictions by editing frontend state.
- AUTH-046 Role permissions update correctly after admin role change.
- AUTH-047 Session persists across page reloads but not across logout.
- AUTH-048 Concurrent sessions on two browsers behave correctly after revoke.

## 2. Today dashboard

- DASH-001 Dashboard loads without blank screen for ED.
- DASH-002 Dashboard loads without blank screen for Finance.
- DASH-003 Dashboard loads without blank screen for Programs.
- DASH-004 Dashboard loads without blank screen for Field.
- DASH-005 Dashboard loads without blank screen for Board.
- DASH-006 Role-aware widgets are different by role.
- DASH-007 Greeting changes by time of day.
- DASH-008 Morning brief is visible when data exists.
- DASH-009 Morning brief empty state is handled gracefully.
- DASH-010 Morning brief refreshes after cron/manual trigger.
- DASH-011 Priority actions link to correct deep destination.
- DASH-012 Compliance renewal nudge appears for at-risk documents.
- DASH-013 Compliance renewal nudge opens exact renewal workspace.
- DASH-014 Donor impact snippet renders when CRM data exists.
- DASH-015 Donor impact snippet hidden or empty-state when no CRM data exists.
- DASH-016 Global refresh updates dashboard after donation creation.
- DASH-017 Global refresh updates dashboard after compliance update.
- DASH-018 Global refresh updates dashboard after beneficiary enrollment.
- DASH-019 Notification bell shows unread count correctly.
- DASH-020 Notification dismiss removes item from list.
- DASH-021 Notification snooze hides item for selected duration.
- DASH-022 Snoozed notification returns after snooze expiry.
- DASH-023 Command bar opens from header.
- DASH-024 Command bar accepts free-text intention.
- DASH-025 Dashboard widgets do not expose unauthorized data.
- DASH-026 Dashboard handles slow API with skeleton/loading state.
- DASH-027 Dashboard handles API failure with retry state.

## 3. Unified inbox /tasks

- TASK-001 Tasks page loads normally.
- TASK-002 Tasks page loads with mixed task types.
- TASK-003 Deep link /tasks?focus=id opens correct task.
- TASK-004 Invalid focus id does not white-screen.
- TASK-005 Completing a manual task updates status.
- TASK-006 Completing an agent task updates status.
- TASK-007 Completing a compliance task advances related workflow.
- TASK-008 Completing a grant task updates grant workflow.
- TASK-009 Snoozing task for 24h works.
- TASK-010 Dismissing task removes it from active queue.
- TASK-011 Entity link from task opens correct grant.
- TASK-012 Entity link from task opens correct donor.
- TASK-013 Entity link from task opens correct compliance document.
- TASK-014 Task list preserves filters after refresh.
- TASK-015 Task sorting behaves correctly.
- TASK-016 Task state updates are reflected in dashboard counts.
- TASK-017 Unauthorized user cannot open task linked to restricted entity.
- TASK-018 Deleted linked entity does not break task rendering.
- TASK-019 Task completion works under slow network.
- TASK-020 Duplicate task prevention works for same event trigger.

## 4. Programs and beneficiaries

- PROG-001 Beneficiary roster loads existing data.
- PROG-002 Beneficiary search returns correct matches.
- PROG-003 Beneficiary filters by program work.
- PROG-004 Beneficiary filters by location work.
- PROG-005 Beneficiary filters by status work.
- PROG-006 Create beneficiary with all required fields succeeds.
- PROG-007 Create beneficiary without DPDP consent is rejected.
- PROG-008 Create beneficiary with DPDP consent succeeds.
- PROG-009 Consent section highlights correctly on validation failure.
- PROG-010 Consent text/version is stored correctly.
- PROG-011 Duplicate beneficiary detection works if enabled.
- PROG-012 Enroll modal remains open and shows success state after create.
- PROG-013 Closing success modal does not create duplicate record.
- PROG-014 Edit beneficiary updates record correctly.
- PROG-015 Delete/archive beneficiary behaves correctly.
- PROG-016 Family size boundary values are validated.
- PROG-017 Invalid age/date of birth is rejected.
- PROG-018 Missing mandatory fields are rejected.
- PROG-019 Long text inputs are handled safely.
- PROG-020 Special characters in names are saved correctly.
- PROG-021 Offline enrollment queues entry in IndexedDB.
- PROG-022 Multiple offline enrollments queue correctly.
- PROG-023 Queued offline entries sync when app comes online.
- PROG-024 Sync conflict handling works if record changed on server.
- PROG-025 Failed sync shows retry state.
- PROG-026 Programs page syncs queued entries on mount.
- PROG-027 Theory of Change builder saves locally.
- PROG-028 Theory of Change builder restores saved draft.
- PROG-029 Program linked to grant shows correct rollups.
- PROG-030 Beneficiary counts roll up correctly into grant detail.
- PROG-031 Outcome counts roll up correctly into grant detail.
- PROG-032 Hinglish field note parse returns structured response.
- PROG-033 Slang/abbreviated field note parse still works.
- PROG-034 Empty field note parse is rejected.
- PROG-035 Unsupported media/input format is rejected gracefully.
- PROG-036 DPDP erasure anonymizes beneficiary PII.
- PROG-037 DPDP erasure preserves anonymized metrics.
- PROG-038 Erased beneficiary no longer appears with original identity.
- PROG-039 Field role can access only allowed program actions.
- PROG-040 Unauthorized role cannot edit restricted program data.

## 5. Funding workspace

- FUND-001 Funding workspace loads grant summary cards.
- FUND-002 Funding workspace shows overview metrics accurately.
- FUND-003 Clicking live grant opens correct grant detail page.
- FUND-004 Clicking CSR board opens CSR pipeline.
- FUND-005 Finance tags/links from funding workspace navigate correctly.
- FUND-006 Field role is denied access to funding workspace.
- FUND-007 Board role sees permitted read-only funding view if intended.
- FUND-008 Empty funding workspace shows appropriate empty state.
- FUND-009 Funding workspace handles large grant list without UI breakage.

## 6. CSR pipeline and grant detail

- CSR-001 CSR board loads all expected columns.
- CSR-002 Prospecting card creation succeeds.
- CSR-003 Card edit updates title, company, amount, and metadata.
- CSR-004 Card delete/archive behaves correctly.
- CSR-005 Dragging card between columns updates state.
- CSR-006 Card position persists after reload.
- CSR-007 Invalid stage transition is prevented if rules exist.
- CSR-008 Stage move creates expected workflow tasks.
- CSR-009 Moving card to live creates live grant bundle.
- CSR-010 Presigned document upload from CSR card succeeds.
- CSR-011 Unsupported document type is rejected.
- CSR-012 Oversized document upload is rejected.
- CSR-013 Expired presigned upload URL shows retry flow.
- CSR-014 Grant detail page loads without crash.
- CSR-015 Grant detail renders stage stepper correctly.
- CSR-016 Grant parser preview renders extracted rows.
- CSR-017 Approving parser rows merges into grant state.
- CSR-018 Rejecting parser rows leaves existing data unchanged.
- CSR-019 Local storage cache restores latest grant state.
- CSR-020 Server state overrides stale local cache appropriately.
- CSR-021 Deliverables tab loads and saves correctly.
- CSR-022 Budget tab loads and saves correctly.
- CSR-023 Reports tab loads and saves correctly.
- CSR-024 Grant health strip shows budget utilization accurately.
- CSR-025 Grant health strip shows report due status accurately.
- CSR-026 Grant health strip shows compliance status accurately.
- CSR-027 Grant health strip shows beneficiary count accurately.
- CSR-028 Grant health strip shows outcomes accurately.
- CSR-029 Budget head creation succeeds.
- CSR-030 Budget head edit succeeds.
- CSR-031 Budget head delete behaves safely when used by transactions.
- CSR-032 Tranche release is allowed when utilization threshold met.
- CSR-033 Tranche release is blocked when utilization threshold not met.
- CSR-034 Program linked to grant appears in programs panel.
- CSR-035 Unlinking program updates grant rollups correctly.
- CSR-036 Grant-scoped task creation succeeds.
- CSR-037 Grant-scoped task completion updates grant screen correctly.
- CSR-038 Begin Closure starts closure workflow.
- CSR-039 Close button hidden before closure starts.
- CSR-040 Close button disabled until all 6 checklist items complete.
- CSR-041 Checklist item 2 is disabled until item 1 if ordered logic exists.
- CSR-042 Partial checklist does not allow closure.
- CSR-043 Column move to closed alone does not close grant.
- CSR-044 Completing all 6 closure items enables Mark Closed.
- CSR-045 Mark Closed persists after reload.
- CSR-046 Closed grant state persists across sessions.
- CSR-047 Closed grant cannot be edited if lock rules exist.
- CSR-048 Multi-tab editing does not corrupt grant state.
- CSR-049 Unauthorized role cannot edit grant data.
- CSR-050 Read-only roles can view but not mutate grant details.

## 7. Finance

- FIN-001 Finance page loads for finance user.
- FIN-002 Finance page is blocked for field user.
- FIN-003 Create expense journal entry succeeds.
- FIN-004 Create income journal entry succeeds.
- FIN-005 Required field validation works on journal entry.
- FIN-006 Invalid date validation works.
- FIN-007 Negative amount validation behaves correctly.
- FIN-008 Zero amount validation behaves correctly.
- FIN-009 Large amount boundary is handled correctly.
- FIN-010 Journal tagging to grant head succeeds.
- FIN-011 Journal tagging to invalid grant head is rejected.
- FIN-012 Grant budget utilization updates after tagged expense.
- FIN-013 Untagging expense updates utilization downward.
- FIN-014 Editing tagged expense recalculates utilization correctly.
- FIN-015 FCRA admin expense under 20% is accepted.
- FIN-016 FCRA admin expense at exact 20% is handled correctly.
- FIN-017 FCRA admin expense above 20% is rejected.
- FIN-018 Error message for FCRA cap is clear and actionable.
- FIN-019 Non-FCRA expense is not blocked by FCRA cap logic.
- FIN-020 Field role API POST to finance journal is rejected.
- FIN-021 Unauthorized role cannot view finance analytics.
- FIN-022 Finance-side grant CRUD works if enabled for finance role.
- FIN-023 Finance export to Tally XML succeeds.
- FIN-024 Exported Tally XML format is valid.
- FIN-025 Export reflects selected date range.
- FIN-026 Export excludes unauthorized org data.
- FIN-027 Revenue forecast visible only to allowed roles.
- FIN-028 Revenue forecast calculations use current finance data.
- FIN-029 Failed save shows error and does not create duplicate entry.
- FIN-030 Double-click on save does not create duplicate transaction.

## 8. Fundraising and CRM

- CRM-001 CRM page loads donor list.
- CRM-002 Add donor manually succeeds.
- CRM-003 Edit donor details succeeds.
- CRM-004 Donor deletion/archive behaves correctly.
- CRM-005 Donor segmentation filters work.
- CRM-006 Search donor by name works.
- CRM-007 Search donor by email/phone works.
- CRM-008 Donor stage changes persist.
- CRM-009 Touchpoint creation succeeds.
- CRM-010 Next action creation succeeds.
- CRM-011 AI insight panel renders when comms history exists.
- CRM-012 AI insight panel handles no-history case gracefully.
- CRM-013 Fundraising campaigns list loads.
- CRM-014 Create campaign succeeds.
- CRM-015 Edit campaign target succeeds.
- CRM-016 Campaign progress updates after donation.
- CRM-017 Public donate page loads without login.
- CRM-018 Public donation with valid details succeeds.
- CRM-019 Public donation with missing fields is rejected.
- CRM-020 Public donation with invalid amount is rejected.
- CRM-021 Public donation with invalid email is rejected.
- CRM-022 Public donation with payment failure shows retry path.
- CRM-023 Successful public donation creates donor record.
- CRM-024 Successful public donation creates finance transaction.
- CRM-025 Successful public donation triggers 80G receipt endpoint.
- CRM-026 80G PDF generates correctly.
- CRM-027 Donation duplicate-submit prevention works.
- CRM-028 Donation success refreshes dashboard counts.
- CRM-029 Donation success refreshes CRM views.
- CRM-030 Tenant isolation prevents NGO A from reading NGO B donor.
- CRM-031 Tenant isolation prevents NGO A from editing NGO B donor.
- CRM-032 Donor impact metrics roll up correctly from programs.
- CRM-033 WhatsApp outreach template creation succeeds.
- CRM-034 WhatsApp send action logs outbound activity.
- CRM-035 WhatsApp webhook delivery status updates correctly.
- CRM-036 Failed WhatsApp delivery is marked correctly.
- CRM-037 Opted-out donor is excluded from outreach if rule exists.

## 9. Compliance

- COMP-001 Compliance vault loads documents.
- COMP-002 Upload compliance PDF succeeds.
- COMP-003 Upload unsupported file type is rejected.
- COMP-004 Upload oversized file is rejected.
- COMP-005 Uploaded document appears in vault list.
- COMP-006 Download document succeeds.
- COMP-007 Download handles expired link gracefully.
- COMP-008 Edit document metadata succeeds.
- COMP-009 Delete/archive document behaves correctly.
- COMP-010 Expiry date tracking marks document at-risk correctly.
- COMP-011 Expiry reminder creates notification.
- COMP-012 Expiry reminder creates task when configured.
- COMP-013 Renewal workspace opens from banner.
- COMP-014 Renewal workspace step progression works.
- COMP-015 Completing renewal step updates status.
- COMP-016 Completing all renewal steps marks doc renewed.
- COMP-017 Renewal completion clears related at-risk banner.
- COMP-018 Renewal completion resolves related task.
- COMP-019 Linking document to grant marks grant at risk on expiry.
- COMP-020 Unlinking document removes grant risk status when appropriate.
- COMP-021 Multiple grants linked to one document update correctly.
- COMP-022 Compliance blocked-grant logic is enforced.
- COMP-023 Compliance document list supports filtering/search.
- COMP-024 Storage fallback works in memory/demo mode.
- COMP-025 Unauthorized role cannot upload restricted compliance docs.
- COMP-026 Audit trail records document upload/update/renewal actions.

## 10. Reports and insights

- REP-001 Reports page loads report catalogue.
- REP-002 Open specific report from reports page succeeds.
- REP-003 Open report from grant detail CTA succeeds.
- REP-004 Report readiness score calculates correctly.
- REP-005 Missing data shows readiness CTA.
- REP-006 Readiness CTA links directly to missing grant/program section.
- REP-007 Narrative draft generation works with complete data.
- REP-008 Narrative draft generation handles incomplete data gracefully.
- REP-009 PDF report generation succeeds.
- REP-010 Generated PDF contains correct report data.
- REP-011 Export respects current filters/scope.
- REP-012 Insights page loads KPIs.
- REP-013 Programs role sees program-relevant insights only.
- REP-014 Board role sees board-appropriate read-heavy dashboards.
- REP-015 Finance-restricted metrics are hidden from programs role.
- REP-016 Empty insights state is handled gracefully.
- REP-017 Large datasets do not break chart rendering.
- REP-018 Report links respect role permissions.

## 11. Agent HQ and copilot

- AGT-001 Agent HQ page loads for authorized user.
- AGT-002 Field role is denied access to Agent HQ.
- AGT-003 Intent entered in header command bar creates queued item.
- AGT-004 Natural-language donor creation intent parses correctly.
- AGT-005 Natural-language grant move intent parses correctly.
- AGT-006 Natural-language report generation intent parses correctly.
- AGT-007 Ambiguous intent asks for clarification if required.
- AGT-008 Invalid intent fails gracefully.
- AGT-009 ED can approve queued agent action.
- AGT-010 Approving agent action executes workflow successfully.
- AGT-011 Rejecting agent action keeps system unchanged.
- AGT-012 Agent execution status updates from queued to running to done.
- AGT-013 Failed agent action logs error state.
- AGT-014 Audit trail records who approved and what executed.
- AGT-015 Command palette opens with keyboard shortcut.
- AGT-016 Slash shortcuts route to intended modules.
- AGT-017 Queue filters by status work.
- AGT-018 Queue filters by agent type work.
- AGT-019 Duplicate approval click does not execute action twice.
- AGT-020 Unauthorized user cannot approve queued actions.

## 12. Volunteers

- VOL-001 Volunteers page loads roster.
- VOL-002 Add volunteer succeeds.
- VOL-003 Edit volunteer succeeds.
- VOL-004 Delete/archive volunteer behaves correctly.
- VOL-005 Skills field saves and filters correctly.
- VOL-006 Verification status updates correctly.
- VOL-007 Create shift succeeds.
- VOL-008 Assign volunteer to program succeeds.
- VOL-009 Volunteer hours log updates totals correctly.
- VOL-010 Check-in flow succeeds.
- VOL-011 Check-out flow succeeds.
- VOL-012 Double-booking volunteer on overlapping shifts is blocked.
- VOL-013 Non-overlapping shifts are allowed.
- VOL-014 Shift edit revalidates conflict rules.
- VOL-015 Volunteer list search/filter works.
- VOL-016 Unauthorized role cannot modify volunteer assignments if restricted.

## 13. Settings and system

- SYS-001 Settings page loads for authorized user.
- SYS-002 Org profile edit saves correctly.
- SYS-003 Team invite creation succeeds.
- SYS-004 Duplicate invite handling works.
- SYS-005 Invite acceptance flow works.
- SYS-006 Invite revoke/removal works.
- SYS-007 Role update for team member persists correctly.
- SYS-008 AI key save succeeds.
- SYS-009 AI key delete succeeds.
- SYS-010 Plans tab opens from /settings?tab=plans.
- SYS-011 Billing tab alias routes correctly.
- SYS-012 Plans comparison modal opens.
- SYS-013 Trial banner shows during active trial.
- SYS-014 Past-due banner shows in past-due state.
- SYS-015 Upgrade prompts appear in correct states.
- SYS-016 WhatsApp portal settings save correctly.
- SYS-017 Language selector changes UI to English.
- SYS-018 Language selector changes UI to Hindi.
- SYS-019 Language selector changes UI to Tamil.
- SYS-020 Missing translation keys fall back gracefully.
- SYS-021 Dark mode toggle switches theme without reload.
- SYS-022 Theme persists during session/navigation.
- SYS-023 Demo mode pill appears only in demo/dev states.
- SYS-024 Store-changed bridge triggers refresh after settings changes.
- SYS-025 PWA install prompt behaves correctly where supported.
- SYS-026 PWA offline shell loads when network is unavailable.
- SYS-027 Reconnect after offline restores live data sync.
- SYS-028 Service worker update flow refreshes safely.
- SYS-029 Cache does not serve stale protected data after logout.

## 14. Cross-cutting platform behavior

- XPLAT-001 Error boundary catches render crash.
- XPLAT-002 Error boundary shows Try Again UI.
- XPLAT-003 Try Again reloads affected screen successfully.
- XPLAT-004 Success toast appears after save action.
- XPLAT-005 Error toast appears after failed action.
- XPLAT-006 Toasts do not stack infinitely.
- XPLAT-007 Global entity search returns grants.
- XPLAT-008 Global entity search returns donors.
- XPLAT-009 Global entity search returns beneficiaries.
- XPLAT-010 Entity search result routes to correct page.
- XPLAT-011 Workflow success CTA opens created entity.
- XPLAT-012 Browser refresh on deep-linked route works.
- XPLAT-013 Large list pagination or infinite scroll works.
- XPLAT-014 Empty states render correctly on all major modules.
- XPLAT-015 Loading skeletons show during slow network.
- XPLAT-016 Retry actions work after transient API failures.
- XPLAT-017 No white-screen on any known route.
- XPLAT-018 Browser back/forward navigation preserves app state correctly.

## 15. RBAC matrix

- RBAC-001 ED can access all sidebar modules intended for ED.
- RBAC-002 Finance can access finance and allowed related modules only.
- RBAC-003 Programs can access programs and allowed related modules only.
- RBAC-004 Field can access programs-only routes as intended.
- RBAC-005 Board can access read-heavy dashboards only.
- RBAC-006 Field denied from finance route.
- RBAC-007 Field denied from funding route.
- RBAC-008 Field denied from agent-hq route.
- RBAC-009 Programs denied from finance mutations.
- RBAC-010 Board denied from edit actions.
- RBAC-011 Hidden navigation items do not appear for unauthorized roles.
- RBAC-012 Direct URL to unauthorized module shows denial.
- RBAC-013 Unauthorized API call returns 403/404 as designed.
- RBAC-014 Export actions are only visible to roles with export rights.
- RBAC-015 Agent approval actions visible only to roles with approval rights.
- RBAC-016 Role change mid-session updates permissions correctly on refresh/re-login.

## 16. Security, privacy, tenancy, compliance

- SEC-001 JWT cannot be reused after logout if revocation enabled.
- SEC-002 Protected API without token is rejected.
- SEC-003 Protected API with tampered token is rejected.
- SEC-004 Protected API with expired token is rejected.
- SEC-005 SQL injection strings in search fields do not break queries.
- SEC-006 XSS payload in text inputs is escaped safely.
- SEC-007 HTML/script pasted into notes is sanitized.
- SEC-008 File upload rejects malicious extensions.
- SEC-009 Presigned URLs are time-limited and scoped.
- SEC-010 Cross-tenant donor read is blocked.
- SEC-011 Cross-tenant donor update is blocked.
- SEC-012 Cross-tenant grant read is blocked.
- SEC-013 Cross-tenant beneficiary read is blocked.
- SEC-014 Cross-tenant compliance doc read is blocked.
- SEC-015 DPDP consent is mandatory before beneficiary creation.
- SEC-016 DPDP consent evidence/audit trail is stored.
- SEC-017 DPDP erasure request logs who performed erasure.
- SEC-018 PII is removed from erased record views and exports.
- SEC-019 Anonymized metrics remain after erasure.
- SEC-020 Login rate limit cannot be bypassed by burst attempts easily.
- SEC-021 Sensitive fields are not exposed in frontend logs.
- SEC-022 Error responses do not leak internal stack traces.
- SEC-023 Access Restricted page does not reveal confidential module details.
- SEC-024 Production hosting region is ap-south-1 if required policy is enforced.
- SEC-025 Consent audit trail is exportable/reviewable if required.

## 17. Black-box and boundary cases

- BB-001 Minimum valid password length accepted.
- BB-002 One character below minimum password length rejected.
- BB-003 Maximum password length accepted or handled safely.
- BB-004 Very long NGO name is stored/displayed safely.
- BB-005 Very long donor name is stored/displayed safely.
- BB-006 Very long beneficiary note is stored/displayed safely.
- BB-007 Zero donation amount rejected.
- BB-008 Negative donation amount rejected.
- BB-009 Extremely high donation amount handled correctly.
- BB-010 FCRA ratio at 19.99% accepted.
- BB-011 FCRA ratio at 20.00% handled correctly.
- BB-012 FCRA ratio at 20.01% rejected.
- BB-013 Trial on day 29 shows correct banner.
- BB-014 Trial on day 30 shows correct banner.
- BB-015 Trial on day 31 moves to expired/prompt state.
- BB-016 Expiry reminders at 30 days trigger correctly.
- BB-017 Expiry reminders at 1 day trigger correctly.
- BB-018 Leap year/date boundary handled correctly.
- BB-019 Time-zone-sensitive morning brief appears based on IST timing.
- BB-020 Unicode names in Hindi/Tamil save and render correctly.
- BB-021 Mobile number formatting with spaces/dashes is normalized if expected.
- BB-022 Duplicate browser submit does not create duplicate records.
- BB-023 Refresh during wizard does not corrupt onboarding state.
- BB-024 Browser back during multi-step modal behaves safely.
- BB-025 Deleted linked entity in task/grant/report does not crash page.
- BB-026 Empty lists, single-item lists, and very large lists all render correctly.

## 18. API and integration behavior

- API-001 API returns correct status codes for success cases.
- API-002 API returns correct status codes for validation errors.
- API-003 API returns correct status codes for unauthorized requests.
- API-004 API returns correct response shape expected by frontend.
- API-005 Memory/demo mode works without Postgres where intended.
- API-006 Optional Postgres mode works when available.
- API-007 Vite frontend and backend startup integration works for E2E.
- API-008 Webhook delivery with valid payload succeeds.
- API-009 Webhook with invalid signature/payload is rejected if validation exists.
- API-010 Webhook retries do not create duplicate records.
- API-011 Razorpay mock flow works when live key absent.
- API-012 Real-key/live integration path handles success callback correctly.
- API-013 Real-key/live integration path handles failure callback correctly.
- API-014 Cron-triggered jobs do not duplicate work on re-run.
- API-015 Parallel API calls do not create race-condition duplicates.

## 19. Performance and resilience

- PERF-001 Login response remains usable under normal load.
- PERF-002 Dashboard first load remains usable with realistic data volume.
- PERF-003 Large beneficiary roster remains scrollable/searchable.
- PERF-004 Large donor list remains usable.
- PERF-005 Large grant list remains usable.
- PERF-006 Large compliance vault remains usable.
- PERF-007 Offline queue with many pending items syncs reliably.
- PERF-008 Slow network shows loaders, not blank screens.
- PERF-009 API timeout surfaces clear retry message.
- PERF-010 Repeated refresh events do not create infinite rerender loops.
- PERF-011 Memory usage remains stable after long admin session.
- PERF-012 File upload failure/retry works without page reload.
- PERF-013 Concurrent edits do not silently overwrite critical data.
- PERF-014 Background refresh does not reset unsaved form state.

## 20. Accessibility and usability

- A11Y-001 Full keyboard navigation works on login.
- A11Y-002 Full keyboard navigation works on dashboard.
- A11Y-003 Full keyboard navigation works on forms/modals.
- A11Y-004 Focus trap works inside modal dialogs.
- A11Y-005 Escape closes modal where expected.
- A11Y-006 Screen-reader labels exist for important controls.
- A11Y-007 Error messages are announced/accessibly associated with fields.
- A11Y-008 Color-only status indicators also have text/icon meaning.
- A11Y-009 Contrast is sufficient in light mode.
- A11Y-010 Contrast is sufficient in dark mode.
- A11Y-011 Table/list rows are readable on mobile.
- A11Y-012 Language switching does not break layout.
- A11Y-013 Hindi text does not overflow buttons/cards.
- A11Y-014 Tamil text does not overflow buttons/cards.
- A11Y-015 Touch targets are usable on mobile screens.
- A11Y-016 PWA offline banner is readable and dismissible.

## 21. Manual-only release checks

- REL-001 Full role matrix across every sidebar module.
- REL-002 CSR document upload using real storage environment.
- REL-003 WhatsApp MIS end-to-end webhook to beneficiary/program update.
- REL-004 Morning brief cron at actual scheduled time.
- REL-005 Board brief flow with required config/keys.
- REL-006 Razorpay webhook with real callback behavior.
- REL-007 PWA install on Android and desktop Chrome.
- REL-008 PWA offline shell, reconnect, and service worker update.
- REL-009 Multi-device grant state sync between browser A and B.
- REL-010 Production DPDP checks including consent audit and hosting-region verification.
- REL-011 No flash of unauthorized data on any route.
- REL-012 Critical user journeys pass on latest Chrome.
- REL-013 Critical user journeys pass on mobile browser.
- REL-014 Critical user journeys pass with low-bandwidth network simulation.
- REL-015 No blocker, critical, or high-severity bug remains open for release.


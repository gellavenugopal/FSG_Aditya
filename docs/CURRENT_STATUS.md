# Current status

Last updated: **2026-10-26**

## Repository state

- Branch: `feature/engagement-foundation`
- Last substantive context checkpoint: `9e91bbb` — `Document verified UAE Sample 01 demo`.
- Current UAE demo implementation checkpoint: `52d6440` — `Build synthetic UAE Sample 01 reporting demo`.
- Relevant application commits remain present: `6dea749` reporting workflow, `a683914` firm settings, and `666b110` EPIPE guard.
- Previous relevant checkpoint: `a683914ce057df67691e04efe709073bb90fad9e` — Firm Settings and report identity.
- The UAE implementation and context updates are committed; the worktree was clean at the last verification.
- No push or merge has been performed.

## Current task and next action

Immediate task: deliver **UAE Sample 01**, a synthetic UAE LLC demonstration, within the two-day demonstration window. A separate service-backed AED reporting path has now generated and reopened a saved draft pack through the desktop. The next action is presentation/rehearsal using the saved pack; do not expand this into general UAE/IFRS implementation. The preserved India engagement and version 5 output remain unchanged. See [ROADMAP.md](./ROADMAP.md).

The broad legacy migration and extended EPIPE investigation are deferred for this window unless they block the isolated demonstration. Their unresolved status is retained below.

## Verified reporting outcome

**Yes:** a saved synthetic engagement has generated, persisted, finalised and reopened a combined report PDF through the actual desktop/service workflow. The finalised Firm Settings review output is:

- Local path: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\FSG-DEMO-2025-26-firm-settings-pack-v5.pdf`
- SHA-256: `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`
- It contains the audit report, financial statements and notes, was reopened after restarting the desktop/service against the same isolated database/profile, and its 10 pages were visually inspected.
- A fresh UI-driven restart/reopen check on 2026-10-26 confirmed version 5 remains finalised and retrieved PDF bytes match its recorded SHA-256.
- A previous reporting-pack version 4 was also reopened and matched its saved service output. Version 5 is finalised; versions 1, 2 and 6 are drafts in the current demo. This task did not change/finalise version 6.
- `artifacts/Synthetic-Engagement-India-Reporting-Pack.pdf` is a separate synthetic renderer artifact. It is not the persisted PDF from the saved engagement.

The saved engagement includes current/prior TBs, balanced journals, final TB, a manual mapping correction, structured Share Capital details, report wording, firm/office/logo and ordered signatory selections. Checks reconciled final TB and statement totals, selected prior-year closing comparatives, note totals and separate report/approval dates. Finalisation rejected a journal mutation; authorised reopening preserved the previous final output.

### UAE Sample 01 — synthetic demonstration

- Engagement `UAE-SAMPLE-01-2025` is a separate synthetic UAE LLC set to AED/AED for 2025 with 2024 comparatives. No supplied client files were used as account data.
- The desktop imported current/prior synthetic AED TBs, posted two balanced journals, created final TB v2 (16 rows, journal watermark 4), and saved 16 separate UAE statement mappings.
- Saved output: draft version 3, generated from final TB v2 and retrieved from the reopened engagement through the desktop UI after a clean application restart against the same isolated PostgreSQL cluster and Electron profile.
- Fallback PDF: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf`; SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237` (89,392 bytes, 17 pages). The stored bytes retrieved after restart match this hash. All 17 pages were visually inspected.
- Reconciliation from the saved final TB and selected prior TB: 2025 assets AED 239,250 equal liabilities and equity AED 239,250; 2024 assets AED 185,000 equal liabilities and equity AED 185,000. Profit is AED 36,250 for 2025 and AED 38,000 for 2024. Closing equity is AED 182,250. Current cash flow reconciles AED 100,000 opening cash + AED 29,250 net movement = AED 129,250 closing cash. The notes reconcile, including Note 1 cash and Note 7 equity totals.
- The generated pack contains the assets-first statement of financial position, profit or loss and OCI, changes in equity, cash flows, notes, editable auditor narrative, selected synthetic firm/office/partner/logo and management signatory. The report reflects the second balanced AED 1,250 journal and the revised Note 1 narrative. India-specific captions/statutory terms were absent from extracted PDF text.
- Versions 1–3 are all drafts; UAE Sample 01 was not finalised. This limited synthetic example is not a validated IFRS or production reporting pack. The synthetic logo is visually small. Financial-statement approval date/place are retained in each saved output but are not prefilled in the edit form after restart; re-enter them before generating another version.
- The source trial-balance generator is explicitly test-mode-only. The final-TB creation path still records the existing default India mapping-rule-set reference; UAE statement mappings/output remain separate. Do not treat that internal reference as UAE accounting support.

## EPIPE

- The HMR logger stack belongs to Vite's logger in the `electron-vite` Node process. The prior `9ce8abe` launcher guard covered launcher stdout/stderr, and the main-process guard covered Electron main, but neither preloaded a handler into the Vite CLI process.
- Commit `666b110` preloads EPIPE-specific handling into `electron-vite` before Vite starts. The isolated Vite logger disconnect test passed, and the isolated desktop launcher test confirmed launcher stdout EPIPE fallback, continued desktop/service operation, and clean shutdown.
- Repeated renderer HMR was observed through the isolated `launch` route (three HMR update log events), separately from the disconnected-output test.
- **Remaining uncertainty:** the historical popup's owner PID and complete stack were not captured while it was active. An attempt to combine output disconnection with repeated real renderer HMR timed out, so that exact combined scenario is not verified. Do not claim the user's original recurring popup is conclusively resolved solely from the isolated tests. Use `.\tools\engagement-demo.ps1 epipe-ui` for the repeatable isolated boundary test and inspect `dev-launcher.log`, `dev-vite-output.log`, and `dev-output.log`.

## Tests and limits

Verified for the current implementation or recent reporting checkpoints:

- `node tools/selftest-dev-vite-output-guard.mjs` — passed (Vite logger EPIPE fallback, bounded file logging, unrelated `EIO`, process survival).
- `node tools/selftest-dev-output-guard.mjs` — passed.
- `npm run build` — passed; Vite emits the existing `tallyParsers.js` dynamic/static import chunk warning.
- `npm run engagement:test` — passed in this checkpoint, 94 assertions against PostgreSQL 18.
- `npm run isolation:test` — passed, 23 assertions after adding the missing `tb_rows` fixture to the disposable schema in this checkpoint.
- `node tools/selftest-uae-demo-reporting.mjs` — passed; validates UAE AED/current-comparative reconciliation, cash flow/equity/notes and draft-only HTML.
- `node tools/selftest-fs-snapshot.mjs` and `node tools/selftest-final-signing.mjs` — passed in this checkpoint against disposable test data.
- `.\tools\engagement-demo.ps1 verify-ui` — passed through the normal screen: administrator, contributor, reader and partner sign-in/sign-out, and incorrect-password rejection.
- Actual isolated desktop UI UAE reporting and restart/reopen check passed as described above.

Physical multi-computer UAT has not been performed and is deferred. Automated service tests and a single-machine demo do not establish production readiness.

## Unresolved production incident

The preliminary database-isolation incident affecting possible `vera_financial` activity remains explicitly **unresolved**. No production connection, migration, restore, rollback or impact check was performed for these checkpoints. Never access that database or saved production settings during development/testing.

## Active blockers and product gaps

- **UAE:** Only the narrow `AE_UAE_DEMO` synthetic AED demonstration path exists. It is not general UAE IFRS reporting, supports no currency translation, and has no validation against client accounting documents. The local reference files were not used as data or committed. Keep output labelled “Draft for demonstration”; no UAE output is finalised.
- **Draft version 6:** The isolated UI confirms the engagement is active, v5 finalised and v6 draft. The demo launch log records `reporting/output/save` at `2026-10-26T11:46:42.989Z`, matching v6 creation; the following authentication/engagement activity contains no `reporting/output/finalise` request. The current firm-settings automation generates a PDF first, then uses a distinct explicit partner click to finalise it. The exact reason that follow-up did not occur is not captured, so do not infer it. There is no evidence of automatic reopening. The UI now labels each output `Draft · not finalised` or `Finalised` and states the explicit finalisation policy; verified in the running isolated desktop.
- Recurring EPIPE popup reports still lack historical live process/PID correlation and a complete original stack. The isolated process-boundary tests passed; extended investigation is deferred unless it blocks the demonstration.
- Legacy database-backed IPC remains outside engagement authorization; see [ARCHITECTURE.md](./ARCHITECTURE.md).
- UAE IFRS compliance is not implemented or validated; the current path is demonstration-only. India Ind AS, US GAAP, currency translation and complete legacy-operation migration also remain unimplemented/deferred.

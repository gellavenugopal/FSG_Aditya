# Current status

Last updated: **2026-10-27**

## Repository state

- Branch: `feature/engagement-foundation`
- Previous context checkpoint: `9e91bbb` — `Document verified UAE Sample 01 demo`.
- Current UAE demo implementation checkpoint: `52d6440` — `Build synthetic UAE Sample 01 reporting demo`.
- Relevant application commits remain present: `6dea749` reporting workflow, `a683914` firm settings, and `666b110` EPIPE guard.
- Previous relevant checkpoint: `a683914ce057df67691e04efe709073bb90fad9e` — Firm Settings and report identity.
- Latest application checkpoint: `dd154c0` — `Fix UAE demo report persistence and layout`.
- UAE IFRS test-bed implementation checkpoint: `a5785c8` — `test: add synthetic UAE IFRS test bed`.
- Access and reporting changes are being checkpointed locally before resuming B/C engagement work.
- No push or merge has been performed.

## Current task and next action

The empty UAE engagement list was reproduced and diagnosed as a firm-scope mismatch, not an authentication, service, or loading failure. The protected UI now identifies the signed-in firm and defaults administrators/partners to the firm-scoped list. Normal login and visible navigation reached `UAE-SAMPLE-01-2025`, and the saved v5 bytes were downloaded through the application.

UAE Sample 01 v5 remains preserved and unchanged. A corrected draft v6 was generated and downloaded through the normal desktop UI; every page, contents destination and printed page number was checked. Next action: provision test-bed cases B and C as separate isolated engagement records, then exercise their saved outputs through the desktop and an application restart. The current A/B/C renderer fixtures are not saved engagement outputs. See [UAE_IFRS_TESTBED.md](./UAE_IFRS_TESTBED.md) and [ROADMAP.md](./ROADMAP.md).

The broad legacy migration and extended EPIPE investigation are deferred for this window unless they block the isolated demonstration. Their unresolved status is retained below.

## Verified reporting outcome

**Yes:** the India engagement has a finalised and reopened combined PDF. UAE Sample 01 has generated and reopened a separate demonstration-only draft through the actual desktop/service workflow.

- Local path: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\FSG-DEMO-2025-26-firm-settings-pack-v5.pdf`
- SHA-256: `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`
- It contains the audit report, financial statements and notes, was reopened after restarting the desktop/service against the same isolated database/profile, and its 10 pages were visually inspected.
- After the UAE shared-code changes, a read-only isolated desktop UI restart/reopen check again confirmed version 5 remains finalised, firm/office/branding/signatories persist, and retrieved PDF bytes match its recorded SHA-256.
- A previous reporting-pack version 4 was also reopened and matched its saved service output. Version 5 is finalised; versions 1, 2 and 6 are drafts in the current demo. This task did not change/finalise version 6.
- `artifacts/Synthetic-Engagement-India-Reporting-Pack.pdf` is a separate synthetic renderer artifact. It is not the persisted PDF from the saved engagement.

The saved engagement includes current/prior TBs, balanced journals, final TB, a manual mapping correction, structured Share Capital details, report wording, firm/office/logo and ordered signatory selections. Checks reconciled final TB and statement totals, selected prior-year closing comparatives, note totals and separate report/approval dates. Finalisation rejected a journal mutation; authorised reopening preserved the previous final output.

### UAE Sample 01 — synthetic demonstration

- Engagement `UAE-SAMPLE-01-2025` is a separate synthetic UAE LLC set to AED/AED for 2025 with 2024 comparatives. No supplied client files were used as account data.
- The desktop imported current/prior synthetic AED TBs, posted two balanced journals, created final TB v2 (16 rows, journal watermark 4), and saved 16 separate UAE statement mappings.
- Preserved historical output v5 remains unchanged at `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v5.pdf`; SHA-256 `29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a` (90,330 bytes, 17 pages). Review found no auditor-address overflow, but it had no clickable contents destinations, repeated generic note titles, one short note per page, and the label “Unmapped demonstration adjustment.”
- Corrected draft v6 was generated and downloaded from the visible Saved combined PDF versions list after restarting the same isolated desktop. Path: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v6.pdf`; SHA-256 `cefb5b714f1069c73af30970cd637d2049ddb9448333b953ff4773f121fb77a1` (86,901 bytes, 11 pages). The contents has 16 clickable destinations with printed page numbers matching their targets; all 11 footers are correct. Notes are descriptively titled and grouped, the mapped adjustment is shown within operating expenses, the address remains on the auditor page, and no India wording or replacement glyphs were found. Every page was visually inspected. V6 remains an unfinalised “Draft for demonstration.”
- The service-stored v5 hash still matches its preserved local bytes after v6 generation. UAE v3 and India finalised v5 also remain unchanged at their recorded hashes.
- Preserved v3 baseline: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf`; SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237` (89,392 bytes). The saved service bytes still match. It remains unchanged.
- Draft v4 was an intermediate layout attempt. It produced 18 physical pages because the larger fixed logo box pushed the auditor address onto an extra page, misaligning the contents. It remains an unfinalised historical output; use v5, not v4, for the walkthrough. The logo box was corrected and v5 regenerated as a new output.
- Reconciliation from the saved final TB and selected prior TB: 2025 assets AED 239,250 equal liabilities and equity AED 239,250; 2024 assets AED 185,000 equal liabilities and equity AED 185,000. Profit is AED 36,250 for 2025 and AED 38,000 for 2024. Closing equity is AED 182,250. Current cash flow reconciles AED 100,000 opening cash + AED 29,250 net movement = AED 129,250 closing cash. The notes reconcile, including Note 1 cash and Note 7 equity totals.
- The generated pack contains the assets-first statement of financial position, profit or loss and OCI, changes in equity, cash flows, notes, editable auditor narrative, selected synthetic firm/office/partner/logo and management signatory. The report reflects the second balanced AED 1,250 journal and the revised Note 1 narrative. India-specific captions/statutory terms were absent from extracted PDF text.
- Versions 1–6 are drafts; UAE Sample 01 was not finalised. After application restart, the approval date/place prefilled as 2026-03-10 / Dubai, United Arab Emirates; the audit report date/place remained 2026-03-15 / Dubai, United Arab Emirates. V6 used these saved values and the ordered signatory without re-entry. The synthetic wordmark is rendered in aspect-safe preview/PDF boxes.
- Final-TB v3 has `mapping_rule_set_id = NULL`; UAE creation skipped India rule-set selection and India mapping-engine side effects. Its 16 AED statement mappings remain stored separately. Older final-TB v1/v2 retain their historic India rule-set reference; that reference did not determine UAE statement calculations or permissions.
- `UAESample1.zip` and its listed `Notes.docx`, `AR .docx`, `Schedules & PL.xlsx`, `GL v2 full.xlsx`, and `Finanicals.pdf` were not found in the repository, isolated demo files, session files, or the checked Downloads/Desktop/Documents locations. Those exact files could not be examined for suitability. Earlier handover notes mention an Emirates-named flight-ticket PDF and an India/Rupee charitable-trust workbook, but their exact filenames were not preserved; they cannot be attributed to `UAESample1.zip`. The synthetic demonstration remains unchanged and does not claim to use those client records.
- This limited synthetic example is not a validated IFRS or production reporting pack. The narrow source-TB generator remains test-mode-only; there is no currency translation.

### First-cut UAE IFRS test bed

- Deterministic synthetic fixtures cover A) a Sample 01 baseline-calibrated recalculation, B) a simple trading LLC and C) a controlled IAS 16 revaluation-OCI example. The A fixture matches documented Sample 01 headline results but is not an export of saved TB ledger rows.
- The case calculations, notes, selected comparatives, journal/mapping/narrative changes and actionable failure cases passed `npm run uae:test` (232 assertions). `npm run engagement:test` passed 99 assertions, including edit permission denial, exact journal imbalance detail, versioned output data and signing-selection retrieval after a service restart.
- `npm run build` passed with the existing `tallyParsers.js` mixed import warning. The latest `npm run uae:pdf` generated A/B/C renderer-fixture PDFs (11/11/11 pages) in `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-IFRS-Testbed\run-2026-10-26T21-24-11-842Z`. Each contents destination resolves to its titled page, printed numbers and all footers match, and all pages were visually inspected. India-specific terms, replacement glyphs and the old adjustment label were absent.
- These PDFs are generated from the production statement HTML by local Edge; they are not application/service-saved report outputs. Separate B/C engagement records, editable structured disclosure schedules and desktop restart/reopen coverage for these cases remain unverified/unsupported. Coverage matrix and details: [UAE_IFRS_TESTBED.md](./UAE_IFRS_TESTBED.md).
- Preserved UAE v3, UAE v5 and India finalised v5 were rehashed after test-bed PDF generation; all match their recorded SHA-256 values. Keep them unchanged.

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
- `npm run engagement:test` — passed, 99 assertions against temporary PostgreSQL 18, including persisted approval date/place, ordered signatory metadata, versioned output and restart retrieval.
- `npm run isolation:test` — passed, 23 assertions after adding the missing `tb_rows` fixture to the disposable schema in this checkpoint.
- `node tools/selftest-uae-demo-reporting.mjs` — passed; validates UAE AED/current-comparative reconciliation, cash flow/equity/notes and the 60×15 mm aspect-safe PDF logo box.
- `node tools/selftest-fs-snapshot.mjs` and `node tools/selftest-final-signing.mjs` — passed against disposable test data.
- `.\tools\engagement-demo.ps1 uae-access-ui` — passed through normal login as `Demo Administrator` in **FSG Isolated Demo Firm**: My=2 and All=2, access `Owner`, existing UAE record opened, and v5 downloaded through the application Save PDF dialog with matching SHA-256.
- Normal reporting UI generated draft v6 from final-TB v3; the visible v6 Download PDF action saved the PDF whose bytes matched the service-stored output.
- `.\tools\engagement-demo.ps1 verify-ui` — passed through the normal screen: administrator, contributor, reader and partner sign-in/sign-out, and incorrect-password rejection.
- `.\tools\engagement-demo.ps1 firm-settings-reopen-ui` — passed after this task; India version 5 remained finalised and its retrieved PDF SHA-256 remained `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`.
- Actual isolated desktop UAE flow — normal login, open engagement, inspect source TB/journals/final TB/mappings/reporting, save v5, close/restart, reopen and download v5; stored and downloaded hashes matched. Final-TB v3's nullable India mapping-rule-set reference was verified through the protected desktop client.
- Every page of UAE v5 was visually reviewed from the downloaded saved PDF. UAE output remains draft-only.

Physical multi-computer UAT has not been performed and is deferred. Automated service tests and a single-machine demo do not establish production readiness.

## Unresolved production incident

The preliminary database-isolation incident affecting possible `vera_financial` activity remains explicitly **unresolved**. No production connection, migration, restore, rollback or impact check was performed for these checkpoints. Never access that database or saved production settings during development/testing.

## Active blockers and product gaps

- **UAE:** Only the narrow `AE_UAE_DEMO` synthetic AED demonstration path exists. It is not general UAE IFRS reporting, supports no currency translation, and has no validation against client accounting documents. The local reference files were not used as data or committed. Keep output labelled “Draft for demonstration”; no UAE output is finalised.
- **Empty engagement list:** the previous login record was `Sample Administrator` in firm 1 (`FSG Disposable Demo Firm`), while `UAE-SAMPLE-01-2025` belongs to firm 2 (`FSG Isolated Demo Firm`). The trusted service correctly scopes “All Engagements” to the authenticated firm. This was a legitimate empty result, not a service/authentication failure. No access was granted across firms and no engagement or credential was recreated. Use the harness-provisioned `Demo Administrator` for the isolated UAE firm.
- **India draft version 6:** the isolated UI confirms the India engagement is active, v5 finalised and v6 draft. The demo launch log records `reporting/output/save` at `2026-10-26T11:46:42.989Z`, matching v6 creation; the following authentication/engagement activity contains no `reporting/output/finalise` request. There is no evidence of automatic reopening. The UI labels each output `Draft · not finalised` or `Finalised` and states the explicit finalisation policy.
- Recurring EPIPE popup reports still lack historical live process/PID correlation and a complete original stack. The isolated process-boundary tests passed; extended investigation is deferred unless it blocks the demonstration.
- Legacy database-backed IPC remains outside engagement authorization; see [ARCHITECTURE.md](./ARCHITECTURE.md).
- UAE IFRS compliance is not implemented or validated; the current path is demonstration-only. India Ind AS, US GAAP, currency translation and complete legacy-operation migration also remain unimplemented/deferred.

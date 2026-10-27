# Current status

Last updated: **2026-10-27**

## Repository state

- Branch: `feature/engagement-foundation`
- Excel workbook implementation and documentation checkpoint: `07ddc24` — `feat: export UAE reporting workbook`.
- Base HEAD before the Excel workbook checkpoint: `bc6c448` — `docs: record UAE v7 restart reopening check`.
- UAE note-reference/corrected-output implementation checkpoint: `f3378c5` — `fix: remove dangling UAE note references`.
- Current test-bed implementation checkpoint: `cc5d18e` — `test: verify UAE IFRS B/C desktop cases`.
- Base before that checkpoint: `4cb550d` — `Record UAE access and PDF checkpoint`.
- Earlier milestones remain in history: `6dea749` reporting workflow, `a683914` firm settings, `666b110` EPIPE guard, `a5785c8` synthetic UAE test bed, and `5ccdf38` UAE access/list and PDF review.
- The test-bed source and coverage/roadmap documentation are committed locally. The UAE access/download evidence, corrected-output UI verification, note-reference fix and refreshed context documents are committed locally.
- The Excel workbook checkpoint is committed locally; no push or merge has been performed.
- No push or merge has been performed.

## Current task and next action

The first Excel reporting workbook for UAE Sample 01 v7 is complete. It was exported through the visible desktop action from saved PDF version 7 / final Trial Balance v3, recalculated and saved in Microsoft Excel, then reopened after a full desktop restart. The correct UAE PDF v7 remains byte-identical.

- Workbook: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v7-final-complete.xlsx`
- SHA-256 after Excel recalculation/save: `5c0f2b858d7b5ae8071781d9613a4b92c93e0c49affb6aa702ddc1b653512fa`
- It contains 11 visible sheets: revision guide, report/signatures, original current/prior TB, posted journals, review adjustments, final TB, statements/schedules, movement schedules, notes, and reconciliation checks. Formulas feed from the adjusted Final TB and supporting schedules. Notes print area covers all 32 rows.
- Baseline in Excel: AED 239,250 assets, AED 57,000 liabilities, AED 36,250 profit; position, equity, cash-flow, and final-TB differences are zero. No formula errors, external links, connections, or failed reconciliation checks were found.
- A disposable workbook copy with balanced Dr operating expenses AED 1,000 / Cr trade payables AED 1,000 recalculated to AED 35,250 profit and AED 58,000 liabilities while assets remained AED 239,250 and all reconciliations remained zero.
- Older workbook drafts in the same outputs folder, including `UAE-Sample-01-reporting-pack-v7.xlsx`, `...-formula-verified.xlsx`, `...-reconciled.xlsx`, and `...-final.xlsx`, predate the final notes print-area correction. Use `...-final-complete.xlsx` only.
- Through the normal UI after restart, UAE Sample 01 v7 PDF SHA-256 remained `2d1d41e69827f5eed47f041a0b84ff13dfd80c97a4ccc9d4fd08c67e897838f6`. India finalised v5 was reopened again after these shared-code changes; its SHA-256 remained `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`.
- Checks passed: `npm run build`; `npm run uae:workbook:test`; `npm run engagement:test` (99 assertions); `npm run isolation:test` (23 assertions); `node tools/selftest-fs-snapshot.mjs`; `node tools/selftest-final-signing.mjs`; visible export and post-restart reopen checks for UAE v7 and the workbook. The first snapshot-test run hit a Windows `EPERM` while removing its disposable temp cluster after the assertions; its exact temp folder was removed and the complete test passed on retry.

The editable Word reporting pack is implemented and has been exported through the visible desktop from UAE Sample 01 saved PDF v7 / final Trial Balance v3. Word opened the earlier export normally; content, totals, TOC, page count, repeating table headings, logo, saved narrative and signatories were checked. A follow-up change now applies the same saved final-TB/mapping hash validation used by Excel before Word export. A fresh export through the visible action passed that guard:

- Latest visible export: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v7-final-verified.docx`
- SHA-256: `8aea1383feba61ac4558746e6e32c05d483ad575b87b8a6b5a22f9e81f2d5c46`
- Source PDF: UAE v7; final TB v3. Financial totals match the PDF/Excel baseline: current assets AED 239,250 and profit AED 36,250.
- Word builder uses editable text and tables from the shared UAE financials; external edits remain in Word and do not update the engagement. It validates the saved final-TB snapshot/version and shared financial-data hash against rows and mappings before opening the Save dialog.
- The exported file was reopened through the normal isolated desktop route after a full app restart; the saved engagement and PDF v7 hash were confirmed. The previous export's 10 physical pages, updateable contents field, two dynamic page fields, and 14 repeating-header tables were checked in Microsoft Word. The latest exact file has not been independently opened in Word.

**Remaining Word acceptance gap:** Word's `ExportAsFixedFormat` stalled even on a one-paragraph test document, so a rendered/printed PDF has not been visually inspected. Do not mark Word complete or begin the requested navigation redesign until this gap is resolved or the user explicitly accepts it. The saved engagement's historical-output limitation remains: the output record does not snapshot comparative selection or narrative disclosures, so the document discloses that these are read from the currently saved reporting set.

Checks passed on the current implementation: `npm run uae:word:test` (baseline, non-zero OCI and stale-mapping hash rejection), `npm run uae:workbook:test` (formula workbook and shared hash guard), and `npm run build`. The visible isolated desktop export and post-restart reopen check passed; the output hash above is from that file. The build retains the existing `tallyParsers.js` mixed-import warning. A previous export's Microsoft Word structural/page checks do not substitute for visually inspecting the latest file's printed rendering.

Next action: resolve the Word print-rendering limitation or obtain explicit acceptance of it. Only then proceed to the engagement-navigation redesign; resume separate IFRS scenario expansion after the ordered export/navigation milestones.

Historical reproducibility limitation: the saved PDF output record does not snapshot the selected comparative TB or narrative disclosures. For v7, the current selected comparative/disclosure data match the known PDF revision and its financial-data hash is checked for Excel and Word; exact reconstruction of arbitrary older output revisions after later edits is not guaranteed. Workbook and Word corrections remain external and do not update the engagement, its saved financial data, or PDF.

### Prior access and test-bed checkpoint

The earlier empty engagement list was caused by signing in as `Sample Administrator` from firm 1 (`FSG Disposable Demo Firm`) while UAE Sample 01 belongs to firm 2 (`FSG Isolated Demo Firm`). Firm-scoped authorization was behaving as designed; no cross-firm access, duplicate engagement, or credential reset was used. Exact normal navigation and startup commands are in [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md).

The user-retrieved `FSG-DEMO-2025-26-reporting-pack-v7.pdf` was an India Carverse report, not UAE Sample 01, and is not the UAE walkthrough PDF. The separate synthetic B/C test-bed reopen checks remain complete. The next B/C journal/mapping-change check is deferred until the Word and navigation milestones are complete. Structured disclosure schedules remain unsupported.

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
- Corrected draft v6 remains unchanged at `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v6.pdf`; SHA-256 `cefb5b714f1069c73af30970cd637d2049ddb9448333b953ff4773f121fb77a1` (86,901 bytes, 11 pages). Its printed contents page numbers match the section pages; all 11 footers are correct. Notes are descriptively titled and grouped, the mapped adjustment is shown within operating expenses, and the address remains on the auditor page. A prior handover described clickable contents destinations, but inspection of v5, v6 and v7 found no embedded PDF internal-link annotations; the current pack has a printed contents index.
- Corrected draft v7 was produced by the visible **Generate & save combined PDF** action and downloaded from the visible saved-output row. Path: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v7-corrected.pdf`; SHA-256 `2d1d41e69827f5eed47f041a0b84ff13dfd80c97a4ccc9d4fd08c67e897838f6` (87,311 bytes, 11 pages). The saved synthetic Note 1 narrative appears in the note; other notes retain the generic supporting-balance description because no separate narratives were saved for them. The OCI row has no dangling Note 11 reference. All listed contents pages match their section headings; every physical footer is numbered `Page n of 11`. All 11 pages were visually inspected. Totals remain AED 239,250 assets, AED 239,250 liabilities and equity, AED 36,250 profit, and AED 0 OCI. V7 remains an unfinalised “Draft for demonstration.”
- This follow-up passed `npm run uae:test` (241 assertions), `npm run build`, `node tools/selftest-fs-snapshot.mjs`, and `node tools/selftest-final-signing.mjs`. The normal-UI `uae-correct-output-ui` and B/C `ifrs-cases-reopen-ui` checks passed. After a fresh desktop launch against the same isolated database/profile, the UI test reopened the existing UAE engagement and re-read/downloaded v7; it confirmed the saved Note 1 narrative, AED 239,250 assets, AED 36,250 profit, 11 pages and matching SHA-256. Independent PDF extraction confirmed 16 printed contents entries, all note references resolving to included notes, 11 correct page footers, and no India-specific wording. India finalised v5 SHA-256 remains `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`. `npm run build` emitted the existing mixed static/dynamic import warning for `tallyParsers.js`; the build succeeded.
- The service-stored and local v5/v6 hashes remain unchanged after v7 generation and download. UAE v3 and India finalised v5 remain at their recorded hashes.
- Preserved v3 baseline: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf`; SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237` (89,392 bytes). The saved service bytes still match. It remains unchanged.
- Draft v4 was an intermediate layout attempt. It produced 18 physical pages because the larger fixed logo box pushed the auditor address onto an extra page, misaligning the contents. It remains an unfinalised historical output; use v5, not v4, for the walkthrough. The logo box was corrected and v5 regenerated as a new output.
- Reconciliation from the saved final TB and selected prior TB: 2025 assets AED 239,250 equal liabilities and equity AED 239,250; 2024 assets AED 185,000 equal liabilities and equity AED 185,000. Profit is AED 36,250 for 2025 and AED 38,000 for 2024. Closing equity is AED 182,250. Current cash flow reconciles AED 100,000 opening cash + AED 29,250 net movement = AED 129,250 closing cash. The notes reconcile, including Note 1 cash and Note 7 equity totals.
- The generated pack contains the assets-first statement of financial position, profit or loss and OCI, changes in equity, cash flows, notes, editable auditor narrative, selected synthetic firm/office/partner/logo and management signatory. The report reflects the second balanced AED 1,250 journal and the revised Note 1 narrative. India-specific captions/statutory terms were absent from extracted PDF text.
- Versions 1–7 are drafts; UAE Sample 01 was not finalised. The approval date/place had previously been verified to prefill after application restart as 2026-03-10 / Dubai, United Arab Emirates; the separate audit report date/place is 2026-03-15 / Dubai, United Arab Emirates. V7 records those saved values and the ordered signatory. The synthetic wordmark is rendered in aspect-safe preview/PDF boxes.
- Final-TB v3 has `mapping_rule_set_id = NULL`; UAE creation skipped India rule-set selection and India mapping-engine side effects. Its 16 AED statement mappings remain stored separately. Older final-TB v1/v2 retain their historic India rule-set reference; that reference did not determine UAE statement calculations or permissions.
- `UAESample1.zip` and its listed `Notes.docx`, `AR .docx`, `Schedules & PL.xlsx`, `GL v2 full.xlsx`, and `Finanicals.pdf` were not found in the repository, isolated demo files, session files, or the checked Downloads/Desktop/Documents locations. Those exact files could not be examined for suitability. Earlier handover notes mention an Emirates-named flight-ticket PDF and an India/Rupee charitable-trust workbook, but their exact filenames were not preserved; they cannot be attributed to `UAESample1.zip`. The synthetic demonstration remains unchanged and does not claim to use those client records.
- This limited synthetic example is not a validated IFRS or production reporting pack. The narrow source-TB generator remains test-mode-only; there is no currency translation.

### First-cut UAE IFRS test bed

- Deterministic synthetic fixtures cover A) a Sample 01 baseline-calibrated recalculation, B) a simple trading LLC and C) a controlled IAS 16 revaluation-OCI example. The A fixture matches documented Sample 01 headline results but is not an export of saved TB ledger rows.
- The case calculations, notes, selected comparatives, journal/mapping/narrative changes and actionable failure cases passed `npm run uae:test` (241 assertions). `npm run engagement:test` passed 99 assertions against temporary PostgreSQL 18, including edit permission denial, journal imbalance detail, versioned output data and signing-selection retrieval after a service restart.
- The protected desktop created/reused B (engagement 3) and C (engagement 4), saved v1/v2 outputs, restarted against the same isolated database and reopened v2. Both v2 PDFs have 11 pages; all pages were visually inspected, correct notes/contents were checked, and earlier v1 hashes remained unchanged. Exact hashes and locations are in [UAE_IFRS_TESTBED.md](./UAE_IFRS_TESTBED.md).
- C's controlled OCI mappings required an additive UAE-specific mapping-constraint update. The narrative save now retains the caller's stable note number and reports a conflict rather than silently assigning another; the B/C UI reopen check verified saved narratives and C's non-zero AED 10,000 OCI with AED 55,000 total comprehensive income.
- `npm run uae:pdf` generated renderer-fixture PDFs for A/B/C (11/11/11 pages) in `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-IFRS-Testbed\run-2026-10-26T22-41-40-405Z`. These are not service-saved outputs. `npm run build` passed with the existing `tallyParsers.js` mixed import warning.
- `node tools/selftest-fs-snapshot.mjs` and `node tools/selftest-final-signing.mjs` passed against disposable data. UAE Sample 01 v5 and India finalised v5 were rehashed and remain at their recorded SHA-256 values. Structured disclosure editing, post-output journal/mapping changes reaching a new saved version, and B/C finalisation remain unverified or unsupported as detailed in the coverage matrix.

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

# Current status

Last updated: **2026-10-26**

## Repository state

- Branch: `feature/engagement-foundation`
- Most recent context checkpoint: `fd30dc8` — `Prioritize UAE demo milestone in project context`.
- Relevant application commits remain present: `6dea749` reporting workflow, `a683914` firm settings, and `666b110` EPIPE guard.
- Previous relevant checkpoint: `a683914ce057df67691e04efe709073bb90fad9e` — Firm Settings and report identity.
- The worktree was clean before the current UAE task. Current task changes include the output-status UI clarification and this updated context; use `git status` as the source of truth for uncommitted changes.
- No push or merge has been performed.

## Current task and next action

Immediate task: deliver **UAE Sample 01**, a synthetic UAE LLC demonstration, within the two-day demonstration window. The preserved India engagement and version 5 output were reopened through the isolated desktop UI and the recorded PDF hash matched. Version 6 is a draft; the UI now labels draft/finalised outputs explicitly and explains the explicit partner finalisation step. Next: implement the separate UAE demo path and verify the complete saved desktop workflow. See [ROADMAP.md](./ROADMAP.md).

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
- `npm run engagement:test` — passed, 94 assertions in the recorded Firm Settings checkpoint.
- `npm run isolation:test` — passed, 23 assertions in the recorded isolation checkpoint.
- `node tools/selftest-fs-snapshot.mjs` and `node tools/selftest-final-signing.mjs` — passed in the recorded reporting checkpoint against disposable test data.
- Actual isolated desktop UI reporting and restart/reopen check passed as described above.

Physical multi-computer UAT has not been performed and is deferred. Automated service tests and a single-machine demo do not establish production readiness.

## Unresolved production incident

The preliminary database-isolation incident affecting possible `vera_financial` activity remains explicitly **unresolved**. No production connection, migration, restore, rollback or impact check was performed for these checkpoints. Never access that database or saved production settings during development/testing.

## Active blockers and product gaps

- **UAE:** No UAE reporting engine exists. Current reporting panel supports only `IN_SCHEDULE_III_LEGACY` with INR. UAE create metadata/catalog fields exist, but do not imply UAE accounting/reporting support. Local inspection found the Emirates-named PDF is a flight ticket; the likely workbook is India/Rupee charitable-trust reporting, not a UAE source set. Both are excluded from UAE figures and will not be committed. Use disclosed synthetic AED balances.
- **Draft version 6:** The isolated UI confirms the engagement is active, v5 finalised and v6 draft. The demo launch log records `reporting/output/save` at `2026-10-26T11:46:42.989Z`, matching v6 creation; the following authentication/engagement activity contains no `reporting/output/finalise` request. The current firm-settings automation generates a PDF first, then uses a distinct explicit partner click to finalise it. The exact reason that follow-up did not occur is not captured, so do not infer it. There is no evidence of automatic reopening. The UI now labels each output `Draft · not finalised` or `Finalised` and states the explicit finalisation policy; verified in the running isolated desktop.
- Recurring EPIPE popup reports still lack historical live process/PID correlation and a complete original stack. The isolated process-boundary tests passed; extended investigation is deferred unless it blocks the demonstration.
- Legacy database-backed IPC remains outside engagement authorization; see [ARCHITECTURE.md](./ARCHITECTURE.md).
- UAE IFRS is not implemented. The immediate UAE output must remain a synthetic demonstration, clearly watermarked/labelled, until scope is validated. India Ind AS, US GAAP, currency translation and complete legacy-operation migration also remain unimplemented/deferred.

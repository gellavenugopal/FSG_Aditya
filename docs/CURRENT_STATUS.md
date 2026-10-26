# Current status

Last updated: **2026-10-26**

## Repository state

- Branch: `feature/engagement-foundation`
- Application implementation baseline before this documentation-only task: `666b110b2837e8c7bffdfbd8151bd0af2940785e` — `Guard electron-vite output against EPIPE`. This task adds only repository context documentation; its commit follows that baseline in local history.
- Previous relevant checkpoint: `a683914ce057df67691e04efe709073bb90fad9e` — Firm Settings and report identity.
- Worktree was clean before this documentation task; there were no pre-existing uncommitted application changes. This task changes documentation only. Use `git status` as the source of truth for current uncommitted changes.
- No push or merge has been performed.

## Current task and next action

The context-file task is documentation-only. Next, continue the India single-client product queue: first correlate any recurring EPIPE popup to its live process using the isolated launcher and collect the complete stack; then continue reporting workflow corrections and change-to-output verification. Keep this file and affected context documents current at each completed task.

## Verified reporting outcome

**Yes:** a saved synthetic engagement has generated, persisted, finalised and reopened a combined report PDF through the actual desktop/service workflow. The finalised Firm Settings review output is:

- Local path: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\FSG-DEMO-2025-26-firm-settings-pack-v5.pdf`
- SHA-256: `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`
- It contains the audit report, financial statements and notes, was reopened after restarting the desktop/service against the same isolated database/profile, and its 10 pages were visually inspected.
- A previous reporting-pack version 4 was also reopened and matched its saved service output. Version 5 is the finalized Firm Settings review artifact; an unfinalised version 6 also exists in the demo.
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

- Recurring EPIPE popup reports need correlation against the live popup process; its historical owner and full stack are unknown. The new process-boundary guard has focused isolated test coverage, not conclusive production/user-session confirmation.
- Legacy database-backed IPC remains outside engagement authorization; see [ARCHITECTURE.md](./ARCHITECTURE.md).
- UAE IFRS, India Ind AS, US GAAP, currency translation and complete migration of legacy operations are not implemented.

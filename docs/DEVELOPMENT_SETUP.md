# Development setup

Use the existing disposable desktop demo for application testing. Never use saved production settings, connect to `vera_financial`, or create the test database inside the installed/live PostgreSQL service.

The detailed harness definition and reporting workflow are in [ENGAGEMENT_SERVICE.md](../ENGAGEMENT_SERVICE.md). This file gives the safe repeatable commands without credentials.

## Persistent isolated demo

Open PowerShell at the repository root:

```powershell
Set-Location 'D:\Programs\FinancialStatements\AdityaTool\FSG_Bharat_Source'
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
```

The persistent demo already exists. **Do not run `init` against it.** To inspect/start its dedicated cluster and safely verify its harness-provisioned users:

```powershell
.\tools\engagement-demo.ps1 status
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 provision-users
```

`provision-users` verifies existing user credentials without resetting passwords. Passwords remain only in the ACL-restricted `credentials.json` under the demo home; do not print, copy or commit it.

Start the desktop/service through the isolated harness:

```powershell
.\tools\engagement-demo.ps1 launch
```

The verified non-secret target is loopback PostgreSQL `127.0.0.1:64023`, database `fsg_engagement_demo`, role `fsg_demo_runtime`; cluster data is under `%USERPROFILE%\FSG-Aditya-engagement-demo\postgres-data`, Electron `userData` under `%USERPROFILE%\FSG-Aditya-engagement-demo\electron-user-data`. The harness supplies the secret settings from its local credentials file and manifest; do not reproduce them in shell history or documentation.

## Restart

1. Close the FSG Bharat window normally. Wait for the associated launcher to exit and record `electron-vite exited; code=0; signal=none.` in the isolated `dev-launcher.log`.
2. If the database was stopped, start it with `.\tools\engagement-demo.ps1 start-db`.
3. From the repository root, run `.\tools\engagement-demo.ps1 provision-users` if account verification is needed, then run `.\tools\engagement-demo.ps1 launch`.
4. For the saved India workflow-output check, run `.\tools\engagement-demo.ps1 reopen-ui` from a second PowerShell window while the desktop is open. For India finalised v5 or UAE v5, use the workflow-specific instructions below.

Do not run a second app process against the same profile. Do not run `init` to fix an ordinary startup issue; first inspect the manifest, exact process tree and logs.

## Reopen the preserved India v5 output

The existing finalized India pack is version 5; preserve it and verify it through the normal UI after starting the isolated demo:

```powershell
Set-Location 'D:\Programs\FinancialStatements\AdityaTool\FSG_Bharat_Source'
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 status
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 launch
```

In a second PowerShell window at the repository root, while the desktop remains open:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 firm-settings-reopen-ui
```

This reads the existing workflow/verification records, signs in as the assigned partner through the login UI, opens the saved engagement, retrieves the persisted output and compares its bytes to the recorded v5 SHA-256. It does not reopen or mutate the finalized engagement. Do not run `init`.

To verify that same output's local fallback copy before or after the UI check:

```powershell
$pdf = Join-Path $env:FSG_DEMO_HOME 'outputs\FSG-DEMO-2025-26-firm-settings-pack-v5.pdf'
Get-FileHash -LiteralPath $pdf -Algorithm SHA256
```

Expected SHA-256: `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`.

## Verify UAE engagement access and v5 download

Keep the isolated desktop open and run this from a second PowerShell window at the repository root:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 uae-access-ui
```

This signs in through the normal form as the harness-provisioned `Demo Administrator` in **FSG Isolated Demo Firm**, checks both engagement-list scopes and the authorised engagement id, opens `UAE-SAMPLE-01-2025`, and downloads saved output v5 through the application's Save PDF dialog. By default, the temporary verification copy is removed after its hash matches the service-stored PDF. To retain a new, non-overwriting download inside the isolated outputs folder for review, set its path before running the command:

```powershell
$env:FSG_UAE_ACCESS_DOWNLOAD_PATH = Join-Path (Join-Path $env:FSG_DEMO_HOME 'outputs') 'UAE-Sample-01-reporting-pack-v5-ui-download.pdf'
.\tools\engagement-demo.ps1 uae-access-ui
```

The retained download is required to match the service-stored v5 bytes; the harness rejects paths outside the isolated outputs folder. The workflow does not create an engagement or change saved outputs.

## Reopen UAE Sample 01 and its saved draft PDFs

The same persistent isolated cluster/profile contains the synthetic UAE demonstration. Do not run `init` or regenerate its data for routine review. From the repository root, close the desktop normally first, then:

```powershell
Set-Location 'D:\Programs\FinancialStatements\AdityaTool\FSG_Bharat_Source'
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 launch
```

The click-by-click route is **Sign in → Settings → Engagements → All Engagements → UAE-SAMPLE-01-2025 → Saved combined PDF versions → Version 7 → Download PDF**. Sign in as `Demo Administrator` in **FSG Isolated Demo Firm**. Version 7 is the current corrected draft, generated from final Trial Balance v3; downloading it does not finalise or reopen the engagement. Versions 5 and 6 remain preserved. The v7 local copy is:

```powershell
$v7 = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v7-corrected.pdf'
Get-FileHash -LiteralPath $v7 -Algorithm SHA256
$v5 = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v5.pdf'
Get-FileHash -LiteralPath $v5 -Algorithm SHA256
$v6 = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v6.pdf'
Get-FileHash -LiteralPath $v6 -Algorithm SHA256
```

Expected v7 SHA-256: `2d1d41e69827f5eed47f041a0b84ff13dfd80c97a4ccc9d4fd08c67e897838f6` (87,311 bytes, 11 physical pages). Expected preserved v6 SHA-256: `cefb5b714f1069c73af30970cd637d2049ddb9448333b953ff4773f121fb77a1` (11 pages). Expected preserved v5 SHA-256: `29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a` (17 pages).

V7 was generated with the visible **Generate & save combined PDF** action and downloaded from its visible saved-output row. It was reopened through the normal UI after a fresh application launch against the same isolated database/profile; its stored and downloaded hashes match. Its Note 1 includes the saved synthetic narrative; notes without saved disclosure text retain their generic supporting-balance description. The 11 printed contents page numbers match their sections, all 11 physical footer numbers match, and all pages were visually inspected. No embedded PDF internal-link annotations are present; do not describe the contents index as clickable. Note references resolve only to included notes, with no dangling Note 11 on the OCI line. V5 and v6 remain byte-identical to their saved hashes. All three are **Draft for demonstration**. Use synthetic AED figures only; this path is not a validated IFRS or production pack. See [CURRENT_STATUS.md](./CURRENT_STATUS.md) for reconciliations and limitations.

Open the downloaded v7 and its containing folder for review:

```powershell
Invoke-Item -LiteralPath $v7
Invoke-Item -LiteralPath (Split-Path -LiteralPath $v7)
```

The earlier UAE Sample 01 v3 remains the preserved baseline at `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf`, SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237`. Do not overwrite it. Version 4 is an intermediate, unfinalised output with a page-break/pagination defect; use v5 for the walkthrough.

### Copyable UAE startup and reopen commands

Use the same command block for startup and after a normal close/restart; do not run `init`:

```powershell
Set-Location 'D:\Programs\FinancialStatements\AdityaTool\FSG_Bharat_Source'
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 status
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 launch
```

Then sign in as the harness-provisioned `Demo Administrator` in **FSG Isolated Demo Firm**, open **UAE-SAMPLE-01-2025**, and download saved output v7. The prior empty list was caused by signing in as `Sample Administrator` from a different firm; “All Engagements” remains firm-scoped. The cluster is `127.0.0.1:64023/fsg_engagement_demo`; its data and Electron profile persist across these restarts. Do not launch a second app process against this profile.

## Export and reopen the UAE Excel workbook

Through the normal desktop UI, open **UAE-SAMPLE-01-2025**, go to its saved combined PDF versions, select version 7 / final Trial Balance v3, and choose **Export Excel**. Select a local destination in the desktop Save dialog. The workbook is self-contained; external edits do not update the engagement, its saved financial data, or PDF. The delivered workbook is:

- `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v7-final-complete.xlsx`
- SHA-256: `5c0f2b858d7b5ae8071781d9613a4b92c93e0c49affb6aa702ddc1b653512fa`

To re-open that workbook and the saved v7 PDF through the desktop harness after a normal application restart, first start the isolated demo using the commands above. In a second PowerShell window:

```powershell
Set-Location 'D:\Programs\FinancialStatements\AdityaTool\FSG_Bharat_Source'
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
$env:FSG_UAE_WORKBOOK_OUTPUT_PATH = Join-Path (Join-Path $env:FSG_DEMO_HOME 'outputs') 'UAE-Sample-01-reporting-pack-v7-final-complete.xlsx'
$env:FSG_UAE_WORKBOOK_REOPEN_ONLY = 'true'
.\tools\engagement-demo.ps1 uae-workbook-export-ui
```

The reopen-only check signs in normally, opens the existing engagement and saved v7 PDF, verifies the PDF hash, then reads the saved workbook without exporting or overwriting it. To run a new visible-export check instead, unset `FSG_UAE_WORKBOOK_REOPEN_ONLY`, select a new output filename with `FSG_UAE_WORKBOOK_OUTPUT_PATH` (the harness refuses to overwrite an existing workbook), and run the same action. Excel formulas recalculate in a compatible spreadsheet application; `npm run uae:workbook:test` is a separate deterministic unit check and does not start the desktop or connect to a database.

## Export and reopen the UAE Word document

Through the normal desktop UI, open **UAE-SAMPLE-01-2025**, locate saved PDF v7 / final TB v3, and select **Export Word**. Use a new filename; the harness refuses to overwrite an existing document. The latest UI-verified Word export is:

- `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v7-final-verified.docx`
- SHA-256: `8aea1383feba61ac4558746e6e32c05d483ad575b87b8a6b5a22f9e81f2d5c46`

After starting the isolated desktop, reopen the saved Word export through the normal sign-in and engagement route with this separate PowerShell command:

```powershell
Set-Location 'D:\Programs\FinancialStatements\AdityaTool\FSG_Bharat_Source'
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
$env:FSG_UAE_WORD_OUTPUT_PATH = Join-Path (Join-Path $env:FSG_DEMO_HOME 'outputs') 'UAE-Sample-01-reporting-pack-v7-final-verified.docx'
$env:FSG_UAE_WORD_REOPEN_ONLY = 'true'
.\tools\engagement-demo.ps1 uae-word-export-ui
```

The reopen check does not create a new output. It verifies the existing engagement and saved UAE PDF v7 through the desktop, then confirms the Word file is an OOXML document and reports its hash. To export another Word copy, clear `FSG_UAE_WORD_REOPEN_ONLY`, choose a different path in `FSG_UAE_WORD_OUTPUT_PATH`, and run the same action. External Word edits remain in that document and do not update the engagement.

The latest export opened in a separate Microsoft Word process and paginated to 10 pages / 14 tables. Both Word `ExportAsFixedFormat` (previously even for a minimal document) and `SaveAs2` on this output stalled; no local alternate Office/PDF renderer is installed, so printed pages remain unverified. Do not treat successful DOCX opening, OOXML structure or page counts as visual print inspection. `npm run uae:word:test` tests baseline and non-zero OCI fixture documents without opening the desktop or connecting to a database.

## EPIPE test

With the isolated PostgreSQL instance running and no app/dev process from this checkout active:

```powershell
.\tools\engagement-demo.ps1 epipe-ui
```

Close the FSG Bharat window normally when the test prompts. This exercises the launcher pipe disconnect, diagnostic fallback and clean shutdown. `node tools\selftest-dev-vite-output-guard.mjs` tests the Vite CLI logger boundary without opening the desktop. Do not treat either check as proof that a previously reported popup PID was captured.

## Diagnostics

All demo logs are inside the isolated Electron profile:

- `dev-launcher.log` — launcher startup identity, forwarded output, EPIPE and child exit.
- `dev-vite-output.log` — Vite CLI startup identity and console diagnostics after a CLI output EPIPE.
- `dev-output.log` — Electron main-process diagnostics after its output EPIPE.

These development logs are bounded. A startup identity records PID, parent PID, timestamp, checkout and launcher version. Match the PID to the executable, command line and parent before attributing a popup or stopping a process. Stop only a verified project-owned process by its exact PID.

## Separate reporting test-bed commands

Starting or reopening the demo does not run the test suite. From the repository root, run these only when you intentionally want verification:

```powershell
npm run uae:test
npm run uae:workbook:test
npm run engagement:test
npm run build
npm run uae:pdf
```

- `uae:test` runs the deterministic synthetic A/B/C calculations and failure cases without connecting to a database.
- `uae:workbook:test` builds and checks the formula-driven UAE reporting workbook using deterministic in-memory data; it does not connect to a database or export a file.
- `engagement:test` creates and removes its own temporary PostgreSQL test cluster; it exercises permissions, actionable journal validation and report-output persistence across a service restart.
- `build` compiles the desktop and is not part of `launch`.
- `uae:pdf` renders synthetic fixture HTML through local Edge into a timestamped folder under `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-IFRS-Testbed`. It requires the existing isolated `target.json`, does not connect to the database, and does not alter saved UAE Sample 01 or India outputs. These renderer PDFs are not service-saved engagement outputs.

See [UAE_IFRS_TESTBED.md](./UAE_IFRS_TESTBED.md) for case results, PDF paths, coverage status and known gaps. Do not run `init` against the existing demo.

## Isolation safeguards

- Require `FSG_TEST_MODE=true`, complete explicit `FSG_TEST_DB_*` settings, harness target manifest and a distinct `FSG_TEST_USER_DATA_PATH`. Incomplete or conflicting settings fail closed; there is no saved-profile or default-credential fallback.
- The harness uses a dedicated temporary PostgreSQL cluster, loopback host, non-default port and restricted test role. Startup rejects production-target selection before connecting and verifies database/server identity before schema setup.
- Electron's effective `userData` path is configured and verified before reading saved application configuration.
- Test mode is service-only: it skips legacy DB initialization, schema/mapping seeding and legacy financial IPC registration. Packaged builds reject test mode.
- Test credentials are never stored in repository files, logs, this documentation or generated artifacts.
- The historic production data incident remains unresolved. No test authorizes a live database connection, restore or rollback.

For disposable automated isolation checks use `npm run isolation:test`; for service tests use `npm run engagement:test`. Do not use ordinary `npm run dev` with an unknown or saved profile as a substitute for the isolated harness.

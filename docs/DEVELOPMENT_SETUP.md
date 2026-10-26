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

## Reopen UAE Sample 01 and its saved draft PDF

The same persistent isolated cluster/profile contains the synthetic UAE demonstration. Do not run `init` or regenerate its data for routine review. From the repository root, close the desktop normally first, then:

```powershell
Set-Location 'D:\Programs\FinancialStatements\AdityaTool\FSG_Bharat_Source'
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 launch
```

Sign in through the normal desktop screen with the harness administrator account, open **UAE-SAMPLE-01-2025**, then use **Saved combined PDF versions → Version 5 → Download PDF**. This reads the saved engagement; it does not regenerate or finalise the PDF. The verified current walkthrough fallback is:

```powershell
$pdf = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v5.pdf'
Get-FileHash -LiteralPath $pdf -Algorithm SHA256
```

Expected SHA-256: `29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a`.

The saved output was retrieved through the desktop after an application/service restart against the same database/profile; stored and downloaded bytes matched this fallback. It has 17 visually inspected pages and remains **Draft for demonstration**. Use synthetic AED figures only; this path is not a validated IFRS or production pack. See [CURRENT_STATUS.md](./CURRENT_STATUS.md) for reconciliations and limitations.

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

Then sign in normally, open **UAE-SAMPLE-01-2025**, and download saved output v5. The cluster is `127.0.0.1:64023/fsg_engagement_demo`; its data and Electron profile persist across these restarts. Do not launch a second app process against this profile.

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

## Isolation safeguards

- Require `FSG_TEST_MODE=true`, complete explicit `FSG_TEST_DB_*` settings, harness target manifest and a distinct `FSG_TEST_USER_DATA_PATH`. Incomplete or conflicting settings fail closed; there is no saved-profile or default-credential fallback.
- The harness uses a dedicated temporary PostgreSQL cluster, loopback host, non-default port and restricted test role. Startup rejects production-target selection before connecting and verifies database/server identity before schema setup.
- Electron's effective `userData` path is configured and verified before reading saved application configuration.
- Test mode is service-only: it skips legacy DB initialization, schema/mapping seeding and legacy financial IPC registration. Packaged builds reject test mode.
- Test credentials are never stored in repository files, logs, this documentation or generated artifacts.
- The historic production data incident remains unresolved. No test authorizes a live database connection, restore or rollback.

For disposable automated isolation checks use `npm run isolation:test`; for service tests use `npm run engagement:test`. Do not use ordinary `npm run dev` with an unknown or saved profile as a substitute for the isolated harness.

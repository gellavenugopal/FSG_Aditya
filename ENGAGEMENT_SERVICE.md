# Engagement service operations and UAT

This service handles the new engagement operations. It does not secure the rest of the desktop application: legacy financial IPC still connects directly to PostgreSQL and does not enforce engagement permissions. Do not treat this milestone as multi-user production isolation.

## Desktop sign-up and sign-in

The desktop now opens with firm sign-in instead of the financial workspace. When the firm has no administrator, the first-run screen lets the authorized operator create the firm administrator; the new administrator then signs in with that account. Only the first administrator can sign up through first-run setup; this is not open public registration.

After sign-in, use **Settings → Engagements** for client engagements and **Settings → Firm Team** to add colleagues. Team positions are Employee, Article assistant, Auditor, and Partner. Employee/article/auditor are directory labels with standard staff permissions; Partner is also a permission role. Finalisation still requires assignment as the engagement partner or authorised substitute. Creating a team account displays a one-time password to share securely; automatic email invitations are not implemented.

The engagement client keeps the service session after an authentication-status refresh. If a session expires, sign in again; engagement reads and edits continue to be checked by the trusted service.

The startup screen is an application-entry gate, not complete authorization for legacy data. Legacy financial IPC still has direct PostgreSQL access and does not enforce per-user engagement permissions. Do not treat the login gate as securing those operations or as production-ready multi-user isolation.

## Disposable test mode

Use the explicit disposable test mode for local desktop/service development. It is intentionally separate from ordinary development mode; an unset or incomplete test configuration fails before opening any database connection.

The test harness must create its own temporary PostgreSQL cluster and database, using a restricted non-superuser role and a non-default port. It writes a target manifest containing the exact host, port, database, role, random instance ID, PostgreSQL data directory and isolated Electron user-data directory. The desktop requires all of these environment variables:

```text
FSG_TEST_MODE=true
FSG_TEST_DB_HOST=127.0.0.1
FSG_TEST_DB_PORT=<harness-assigned-port>
FSG_TEST_DB_NAME=<harness-created-database>
FSG_TEST_DB_USER=<harness-created-role>
FSG_TEST_DB_PASSWORD=<harness-generated-secret>
FSG_TEST_TARGET_FILE=<absolute-harness-manifest-path>
FSG_TEST_USER_DATA_PATH=<absolute-harness-user-data-path>
```

Do not set `ENGAGEMENT_SERVICE_URL`, `ENGAGEMENT_DATABASE_URL`, or any `ENGAGEMENT_DB_*` variable in this mode. The application sets and verifies Electron's effective `userData` path before loading any saved database profile, displays the non-secret target, starts only the local engagement service, and disables legacy DB initialization, schema/mapping setup and legacy financial IPC registration. The service compares its complete database options with the harness manifest before connecting. After connection it verifies the PostgreSQL endpoint, current database/user and the harness-created instance marker/data-directory identity before running engagement schema setup.

### Persistent demo sign-in accounts

For the persistent, single-machine sample, provision UI-test accounts only through the isolated harness:

```powershell
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 provision-users
.\tools\engagement-demo.ps1 launch
```

The provisioning action requires the explicit disposable target and its separate application profile, verifies the connected PostgreSQL identity and test-instance marker, then creates a synthetic firm administrator, contributor, and reader. Passwords are randomly generated into the ACL-restricted `credentials.json` in the demo home and stored in PostgreSQL using the same PBKDF2 password-record helper as normal authentication. Passwords are never printed or logged. Re-running the command verifies existing users and passwords without resetting or replacing them; a mismatch fails closed. The app's normal startup never creates test users, and packaged applications reject `FSG_TEST_MODE`.

UI automation may read the credentials file locally, but should enter them through the regular sign-in form. Keep the demo's PostgreSQL data directory and Electron user-data directory between application restarts; `stop-db` is optional and stops only the dedicated demo cluster. Do not use this harness against saved Settings or a production database.

Run the safeguards self-test with:

```powershell
npm run isolation:test
```

That command builds the desktop and provisions a disposable PostgreSQL cluster under the system temporary directory. It uses SCRAM password authentication and a restricted runtime role; validates missing/conflicting configuration, production-target rejection, saved-profile non-fallback, Electron `userData`, legacy-startup disabling, and service identity/schema startup; then launches the Electron main process in a no-window startup probe and removes only its own temporary cluster. It is not a reporting workflow or UI UAT. Never use the saved Settings profile or the live `vera_financial` server for tests. The prior database-isolation incident remains unresolved; this test does not establish impact to existing data or authorise a restore/reversal.

### Development output diagnostics

Start development through `npm run dev` (or `.\tools\engagement-demo.ps1 launch` for the isolated sample); both use the project-owned launcher. It preloads an EPIPE-only guard into the `electron-vite` process before Vite starts. When a terminal or output consumer disconnects, subsequent CLI diagnostics are written to bounded `dev-vite-output.log` in the application profile alongside `dev-launcher.log`. The Electron main process retains its separate bounded `dev-output.log`. Normal console output is unchanged, and unrelated stream errors remain uncaught. To verify the launcher boundary through the isolated desktop route, run `.\tools\engagement-demo.ps1 epipe-ui`, then close the FSG Bharat window when prompted; the test confirms file fallback, continued desktop operation and normal shutdown. Repeated renderer HMR is verified separately by updating a watched renderer file during `.\tools\engagement-demo.ps1 launch`.

## Run on the firm server

Use a trusted Windows firm server with Node.js and PostgreSQL network access. The server process, not a desktop client, must receive the engagement-service database credentials. Keep the database name `vera_financial`; do not point the service at a separate production database.

Configure the server process environment (use the firm's secret-management mechanism; do not store secrets in the repository):

```powershell
$env:ENGAGEMENT_DATABASE_URL = 'postgres://SERVICE_USER:URL_ENCODED_PASSWORD@DB_HOST:5432/vera_financial'
$env:ENGAGEMENT_TLS_KEY_FILE = 'C:\Secure\engagement-service.key'
$env:ENGAGEMENT_TLS_CERT_FILE = 'C:\Secure\engagement-service-chain.crt'
$env:ENGAGEMENT_SETUP_TOKEN = '<at-least-32-random-bytes>'
$env:ENGAGEMENT_BIND_HOST = '0.0.0.0'
$env:ENGAGEMENT_PORT = '8443'
npm run engagement:server
```

Alternatively, configure `ENGAGEMENT_DB_HOST`, `ENGAGEMENT_DB_PORT`, `ENGAGEMENT_DB_NAME`, `ENGAGEMENT_DB_USER`, and `ENGAGEMENT_DB_PASSWORD` instead of `ENGAGEMENT_DATABASE_URL`. PostgreSQL TLS is off unless `ENGAGEMENT_DATABASE_SSL=true`; when enabled, certificate verification is required, with an optional CA file in `ENGAGEMENT_DATABASE_SSL_CA_FILE`.

The HTTPS listener accepts PEM key/certificate files or a PFX file with `ENGAGEMENT_TLS_PFX_FILE` and optional `ENGAGEMENT_TLS_PFX_PASSWORD`. Use a certificate issued by a firm-trusted CA with a SAN matching the host clients will use. Do not disable certificate validation on desktop clients. Permit inbound HTTPS only from firm client networks and restrict database access to the server where the legacy application allows.

The service takes a PostgreSQL advisory lock and applies the additive engagement schema at startup. It requires the existing legacy tables `entities`, `global_signatories`, `financial_periods`, `entity_periods`, and `trial_balances`. The configured service DB role needs the DDL privileges used by this startup migration as well as the engagement operations; this slice does not yet separate migration credentials from runtime credentials. On a production migration, first back up the database and rehearse startup against a restored copy. Migration is not run by Electron startup.

### First administrator

Generate the setup token on the server with a secure random generator, set it as `ENGAGEMENT_SETUP_TOKEN`, and convey it to the authorized setup operator through an approved secret channel. The operator enters it in the first-run setup screen. Setup is rejected without this server-held token and after an administrator already exists. Remove the token from the service environment after setup and restart the service. Firm administrators create partner/staff accounts; each new user must change the generated one-time password at first sign-in.

### Backup and recovery

Before the first service start or any schema change, take and verify a PostgreSQL backup:

```powershell
pg_dump --format=custom --host=DB_HOST --username=BACKUP_USER --file=C:\Backups\vera_financial-before-engagements.dump vera_financial
pg_restore --list C:\Backups\vera_financial-before-engagements.dump
```

Restore only to an approved recovery target using the firm's normal recovery procedure; do not restore over the live database as a test. Engagement schema startup uses additive `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` operations. This slice has no automatic rollback migration; recovery from a bad migration is by restoring the verified backup under the database recovery plan.

## Configure a desktop client

Set `ENGAGEMENT_SERVICE_URL` in the environment inherited by the Electron main process:

```powershell
$env:ENGAGEMENT_SERVICE_URL = 'https://engagement-server.firm.example:8443'
npm run dev
```

For a packaged client, configure the same variable in the approved Windows machine/user environment before launching FSG. The URL must be HTTPS and match the service certificate. The desktop stores the opaque service session token in the Electron main process, not renderer storage.

With an explicitly configured service URL, the desktop enters **service-only mode**. It does not initialize the legacy PostgreSQL client and does not register the legacy financial IPC handlers. The protected reporting panel provides journal posting, final-TB snapshots, India auto-mapping, report settings, note narrative disclosures, combined-PDF generation, and versioned output operations in addition to engagement and TB workflows. Unmigrated functions must not silently fall back to direct database access. The same mode is selected in packaged clients when `ENGAGEMENT_SERVICE_URL` is configured, including a deliberate loopback URL.

For a second desktop, configure only `ENGAGEMENT_SERVICE_URL` and the service certificate trust. No PostgreSQL credentials or local database settings are needed on that client. In development, an unset or loopback URL normally selects the embedded single-machine service and therefore still needs local PostgreSQL configuration; use the firm server's non-loopback HTTPS hostname to exercise service-only mode. To explicitly use a trusted service bound to loopback during development, set `ENGAGEMENT_SERVICE_ONLY=true` as well.

Legacy mode remains available when the service-only mode is not selected. It still registers direct PostgreSQL handlers with no engagement-level permission checks. Important remaining bypasses include:

- `src/main/ipc/tb.js`: entity read/write/delete, Tally and Excel imports, trial-balance list/read/edit/delete, stock and journal operations.
- `src/main/ipc/mapping.js` and `src/main/ipc/mapped-tb.js`: mapping-rule access, mapping, approval/override and adjustments.
- `src/main/ipc/financials.js`, `src/main/ipc/notes.js`, `src/main/ipc/fs-snapshot.js`: statements/PDFs, supporting disclosures and published snapshots.
- `src/main/ipc/financial-periods.js` and other legacy master/report IPC handlers: period locking/finalisation and firm master operations.

Those handlers can operate on entity-period or TB identifiers without proving access to a specific engagement. Sign-in alone does not make legacy mode engagement-isolated. Do not distribute a new unrestricted DB credential to clients or claim whole-application multi-user isolation.

### Protected Trial Balance workflow

Open an engagement from the service-connected engagement list. The overview shows only TBs explicitly linked to that engagement and its reporting period. Owners and users with edit membership can select **Import Excel**; readers and visibility-only partners/administrators can inspect linked rows but cannot import. Imports are limited to 8 MB and 100,000 ledger rows, require the standard `Name`, `OpeningBalance`, `Debit`, `Credit`, and `ClosingBalance` columns, and are parsed on the trusted server. The desktop's native picker sends the selected bytes and a basename; no local file path is sent to the server.

Each successful import creates a new `trial_balances` record and ledger rows. The source filename, SHA-256, size, importing user and timestamp are retained in `engagement_trial_balance_imports`. Re-importing byte-identical content into the same engagement is rejected without changing the existing import. Distinct concurrent uploads remain separate. Trial balance, rows, source metadata and the audit event are committed atomically. Locked or finalised periods reject imports. Imported rows remain read-only; posted journals and later final-TB snapshots do not overwrite them.

Legacy TBs can be inspected only after the owner/admin explicitly links them to this engagement through the existing confirmation workflow. Merely sharing a client entity or period does not grant an engagement access path. Cross-engagement TB IDs are rejected by the protected read API.

## Single-machine India reporting pack

The first protected reporting path is available in the engagement overview. It supports only the existing India legacy Schedule III pack with trial-balance and presentation currency both set to INR. No currency translation is performed.

1. Open an active engagement and import an Excel workbook with `Name`, `OpeningBalance`, `Debit`, `Credit`, and `ClosingBalance`. Include hierarchy columns such as `Parent` and `Group.$Parent` to help the existing India auto-mapper classify accounts.
2. Post balanced audit journals. Users with engagement edit rights can post without approval. Journal entries are retained as immutable history; the source import does not change.
3. Create a final Trial Balance. Each operation creates a new versioned snapshot from the selected import plus the posted journals through a saved journal watermark, then runs the existing India auto-mapping engine.
4. Review automatic mappings and apply manual mapping corrections where needed. Select a prior-year closing TB for comparatives by its exact reporting dates; current-year opening balances are not used as a substitute for prior-year closing balances.
5. Complete structured note details for the disclosures supported by the selected India forms, and add narrative disclosures where needed. Note identity is retained by its stable title when display numbering changes.
6. Edit and save the auditor-entered audit-report fields. The application does not infer the opinion. Enter audit-report date/place separately from financial-statement approval date/place and select the client signatories.
7. Generate one combined PDF. The desktop renders the existing India financial-statement and notes HTML together with the audit-report page, then sends the bounded PDF bytes to the trusted service for versioned persistence. Download saved versions from the panel. Output finalisation is restricted to the assigned engagement partner or authorised substitute.

The complete UI workflow has been run against a saved synthetic engagement using the isolated desktop and PostgreSQL instance. It imported current- and prior-year TBs, posted journals, created a final TB, corrected a mapping, saved structured Share Capital details, edited the audit report, and generated the combined PDF through the UI and trusted service. The assigned partner finalised the engagement/output; a subsequent journal mutation was rejected; authorised reopening retained the final output. After closing and restarting the desktop/service against the same isolated profile and database, the engagement and PDF were reopened. The downloaded PDF matched the persisted output SHA-256 (`c3cf106b101b89cc4db09d73d2866429ad702ae50fe161bd93898997e3515642`). The 10-page PDF was rendered to a contact sheet and visually inspected. Two physical desktop clients were not tested.

### Firm settings and saved report identity

Administrators can maintain the existing professional-firm master under **Settings → Firm Settings**: registration details, contact/address fields, PNG/JPEG logo (maximum 750 KB), and active status. Offices are scoped to the service firm and professional firm. Partner qualifications, registration numbers and active status extend existing firm-user records. Selecting an unlinked global auditor firm associates that existing record instead of creating a duplicate. The additive service migration creates the base `auditor_firms` table only when a minimal service-only database does not already have it, then adds the service-scoped fields.

For each engagement, users with edit access can save the responsible firm, office and branding profile, and the ordered client management signatories. The assigned partner remains the responsible engagement partner. Audit-report date/place are separate from the financial-statement approval date/place. Firm, office, logo, partner, signatory order and signing details are resolved and snapshotted with each saved output; later master edits do not rewrite a finalised PDF.

The firm-settings UI run reused the existing auditor-firm and partner records, created one firm office and a synthetic CFO signatory, saved the ordered signatories and engagement selections, and generated/finalised combined PDF version 5 through the desktop. It was reopened after restarting the desktop/service against the same `127.0.0.1:64023/fsg_engagement_demo` cluster and Electron user-data profile. Its SHA-256 is `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`, at `$env:USERPROFILE\FSG-Aditya-engagement-demo\outputs\FSG-DEMO-2025-26-firm-settings-pack-v5.pdf`. Changing the firm master afterward left the finalised PDF bytes and financial-data hash unchanged. All 10 pages were visually inspected in the PDF viewer: the audit-report page and logo/firm identity, financial-statement cover, comparative Balance Sheet and Profit and Loss, structured Share Capital and other notes, ledger annexures, and ordered management signatures.

The current retained demo also has an unfinalised version 6 produced during a repeated automation run. Its finalisation control was unavailable because the prior engagement finalisation had not been reopened first; version 5 remains finalised and intact. The automation's first full run completed the saved selections, PDF generation, finalisation, master edit and restart/reopen checks, but returned a failure during its final sign-in transition; those persistence and immutability checks were then completed separately through the UI. A repeatable all-in-one rerun should first reopen a finalised engagement through the assigned partner UI.

Independent checks reconciled the final TB; current and prior balance sheet totals; current and prior PBT/PAT; PPE, receivables, cash, revenue, depreciation, operating expense, tax, and share-capital note totals; and the structured Share Capital figures to the mapped statement amount. The comparative uses the prior-year closing TB dated 01-Apr-2024 to 31-Mar-2025. The corrected PDF has no Share Capital balance-sheet mismatch or missing-share-count EPS warning.

### Reproducible single-machine sample

On Windows, with dependencies installed and Electron available, run:

```powershell
& '.\node_modules\.bin\electron.cmd' '.\tools\synthetic-report-electron'
```

This uses synthetic-only data and the production India statement HTML builder plus Electron PDF renderer. It writes:

- `artifacts\Synthetic-Engagement-TB.xlsx` — a three-ledger import workbook for the sample client and period 01-Apr-2025 to 31-Mar-2026.
- `artifacts\Synthetic-Engagement-India-Reporting-Pack.pdf` — a seven-page sample containing an auditor-entered report, India financial statements, notes and signing page.

The sample PDF is a renderer review artifact, not a report for a real client, and is not saved into the engagement service.

### Saved engagement demo through the desktop UI

The repeatable demo harness provisions users only after verifying its dedicated PostgreSQL cluster and isolated Electron profile. It never falls back to saved Settings or the production database. Do not use the harness against any other database. Run these commands from the repository root in PowerShell:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 init
node .\tools\create-engagement-demo-fixture.mjs
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 provision-users
```

Start the desktop and embedded engagement service in one PowerShell window; leave it open:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 launch
```

In a second PowerShell window at the repository root, run the normal-login UI workflow:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 workflow-ui
.\tools\engagement-demo.ps1 finalize-ui
```

The UI automation signs in using the harness-provisioned administrator, creates `FSG-DEMO-2025-26` for the synthetic company, imports current- and prior-year workbooks, posts balanced journals, completes the reporting inputs and saves a combined PDF. It then exercises assigned-partner finalisation/reopening. The test administrator/contributor/reader/partner credentials remain in the ACL-restricted `$env:FSG_DEMO_HOME\credentials.json`; do not copy them into source or logs.

Repeat provisioning is safe: the latest run verified the existing firm and four role accounts with `accountsCreated: 0`, without resetting their passwords. `.\tools\engagement-demo.ps1 verify-ui` exercises the normal sign-in/sign-out screen for administrator, contributor, reader and partner, and confirms an incorrect password is rejected.

Close the desktop normally through its window. The disposable PostgreSQL instance remains running. Restart the same desktop/service profile using the launch command above, then in the second PowerShell window run:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 reopen-ui
```

The restart check signs in as the demo partner through the regular login page, reopens the saved engagement/output, downloads the finalised PDF via the desktop UI, and compares its hash with the service-persisted bytes. The original reporting-workflow review file is `$env:USERPROFILE\FSG-Aditya-engagement-demo\outputs\FSG-DEMO-2025-26-reporting-pack-v4.pdf`; the firm-settings review PDF is `$env:USERPROFILE\FSG-Aditya-engagement-demo\outputs\FSG-DEMO-2025-26-firm-settings-pack-v5.pdf`. Preserve the demo database/profile until any further review is complete.

With the same demo database running and the desktop open, the firm-settings UI automation is invoked from a second PowerShell window at the repository root:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 firm-settings-ui
```

After closing the desktop normally, restart it with the `launch` command above and verify the saved firm selections/output through the UI:

```powershell
$env:FSG_DEMO_HOME = Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
.\tools\engagement-demo.ps1 firm-settings-reopen-ui
```

The India demo has a finalised version 5 plus an unfinalised version 6 from a repeat attempt. Before trying to finalise a new output after a finalised engagement, reopen the engagement through the assigned-partner interface. The demo cluster and profile remain in place; do not rerun `init`.

The same persistent isolated database also contains `UAE-SAMPLE-01-2025`, a separate synthetic UAE LLC demonstration using AED current/prior Trial Balances and `AE_UAE_DEMO` mappings. The desktop produces a separate 17-page combined draft; v1–v3 remain drafts. Version 3 is retrieved after restart and retained as `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf` with SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237`. Do not represent this as an IFRS-validated or production pack. Exact restart and reopen instructions are in [DEVELOPMENT_SETUP.md](./docs/DEVELOPMENT_SETUP.md#reopen-uae-sample-01-and-its-saved-draft-pdf).

For the same-machine development path, `npm run dev` starts the embedded HTTPS service on loopback when `ENGAGEMENT_SERVICE_URL` is unset or loopback. The service uses the database settings already saved by the app and applies its additive engagement migration at service startup. Use a disposable development database; do not point this procedure at the live firm database. A remote firm service can also be used with `ENGAGEMENT_SERVICE_URL`, without desktop PostgreSQL credentials.

## First administrator on a development laptop

For local development, configure the database in the app's existing Settings screen, then run:

```powershell
npm run dev
```

When the app is an unpackaged development build and `ENGAGEMENT_SERVICE_URL` is unset or points to loopback (`localhost`/`127.0.0.1`), Electron starts the engagement service automatically on loopback using those saved database settings. This avoids depending on a separately started local service or a stale local port setting. A non-loopback `ENGAGEMENT_SERVICE_URL` continues to select the remote firm service. The embedded service creates a temporary localhost HTTPS certificate and a one-time setup authorization inside the main process; neither value needs to be copied into the UI. Open the startup first-run form to create the administrator, then sign in. Administrators can create additional firm users from **Settings → Firm Team**.

The startup sign-in page provides a limited **Configure database** flow if the saved connection cannot start the local service. Once the database is saved and connected, the app starts the local service and returns to first-run setup. This pre-login configuration flow only exposes database connection fields; it does not expose the settings screen's database export features.

Local auto-start requires OpenSSL, available with Git for Windows or installed at `C:\Program Files\OpenSSL-Win64\bin\openssl.exe`. The service applies its additive schema migration to the configured database at startup, so back up any existing development database before the first run. This local mode is for a single developer machine only; it is not a substitute for the separately hosted HTTPS service. Setting `ENGAGEMENT_SERVICE_URL` disables the embedded service and uses the remote setup-token flow described above.

## Disposable integration test

From the repository root on Windows, with Node.js, PostgreSQL binaries under `C:\Program Files\PostgreSQL\<version>\bin`, and OpenSSL available at one of the paths in the test:

```powershell
npm run engagement:test
```

The test creates a temporary PostgreSQL cluster, starts the local-development HTTPS service against that disposable database, exercises it with synthetic fixtures/workbooks, stops the cluster, and removes its temporary files. It never reads the configured application DB settings or connects to the live database. The latest run passed 94 assertions covering migration/repeated startup, persistence, password setup/change, read/edit and partner/admin/substitute permissions, revocation/disabled users, privacy-safe duplicate checks, legacy trial-balance linking, activation/finalisation/reopening, validated Excel import, TB identifier isolation, locked/finalised rejection, concurrent/repeated import handling, source metadata, journal posting, final-TB versioning/mapping, firm/office/partner selections, report identity snapshots, output permissions, and rollback when audit insertion fails. Its PDF persistence check uses synthetic valid PDF bytes; the actual desktop-rendered workflow is verified separately above.

The latest validation passed `npm run isolation:test` (23 assertions), `npm run build`, `node tools/selftest-fs-snapshot.mjs`, and `node tools/selftest-final-signing.mjs`. Physical two-client UAT is deferred. No live database migration, push or merge was performed.

The service uses in-memory bearer sessions: restart logs all clients out. Deploy a process supervisor and monitor service/DB health before firm use. `/health` reports process availability, not database readiness.

## Synthetic manual UAT

Run only against a disposable database restored from an approved backup or a dedicated test fixture:

1. Start the service with a temporary database URL, trusted test TLS certificate, and a one-time setup token.
2. Open the desktop with `ENGAGEMENT_SERVICE_URL` set. Create the first administrator through the desktop startup form, then sign in. Remove the setup token from the service environment and restart it.
3. Create synthetic staff, partner, and substitute users. Sign into each client using its own account and change each initial password.
4. As an admin, create a synthetic client/engagement with an owner, partner, substitute, and read/edit participants. Try to spoof `userId` or `role` in request data; access must remain tied to the authenticated account.
5. Verify an invited reader can view but not edit; an editor can edit; an owner can grant/revoke; partners/admins can see all but do not gain edit/finalisation from visibility alone; only the assigned partner/substitute can finalise or reopen.
6. Create a second engagement for the same client/period without a reason and verify the generic duplicate warning; repeat with a reason and verify the reason is recorded. Repeat simultaneous creates and confirm exactly one succeeds without a reason.
7. Link a synthetic unlinked legacy trial balance explicitly and compare its amounts/mappings/notes/signing selections before and after. Confirm legacy setup before activating. In service-only mode, import a synthetic Excel TB, inspect rows as a reader, verify import is refused for that reader, and verify the legacy mapping/journal/reporting tabs are unavailable.
8. Disable a test user and verify their active session is rejected. Revoke an editor and verify their next TB list/read/import request is denied. Restart the service, sign in again, and confirm engagements and TB imports remain saved.
9. On a second physical desktop, configure only the HTTPS service URL and certificate trust, sign in as the synthetic reader/editor, and repeat the import/inspection checks. Record this separately from the automated API tests.

Do not perform this UAT against the live firm database. Automated HTTPS tests do not establish physical two-client UAT. Before whole-application multi-user production use, all legacy DB and IPC operations must be migrated behind permission-enforced server APIs.

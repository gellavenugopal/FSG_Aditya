# Engagement service operations and UAT

This service handles the new engagement operations. It does not secure the rest of the desktop application: legacy financial IPC still connects directly to PostgreSQL and does not enforce engagement permissions. Do not treat this milestone as multi-user production isolation.

## Desktop sign-up and sign-in

The desktop now opens with firm sign-in instead of the financial workspace. When the firm has no administrator, the first-run screen lets the authorized operator create the firm administrator; the new administrator then signs in with that account. Only the first administrator can sign up through first-run setup; this is not open public registration.

After sign-in, use **Settings → Engagements** for client engagements and **Settings → Firm Team** to add colleagues. Team positions are Employee, Article assistant, Auditor, and Partner. Employee/article/auditor are directory labels with standard staff permissions; Partner is also a permission role. Finalisation still requires assignment as the engagement partner or authorised substitute. Creating a team account displays a one-time password to share securely; automatic email invitations are not implemented.

The engagement client keeps the service session after an authentication-status refresh. If a session expires, sign in again; engagement reads and edits continue to be checked by the trusted service.

The startup screen is an application-entry gate, not complete authorization for legacy data. Legacy financial IPC still has direct PostgreSQL access and does not enforce per-user engagement permissions. Do not treat the login gate as securing those operations or as production-ready multi-user isolation.

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
4. Review the mapping results and report inputs. The panel currently supports automatic mapping and inspection only; manual mapping overrides are not yet available through the protected service.
5. Edit and save the auditor-entered audit-report fields. The application does not infer the opinion. Enter audit-report date/place separately from financial-statement approval date/place, select the client signatories, and add separate narrative note disclosures as needed.
6. Generate one combined PDF. The desktop renders the existing India financial-statement and notes HTML together with the audit-report page, then sends the bounded PDF bytes to the trusted service for versioned persistence. Download saved versions from the panel. Output finalisation is restricted to the assigned engagement partner or authorised substitute.

Current limitations: the protected panel does not migrate the existing structured note fill-details forms, provide manual mapping corrections, or select a comparative Trial Balance. The renderer can consume saved note-detail records, but those forms are not editable through this panel. The PDF persistence integration test uses a synthetic valid PDF; Electron rendering is separately verified with the synthetic report script below, not by full end-to-end UI UAT.

### Reproducible single-machine sample

On Windows, with dependencies installed and Electron available, run:

```powershell
& '.\node_modules\.bin\electron.cmd' '.\tools\synthetic-report-electron'
```

This uses synthetic-only data and the production India statement HTML builder plus Electron PDF renderer. It writes:

- `artifacts\Synthetic-Engagement-TB.xlsx` — a three-ledger import workbook for the sample client and period 01-Apr-2025 to 31-Mar-2026.
- `artifacts\Synthetic-Engagement-India-Reporting-Pack.pdf` — a seven-page sample containing an auditor-entered report, India financial statements, notes and signing page.

The sample PDF is a renderer review artifact, not a report for a real client, and is not saved into the engagement service. To create a persistent sample through the application, use only a disposable local PostgreSQL database: configure the local connection in development Settings, run `npm run dev`, complete first-admin setup/sign-in, create a synthetic India engagement for `2025-04-01` through `2026-03-31`, import the sample workbook, post balanced journals (Dr Synthetic Expense / Cr Synthetic Capital for 15.00 and again for 5.00), create the final TB, enter synthetic auditor/report/signatory details, then generate and download the combined PDF.

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

The test creates a temporary PostgreSQL cluster, starts the local-development HTTPS service against that disposable database, exercises it with synthetic fixtures/workbooks, stops the cluster, and removes its temporary files. It never reads the configured application DB settings or connects to the live database. The latest run passed 82 assertions covering migration/repeated startup, persistence, password setup/change, read/edit and partner/admin/substitute permissions, revocation/disabled users, privacy-safe duplicate checks, legacy trial-balance linking, activation/finalisation/reopening, validated Excel import, TB identifier isolation, locked/finalised rejection, concurrent/repeated import handling, source metadata, journal posting, final-TB versioning/mapping, report settings/output permissions, and rollback when audit insertion fails. It does not render a PDF through Electron.

The latest validation also passed `npm run build`, `node tools/selftest-fs-snapshot.mjs`, and `node tools/selftest-final-signing.mjs`. Physical two-client UAT is deferred. No live database migration, push or merge was performed.

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

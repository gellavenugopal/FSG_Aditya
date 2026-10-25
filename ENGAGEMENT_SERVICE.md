# Engagement service operations and UAT

This service handles the new engagement operations. It does not secure the rest of the desktop application: legacy financial IPC still connects directly to PostgreSQL and does not enforce engagement permissions. Do not treat this milestone as multi-user production isolation.

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

This setting only routes engagement IPC through the trusted service. The existing desktop still opens its legacy PostgreSQL connection for Trial Balance, mapping, statements, notes, and other operations. Therefore it still requires its legacy DB configuration and retains the existing permission bypasses. Do not distribute a new unrestricted DB credential to clients to make this feature work; this implementation has not migrated or isolated those legacy operations. A service-only client/UI mode that can run without the legacy DB connection is not included.

## Disposable integration test

From the repository root on Windows, with Node.js, PostgreSQL binaries under `C:\Program Files\PostgreSQL\<version>\bin`, and OpenSSL available at one of the paths in the test:

```powershell
npm run engagement:test
```

The test creates a uniquely named temporary PostgreSQL cluster and self-signed test certificate, exercises the real HTTPS service with synthetic fixtures, stops the cluster, and removes its temporary files. It never reads the configured application DB settings or connects to the live database. It covers migration/repeated startup, persistence, password setup/change, read/edit and partner/admin/substitute permissions, revocation/disabled users, privacy-safe duplicate checks, legacy trial-balance linking, activation/finalisation/reopening, duplicate races, separate reasons, and rollback when audit insertion fails.

The service uses in-memory bearer sessions: restart logs all clients out. Deploy a process supervisor and monitor service/DB health before firm use. `/health` reports process availability, not database readiness.

## Synthetic manual UAT

Run only against a disposable database restored from an approved backup or a dedicated test fixture:

1. Start the service with a temporary database URL, trusted test TLS certificate, and a one-time setup token.
2. Open the desktop with `ENGAGEMENT_SERVICE_URL` set. Complete first administrator setup, then remove the setup token from the service environment and restart it.
3. Create synthetic staff, partner, and substitute users. Sign into each client using its own account and change each initial password.
4. As an admin, create a synthetic client/engagement with an owner, partner, substitute, and read/edit participants. Try to spoof `userId` or `role` in request data; access must remain tied to the authenticated account.
5. Verify an invited reader can view but not edit; an editor can edit; an owner can grant/revoke; partners/admins can see all but do not gain edit/finalisation from visibility alone; only the assigned partner/substitute can finalise or reopen.
6. Create a second engagement for the same client/period without a reason and verify the generic duplicate warning; repeat with a reason and verify the reason is recorded. Repeat simultaneous creates and confirm exactly one succeeds without a reason.
7. Link a synthetic unlinked legacy trial balance explicitly and compare its amounts/mappings/notes/signing selections before and after. Confirm legacy setup before activating. Verify the legacy financial entry remains unavailable from the engagement screen.
8. Disable a test user and verify their active session is rejected. Restart the service, sign in again, and confirm the engagement remains saved.

Do not perform this UAT against the live firm database. Before multi-user production use, all legacy DB and IPC operations need to be migrated behind permission-enforced server APIs, and a desktop mode that no longer distributes unrestricted DB access must be completed.

# Engagement Foundation — Implementation Plan

## Repository findings

- The existing client entity is `entities`; its reporting periods are global `financial_periods` attached through `entity_periods`. Trial balances already reference both the client entity and (optionally) that period anchor.
- Period locking/finalisation lives on `entity_periods`; existing auditors, signatories and global auditor masters are professional records, not application-user identities.
- Legacy Electron operations still own direct PostgreSQL access and expose broad operations through IPC. The engagement service now supplies a separate trusted HTTPS boundary for the new engagement routes; it does not isolate the legacy financial routes or remove the desktop's legacy DB configuration.
- Statement generation reads existing Trial Balance/mapped data and snapshots publish against `entity_periods`. Preserve those tables and values; link engagements additively.

## Stages

1. Additive schema for firm users, firm roles, engagements, one-or-more reporting sets, memberships, access requests, audit history, and explicit legacy-period links. Keep client entities, professional masters, and `entity_periods` distinct.
2. Run engagement operations on a separate firm-hosted HTTPS service. The service owns the engagement DB connection, additive migration, password/session authentication, server-authorized first administrator setup, permission checks, restricted-safe duplicate responses, audit history, and concurrent duplicate serialization. Desktop engagement IPC is a service client and no longer runs the engagement DB handlers directly.
3. Add the engagement list, guided create flow, and overview. Drafts may be incomplete; activation is restricted to the implemented India reporting pack and validates required fields. Existing India work is linked explicitly and remains marked unconfirmed where parameters are unknown.
4. Test against disposable PostgreSQL with a representative legacy schema. Verify migration/restart, persistence, password handling, visibility/edit/finalisation permissions, access revocation, legacy links, duplicate races, audit rollback, and disclosure boundaries. Compare synthetic India figures and signing behavior using the existing financial self-tests. Document the server/client configuration and remaining legacy isolation gap.

## Security and migration boundary

The engagement HTTPS API is a firm-hosted trusted service. Only this service receives its engagement DB configuration, and the Electron engagement handlers proxy to it. The desktop still initializes the legacy DB client and its legacy financial IPC handlers remain callable without engagement authorization. Do not treat this slice as whole-application isolation or production-ready multi-user deployment. Migrating all legacy DB and IPC operations behind permission-enforced server APIs is still a prerequisite. Do not infer legacy ownership, partner assignment, or reporting basis.

## Implementation and verification status

- The additive schema, service-side setup/login and engagement authorization handlers, HTTPS desktop proxy, preload API, and Engagements list/create/overview screens are implemented on the feature branch.
- Desktop startup now presents first-administrator sign-up or firm sign-in before showing the existing workspace. First-admin creation returns to sign-in; administrator account provisioning remains in Engagements. Local development includes a limited database-connection setup/retry flow. This is a UI entry gate only and does not remove the documented authorization bypass in legacy financial IPC.
- Legacy trial balances already attached to the selected `entity_periods` remain on that anchor. Unlinked trial balances are listed for owner/admin review and only linked after explicit selection; trial-balance amounts and rows are not changed.
- `npm run engagement:test` passed against disposable PostgreSQL 18. It tests the HTTPS service, additive migration/repeated startup, persistence, password handling, owner/reader/editor/partner/admin/substitute permissions, access revocation, disabled users, privacy-safe duplicates/access requests, explicit legacy linking, activation/finalisation/reopening, concurrent duplicate creation, separate reasons, and atomic audit rollback. It never uses the configured application DB.
- Integration testing found and corrected participant-grant parsing, date-only parsing across PostgreSQL/JavaScript time zones, and timestamp precision during reopening. The service and operational/UAT instructions are in `ENGAGEMENT_SERVICE.md`.
- India compatibility passed with synthetic records for unchanged legacy trial-balance figures/classifications/comparatives, note links, and signatory selection across migration and explicit TB linking. `tools/selftest-fs-snapshot.mjs` passed on both baseline commit `9fae9b9` and the current worktree against the same fixed synthetic expectations: current/prior revenue, PAT/PBT/tax, Balance Sheet line classifications and totals, note rows/totals, the note-to-face mapping, auditor/signatory selections, and the published snapshot schema. `tools/selftest-final-signing.mjs` also passed against a disposable PostgreSQL cluster.
- This service is testable from a second client using `ENGAGEMENT_SERVICE_URL`, but complete desktop use still depends on the legacy direct DB configuration. No live DB migration, merge, or push was performed.

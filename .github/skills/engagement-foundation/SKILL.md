---
name: engagement-foundation
description: "Use when continuing the FSG Aditya engagement foundation, trusted engagement service, permissions, service-only desktop mode, Trial Balance import/inspection, related PostgreSQL migrations, or engagement UAT."
---

# Continue the Engagement Foundation

Use this workflow for changes to the engagement service or its protected desktop workflow.

## Read the project state first

1. Read the repository [ENGAGEMENT_FOUNDATION_PLAN.md](../../../ENGAGEMENT_FOUNDATION_PLAN.md) and [ENGAGEMENT_SERVICE.md](../../../ENGAGEMENT_SERVICE.md).
2. Check `git status`, current branch, and recent commits. The last recorded milestone commit is `9c0427f` on `feature/engagement-foundation`; the branch may have advanced.
3. Inspect actual code and repository instructions before assuming the documentation still matches the implementation.

## Current protected scope

- Firm-hosted HTTPS service with server-side authentication and engagement authorization.
- Engagement list/create/open/overview, access membership and audit history.
- Protected Trial Balance list/import/read. Excel bytes are selected locally and transferred through the desktop main process; do not send a client filesystem path.
- Imports are bounded, validated, and create new records in `trial_balances` / `tb_rows`. Source filename, size, SHA-256 and importer are retained. Same-file reimports are rejected; import, rows, metadata and audit are atomic.
- TB list/read is engagement-bound. Verify firm, engagement membership, reporting set, `entity_periods`, entity, TB link, lock/finalisation state, and authenticated user on the trusted service.
- Protected reporting also supports journal posting, versioned final-TB snapshots, existing India auto-mapping, report inputs/settings, narrative note disclosures, and combined-PDF persistence/finalisation.
- The first reporting pack is India legacy Schedule III with INR/INR only. Manual mapping overrides, structured note fill-details editing, comparative TB selection, non-India packs and currency translation are not implemented.
- In service-only mode the desktop must not initialize its legacy PostgreSQL client or register legacy financial handlers. Unmigrated operations must remain unavailable, with no fallback.

## Non-negotiable boundaries

- Do not infer engagement access from entity access or shared client/period data.
- Do not grant editing or finalisation just because a partner or administrator can see an engagement. Only the assigned partner/authorised substitute finalises or reopens.
- Preserve existing data, India calculations, trial-balance sign conventions, reporting behavior and `entity_periods`; changes to schema are additive.
- Legacy mode still has direct-database IPC bypasses. Do not claim whole-application isolation or production readiness. Keep the known gaps current in both project docs.
- Never use the configured/live database for tests or migrations. Use disposable PostgreSQL and synthetic files.
- Do not push, merge, or alter the default branch unless explicitly requested.

## Implementation and verification

1. Identify every affected surface: service route, server handler, DB schema, preload/client proxy, renderer, documentation and tests.
2. Enforce authorization in the trusted service; renderer hiding is not authorization.
3. Keep upload bounds and parsing/validation on the server. Preserve original source metadata and make duplicate behavior explicit.
4. Add tests for permission variants, cross-engagement IDs, lock/finalise behavior, rollback, concurrent requests, restart persistence and revoked access when relevant.
5. Run `npm run engagement:test`, `npm run build`, and the applicable India regression commands: `node tools/selftest-fs-snapshot.mjs` and `node tools/selftest-final-signing.mjs`. For PDF work, render the synthetic pack with `& '.\node_modules\.bin\electron.cmd' '.\tools\synthetic-report-electron'` and inspect the resulting PDF.
6. Report exact test commands/results, known bypasses, whether physical two-client UAT was performed, and commit status. Never describe API automation or the standalone synthetic renderer as full UI or physical UAT.

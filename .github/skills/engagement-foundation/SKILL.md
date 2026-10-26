---
name: engagement-foundation
description: "Use when continuing the FSG Aditya engagement foundation, trusted engagement service, permissions, service-only desktop mode, Trial Balance import/inspection, related PostgreSQL migrations, or engagement UAT."
---

# Continue the Engagement Foundation

Use this workflow for changes to the engagement service or its protected desktop workflow.

## Read the project state first

1. Read the repository [ENGAGEMENT_FOUNDATION_PLAN.md](../../../ENGAGEMENT_FOUNDATION_PLAN.md) and [ENGAGEMENT_SERVICE.md](../../../ENGAGEMENT_SERVICE.md).
2. Check `git status`, current branch, and recent commits. Recent milestones include `3195621`, `8a3dd70`, `0db77a2`, and `9ce8abe` on `feature/engagement-foundation`; inspect actual branch state before assuming what is committed.
3. Inspect actual code and repository instructions before assuming the documentation still matches the implementation.

## Current protected scope

- Firm-hosted HTTPS service with server-side authentication and engagement authorization.
- Engagement list/create/open/overview, access membership and audit history.
- Protected Trial Balance list/import/read. Excel bytes are selected locally and transferred through the desktop main process; do not send a client filesystem path.
- Imports are bounded, validated, and create new records in `trial_balances` / `tb_rows`. Source filename, size, SHA-256 and importer are retained. Same-file reimports are rejected; import, rows, metadata and audit are atomic.
- TB list/read is engagement-bound. Verify firm, engagement membership, reporting set, `entity_periods`, entity, TB link, lock/finalisation state, and authenticated user on the trusted service.
- Protected reporting also supports journal posting, versioned final-TB snapshots, existing India auto-mapping and manual corrections, report inputs/settings, structured and narrative note disclosures, prior-year comparative selection, and combined-PDF persistence/finalisation.
- The first reporting pack is India legacy Schedule III with INR/INR only. Non-India packs and currency translation are not implemented.
- In service-only mode the desktop must not initialize its legacy PostgreSQL client or register legacy financial handlers. Unmigrated operations must remain unavailable, with no fallback.
- One complete synthetic client/one-computer desktop workflow has been verified through UI: imports, journals, final TB, mapping, structured notes, auditor-entered report, combined PDF, finalisation, lock rejection, reopening, application/service restart and saved-PDF retrieval. PDF version 4 SHA-256: `c3cf106b101b89cc4db09d73d2866429ad702ae50fe161bd93898997e3515642`.
- The review PDF is retained under the disposable profile at `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\FSG-DEMO-2025-26-reporting-pack-v4.pdf`. Preserve the cluster/profile until review is complete; do not recreate or delete the demo as part of routine validation.
- Exact harness setup, startup, workflow and restart commands are maintained in [ENGAGEMENT_SERVICE.md](../../../ENGAGEMENT_SERVICE.md#saved-engagement-demo-through-the-desktop-ui).

## Non-negotiable boundaries

- Do not infer engagement access from entity access or shared client/period data.
- Do not grant editing or finalisation just because a partner or administrator can see an engagement. Only the assigned partner/authorised substitute finalises or reopens.
- Preserve existing data, India calculations, trial-balance sign conventions, reporting behavior and `entity_periods`; changes to schema are additive.
- Legacy mode still has direct-database IPC bypasses. Do not claim whole-application isolation or production readiness. Keep the known gaps current in both project docs.
- The preliminary `vera_financial` isolation incident remains unresolved; never connect, migrate, restore, or inspect that database without separate authorization. The single-machine demo used only the dedicated temporary cluster and isolated Electron profile.
- Never use the configured/live database for tests or migrations. Use disposable PostgreSQL and synthetic files.
- Do not push, merge, or alter the default branch unless explicitly requested.

## Implementation and verification

1. Identify every affected surface: service route, server handler, DB schema, preload/client proxy, renderer, documentation and tests.
2. Enforce authorization in the trusted service; renderer hiding is not authorization.
3. Keep upload bounds and parsing/validation on the server. Preserve original source metadata and make duplicate behavior explicit.
4. Add tests for permission variants, cross-engagement IDs, lock/finalise behavior, rollback, concurrent requests, restart persistence and revoked access when relevant.
5. Run `npm run engagement:test`, `npm run isolation:test`, `npm run build`, and the applicable India regressions: `node tools/selftest-fs-snapshot.mjs` and `node tools/selftest-final-signing.mjs`. The latest recorded results are 87 engagement-service assertions and 23 isolation assertions. For changes to the UI workflow, use the actual isolated desktop harness and visually inspect the saved combined PDF; a standalone renderer or synthetic API persistence test does not substitute for that.
6. Report exact test commands/results, known bypasses, whether physical two-client UAT was performed, and commit status. One-computer UI verification is not physical multi-computer UAT.

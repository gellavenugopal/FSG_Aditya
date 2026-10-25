# FSG Aditya Workspace Guidance

## Start with current context

- Read [ENGAGEMENT_FOUNDATION_PLAN.md](../ENGAGEMENT_FOUNDATION_PLAN.md) for architecture, implementation status, tested scope, and known access boundaries.
- Read [ENGAGEMENT_SERVICE.md](../ENGAGEMENT_SERVICE.md) before changing service startup, authentication, deployment, database setup, or UAT instructions.
- Check the current branch, worktree, and recent commits before editing. The protected Trial Balance milestone was committed as `9c0427f`; do not assume it is still HEAD.
- `CLAUDE.md` contains additional product and legacy India workflow context. Keep it consistent when those facts change.

## Architecture and safety

- Stack: Electron/electron-vite, React, Tailwind, and PostgreSQL. Main-process IPC lives in `src/main/ipc/`; renderer APIs are exposed via `src/preload/index.js`.
- The trusted engagement HTTPS service is `src/server/engagement-server.js`; desktop service proxy is `src/main/ipc/engagement-client.js`; permission-checked engagement operations are in `src/main/ipc/engagements.js`.
- The engagement service is authoritative for engagement identity and permissions. Never trust renderer-supplied user IDs, roles, or permission claims.
- Preserve the existing India reporting behavior, `entity_periods` anchor, legacy financial data, sign conventions, and additive migration strategy.
- Service-only mode must not initialize desktop PostgreSQL or register unprotected legacy financial IPC. Never add a silent fallback to legacy handlers when a service request fails.
- The protected India workflow now includes import/inspection, journals, final-TB snapshots, existing auto-mapping, report settings/data, note narrative disclosures and versioned combined PDF operations. Manual mapping overrides, structured note-form editing and comparative TB selection remain unavailable in this slice.
- Do not present legacy mode as engagement-isolated or production-ready multi-user isolation. Track all remaining direct-database IPC bypasses in the project handoff.
- Never migrate, test against, or modify the live database. Use disposable PostgreSQL fixtures and synthetic data only. Do not push, merge, or alter the default branch unless explicitly asked.

## Validation

- Build: `npm run build`
- Engagement service integration: `npm run engagement:test`
- India regressions: `node tools/selftest-fs-snapshot.mjs` and `node tools/selftest-final-signing.mjs`
- Synthetic Electron report render: `& '.\node_modules\.bin\electron.cmd' '.\tools\synthetic-report-electron'`
- Run relevant checks serially if temporary PostgreSQL test clusters conflict on Windows. A check only passes when it exits successfully, including cleanup.
- Do not claim physical two-client UAT unless two actual desktop clients were used.

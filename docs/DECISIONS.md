# Decisions

This log separates user-approved product/scope decisions from engineering proposals. A later decision must be added as a dated entry; do not silently rewrite or replace an earlier decision. If a decision changes, retain the prior entry and record the superseding decision and reason.

## User-approved decisions

### 2026-10-26 — Finish one-client reporting before deployment expansion

- **Decision:** Prioritise a complete reporting pack for one client on one computer: trial balance, journals, final TB, mapping, financial statements, notes, audit report and one assembled PDF.
- **Rationale:** Deliver a usable end-to-end output before expanding infrastructure or conducting multi-computer UAT.
- **Status:** Active. Single-machine workflow is implemented and has saved-output restart/reopen evidence; continue product corrections and gaps in [CURRENT_STATUS.md](./CURRENT_STATUS.md).

### 2026-10-26 — Keep the service architecture; use the same machine

- **Decision:** Retain the engagement service architecture; service and desktop may run on the same computer for this milestone. Do not redesign deployment or require second-client testing.
- **Rationale:** Validate product workflow without discarding the trusted service boundary.
- **Status:** Active.

### 2026-10-26 — Preserve accounting history and India behavior

- **Decision:** Editors may post journals without approval. Preserve imported balances and immutable journal history; create versioned final-TB snapshots. Reuse existing India calculations, mapping and disclosure forms. Audit opinion is entered by the auditor, not inferred.
- **Rationale:** Maintain an auditable financial foundation and avoid changing established accounting behavior.
- **Status:** Active.

### 2026-10-26 — Isolate development and leave production impact unresolved

- **Decision:** Use only the explicitly selected disposable PostgreSQL cluster and isolated Electron profile for development/testing. Do not connect to `vera_financial`, use saved production settings, restore backups, reverse migrations, push or merge without separate instruction.
- **Rationale:** Existing-data impact from the earlier database-isolation incident has not been established.
- **Status:** Active. The production incident remains unresolved.

### 2026-10-26 — Keep the product sequence explicit

- **Decision:** Preserve India first, then UAE IFRS, India Ind AS and US GAAP; defer currency translation and multi-computer UAT until a complete single-client pack exists.
- **Rationale:** Sequence work by supported reporting outcome rather than infrastructure expansion.
- **Status:** Active. **UAE Sample 01** is the first UAE synthetic case; no client files are to be committed for it.

## Engineering proposals and operational choices

### 2026-10-26 — Enforce engagement authorization at the trusted service

- **Proposal:** Keep authentication, engagement membership checks and permission enforcement in the trusted service; renderer controls are not an authorization boundary.
- **Rationale:** A desktop UI can be bypassed. Authorization must be checked server-side on each protected operation.
- **Status:** Implemented for protected engagement operations. Legacy IPC bypasses remain; see [ARCHITECTURE.md](./ARCHITECTURE.md).

### 2026-10-26 — Require a manifest-bound disposable test target

- **Choice:** Disposable mode requires complete explicit configuration, a harness-authored target manifest, a dedicated cluster and a separate Electron `userData` directory. It rejects production identity before connection and verifies server/database identity after connection.
- **Rationale:** Database-name prefixes and APPDATA overrides alone are insufficient isolation safeguards.
- **Status:** Implemented and covered by the isolation self-test; this does not resolve the historic production-data incident.

### 2026-10-26 — Guard the Vite CLI output boundary

- **Choice:** Preload EPIPE-specific handling into the `electron-vite` process because its Vite logger owns renderer HMR logging. Preserve bounded diagnostics in the isolated profile and leave unrelated errors visible.
- **Rationale:** Handling only launcher and Electron-main streams does not cover the Vite CLI's own logger.
- **Status:** Implemented in commit `666b110`; isolated CLI and desktop-launcher disconnect tests pass. The historical popup PID/stack was not captured, so the original incident's exact process is not established.

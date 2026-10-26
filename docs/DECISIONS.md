# Decisions

This log separates user-approved product/scope decisions from engineering proposals. A later decision must be added as a dated entry; do not silently rewrite or replace an earlier decision. If a decision changes, retain the prior entry and record the superseding decision and reason.

## User-approved decisions

### 2026-10-26 — Prioritise UAE Sample 01 client demonstration

- **Decision:** Build one complete UAE client demonstration using a synthetic AED dataset. Supplied client documents may be used as references only and must not be committed. Preserve the verified India workflow and its finalised PDFs. Keep UAE output explicitly identified as demonstration material until reporting coverage is validated.
- **Rationale:** A UAE demonstration is scheduled in two days; a reliable saved, repeatable application walkthrough is more valuable than additional infrastructure in the immediate milestone.
- **Scope:** UAE LLC; year ended 31 December 2025 with 2024 comparatives; separate statements, notes, editable auditor-entered report, selected firm/office/logo/partner/signatories, and a combined saved PDF. Use an AED trial balance with explicit debit/credit sign normalization; do not implement currency translation.
- **Status at decision:** Active and not yet implemented; the India-only reporting panel did not support UAE at that point. See the later 2026-10-26 status entry “Keep UAE Sample 01 synthetic and demonstration-only” for the limited demo delivery. Use synthetic data if references are unavailable or unreconciled; do not represent synthetic figures as client accounts or claim complete IFRS compliance.

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

### 2026-10-26 — Defer broad migration and extended EPIPE investigation

- **Decision:** For the UAE demonstration window, defer broad legacy IPC/database migration and extended EPIPE investigation unless they block the isolated demonstration. Preserve their known gaps and prior findings.
- **Rationale:** Protect the short-term demonstration schedule and avoid unrelated scope expansion.
- **Status:** Active for this milestone only. This does not resolve the production-data incident, remove legacy authorization bypasses, or establish that the historical EPIPE popup is resolved.

### 2026-10-26 — Keep UAE Sample 01 synthetic and demonstration-only

- **Decision:** Use a separate synthetic UAE LLC engagement with AED balances for the demonstration; keep the output labelled “Draft for demonstration.” Do not present the sample as client accounts, complete IFRS compliance or a production-validated reporting pack.
- **Rationale:** The saved desktop workflow is useful for demonstration, but its reporting coverage has not been validated against UAE client records or a complete IFRS requirements set.
- **Status:** Implemented and verified as a limited draft-only path. The saved v3 PDF was reopened after restart and visually inspected. Broader UAE/IFRS validation remains planned; this entry does not supersede the earlier India → UAE IFRS → India Ind AS → US GAAP sequence.

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

# Architecture

This document describes current repository behavior. “Implemented” does not mean all legacy application paths are isolated. Detailed service routes and procedures are in [ENGAGEMENT_SERVICE.md](../ENGAGEMENT_SERVICE.md).

## Desktop and service boundaries

### Implemented

- Electron main process: `src/main/`; React renderer: `src/renderer/src/`; preload bridge: `src/preload/index.js`.
- `src/server/engagement-server.js` exposes authenticated HTTPS service routes. It registers the protected handlers in `src/main/ipc/engagements.js` and uses `src/server/engagement-db.js` for its PostgreSQL connection.
- Desktop engagement calls are exposed through the preload allowlist and proxied by `src/main/ipc/engagement-client.js`. In service-only mode, legacy DB startup and legacy financial IPC registration are skipped.
- The supported local demo uses the same machine for Electron and the embedded service but still binds the service to the isolated test configuration. Do not confuse normal development mode with service-only isolation.
- Disposable test startup validates all required settings against the harness manifest before connection, sets Electron's effective `userData` path before reading application configuration, checks database identity before schema setup, and disables legacy initialization and IPC.

### Partially implemented

- The service owns permission-checked engagement workflows, but the rest of the desktop is not fully migrated behind this authorization boundary.
- Firm-hosted HTTPS service instructions exist, but the full production identity, operations and migration separation story is not complete. Do not infer production readiness from a successful one-machine demonstration.

## Data relationships

### Existing accounting foundation

- `entities` is the client/entity master.
- `financial_periods` stores period masters; `entity_periods` associates periods with entities and retains lock/finalisation state.
- `trial_balances` and `tb_rows` remain the accounting source records. Mapping output and India statements reuse existing structures and calculations.
- Existing professional masters such as `auditor_firms`, `global_signatories` and entity signatories are distinct from firm application users.

### Additive engagement data

The additive definitions and upgrades live in `src/main/db/engagement-schema.js`:

- `firm_users` belongs to `firms` and carries credentials and firm roles.
- `engagements` belongs to a firm and references an `entities` row; it records owner, assigned partner/substitute, reporting dates and status.
- `engagement_reporting_sets` connects an engagement to its `entity_periods` anchor and selected reporting pack/template, currencies, prior-year TB, responsible firm/office, branding firm and ordered management signatories.
- `engagement_memberships` grants engagement-specific `read` or `edit` access. Access requests are separate records.
- `engagement_trial_balance_imports` links an immutable import's source metadata to the existing `trial_balances` row. Imported ledger lines remain in `tb_rows`.
- `engagement_journals` and `engagement_journal_lines` preserve posted journal history. Final-TB snapshots are stored separately in `engagement_final_tb_snapshots`, with journal watermark/version information.
- `engagement_uae_demo_mappings` stores separate, engagement-authorized statement mappings for the limited UAE demonstration; it does not change India mapping rules.
- `engagement_audit_report_settings` stores editable auditor-authored report inputs. `engagement_report_outputs` persists versioned PDF bytes and output identity/signing snapshots.
- `engagement_audit_log` records protected workflow actions. Legacy links are explicit (`engagement_legacy_links`, `engagement_legacy_tb_links`); shared entity/period membership does not create access by itself.
- Professional firm/office/partner selections extend existing firm masters and snapshot selected identity in saved outputs so later master edits do not rewrite finalized output.
- Saved report-output listing returns the approval date, approval place and ordered signatory IDs from each output's signing snapshot. The renderer restores these values for the selected final-TB version after restart; it does not infer them from current master settings.

Schema changes are additive. Do not replace the legacy accounting tables or infer historical ownership/period relationships.

## Reporting path

### Implemented

The protected path imports current/prior TBs, posts balanced journals without an approval queue for editors, creates final-TB snapshots, runs the existing India mapping engine, permits manual mapping correction, supports supported structured and narrative disclosures, selects prior-year closing TB comparatives, and collects auditor-entered report text and separate report/financial-statement approval dates.

The desktop reuses the India financial statement/notes builders and Electron PDF renderer. It persists combined PDF versions through the service. The existing protected pack is India legacy Schedule III with INR/INR only and performs no currency translation. Generated PDFs are drafts until the assigned partner or authorised substitute explicitly finalises them; the UI marks draft and finalised outputs distinctly. Finalised engagement state is not reopened automatically.

### Limited UAE demonstration

- `AE_UAE_DEMO` is implemented only as a synthetic UAE LLC demonstration path; it is not a general UAE or IFRS reporting engine.
- `src/renderer/src/components/Engagements/uaeDemoReporting.js` derives its supported statement totals, cash flows and notes from saved current/prior final-TB rows plus the saved UAE account mappings. It normalizes the repository's negative-debit/positive-credit convention, checks balance/reconciliation, and builds a separate AED report layout rather than relabelling the India report.
- The same builder now includes a narrow revaluation-OCI branch used by deterministic synthetic test-bed cases. A controlled PPE revaluation increase is presented outside profit or loss, accumulated as a revaluation surplus and excluded from cash-flow totals as non-cash. This case is covered by fixture tests only; it is not a general IAS 16 engine.
- The mapping save operation is authorized by the engagement service and persists to `engagement_uae_demo_mappings`. Report output uses the selected firm/office/branding/signatories and saved auditor inputs; the resulting combined PDF remains a versioned service output.
- UAE Sample 01 is synthetic AED data, clearly marked “Draft for demonstration.” Saved v5 is the current visually inspected 17-page draft; v3 is preserved as the original baseline. Verification and hashes are recorded in [CURRENT_STATUS.md](./CURRENT_STATUS.md).
- Synthetic A/B/C fixtures, static expected balances and the coverage matrix are documented in [UAE_IFRS_TESTBED.md](./UAE_IFRS_TESTBED.md). Fixture PDFs are rendered from the production HTML builder but are not persisted service outputs or saved engagement records.
- New `AE_UAE_DEMO` final-TB snapshots leave `mapping_rule_set_id` null and skip the India mapping engine, including for prior-year TB selection. UAE statement mappings remain separately authorized and persisted in `engagement_uae_demo_mappings`. Historic v1/v2 snapshots retain their prior reference; it did not drive UAE calculations or authorization.
- The UAE wordmark is rendered in fixed aspect-safe preview and PDF boxes using `object-fit: contain`. PDF box dimensions are chosen to preserve the auditor-report page break and contents/footer numbering.

### Implemented only in the test bed

- The test suite covers a baseline-calibrated Sample 01 fixture, a simple trading LLC and one controlled IAS 16 revaluation-OCI scenario. The controlled treatment assumptions and unsupported adjacent cases are recorded in [DECISIONS.md](./DECISIONS.md).
- The disclosure-total validator is callable by tests but is not connected to editable structured schedules in the UI. The fixture engagements have not been provisioned as separate persistent engagement records or run through the desktop after restart.

### Planned / unsupported

New reporting frameworks and localization remain governed by [ROADMAP.md](./ROADMAP.md). General UAE IFRS reporting, full IAS 16 coverage, structured schedule editing, India Ind AS, US GAAP and currency translation are not implemented.

## Known legacy database/IPC bypasses

Legacy financial modules still access PostgreSQL directly and are not engagement-authorized. Important examples include:

- `src/main/ipc/tb.js` — TB, stock and journal-related operations.
- `src/main/ipc/mapping.js` and `src/main/ipc/mapped-tb.js` — mapping and mapped adjustments.
- `src/main/ipc/financials.js` — financial statements and legacy PDF generation.
- `src/main/ipc/notes.js` — note disclosures.
- `src/main/ipc/financial-periods.js` — period locking/finalisation.
- `src/main/ipc/fs-snapshot.js` — publishing snapshots.

These remain available in legacy mode and can bypass engagement membership checks. A login screen or renderer hiding a feature does not secure those handlers. Full migration behind permission-enforced service APIs remains incomplete.

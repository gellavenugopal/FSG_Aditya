# First-cut UAE IFRS test bed

This is a deterministic synthetic calculation test bed, not an IFRS-compliant reporting engine. It extends the narrow `AE_UAE_DEMO` statement builder while keeping UAE Sample 01 v5 and India’s finalised output unchanged.

## How to run

These commands are separate from starting the desktop; `launch` does not invoke them:

```powershell
npm run uae:test
npm run engagement:test
npm run uae:pdf
```

- `uae:test` checks the synthetic fixtures and reporting calculations without a database.
- `engagement:test` creates and removes its own temporary PostgreSQL test cluster. It tests service permissions, journal validation and output persistence across service restart.
- `uae:pdf` uses the production UAE statement builder and local Microsoft Edge to create renderer-fixture PDFs under the existing isolated demo profile. It requires the existing `target.json`; it does not run `init`, connect to PostgreSQL, or save engagement outputs.

The fixtures are in [`tools/uae-ifrs-testbed-fixtures.mjs`](../tools/uae-ifrs-testbed-fixtures.mjs); assertions are in [`tools/selftest-uae-ifrs-testbed.mjs`](../tools/selftest-uae-ifrs-testbed.mjs). The report builder is [`uaeDemoReporting.js`](../src/renderer/src/components/Engagements/uaeDemoReporting.js).

## Persistent B/C desktop rehearsal

The deterministic tests and the normal desktop startup are separate. Do not run `init`; use the existing manifest-verified isolated profile/database only.

Initial preparation, if the synthetic TB workbooks need to be regenerated:

```powershell
.\tools\engagement-demo.ps1 start-db
.\tools\engagement-demo.ps1 generate-ifrs-testbed-tbs
```

Start the application normally, then run the workflow command in a second PowerShell window while the desktop is open:

```powershell
.\tools\engagement-demo.ps1 launch
```

```powershell
.\tools\engagement-demo.ps1 ifrs-cases-create-ui
```

For restart/reopening, close the desktop normally without stopping the isolated database, relaunch it, and run the reopen check from a second PowerShell window:

```powershell
.\tools\engagement-demo.ps1 launch
```

```powershell
.\tools\engagement-demo.ps1 ifrs-cases-reopen-ui
```

The create workflow safely reuses the existing B/C engagement records and imports. It signs in through the configured isolated test administrator and visible login form; credentials are read from the isolated profile and are not printed. These commands do not connect to production or run the long-running test suites as part of ordinary application startup.

## Scenarios and independent expected results

All amounts are synthetic AED. Source TB debit balances are negative and credit balances positive. Expected values are stored in each fixture independently of the reporting builder.

| Case | Scenario | Current-year position | Current profit | Current OCI | Total comprehensive income | Closing equity | Cash reconciliation |
|---|---|---:|---:|---:|---:|---:|---|
| A | UAE Sample 01 baseline-calibrated synthetic fixture | Assets 239,250 = liabilities and equity 239,250 | 36,250 | 0 | 36,250 | 182,250 | 100,000 + 29,250 = 129,250 |
| B | Simple trading LLC: inventory, receivables/payables, depreciation, distributions | Assets 157,000 = liabilities and equity 157,000 | 45,000 | 0 | 45,000 | 120,000 | 32,000 + 45,000 = 77,000 |
| C | Case B plus controlled PPE revaluation OCI | Assets 167,000 = liabilities and equity 167,000 | 45,000 | 10,000 | 55,000 | 130,000 | 32,000 + 45,000 = 77,000 |

Selected prior-year expected results:

| Case | Comparative position | Profit | OCI | Total comprehensive income | Closing equity | Cash reconciliation |
|---|---:|---:|---:|---:|---:|---|
| A | 185,000 = 185,000 | 38,000 | 0 | 38,000 | 153,000 | 96,000 + 4,000 = 100,000 |
| B and C | 92,000 = 92,000 | 30,000 | 0 | 30,000 | 80,000 | 25,000 + 7,000 = 32,000 |

Fixtures include separate synthetic entity/engagement/reporting selections, current and comparative TB rows, balanced journal entries, row-to-UAE-line mappings, narrative disclosures, static expected note totals and report dates/signatories. Case A is calibrated to the verified Sample 01 v5 headline results, but is not an export of its saved ledger rows or a replacement for its saved engagement/PDF.

The calculator verifies source-TB balance, current and comparative statements of financial position, profit and OCI separation, total comprehensive income, equity movements, cash movement and note totals. The renderer uses two-decimal display formatting without modifying the fixture balances. Journal, mapping and narrative changes are checked for changed report HTML. The separate service test checks PDF output versioning and signing-selection persistence across service restart; the desktop rehearsal verifies saved B/C output retrieval and the corrected narrative after restart.

## Controlled OCI assumption

Case C uses the engineering proposal recorded in [DECISIONS.md](./DECISIONS.md): an IAS 16 revaluation increase for an entire PPE class is recorded in OCI and accumulated in a separate revaluation-surplus reserve. The AED 10,000 revaluation is non-cash, is excluded from cash-flow totals, and does not change profit for the year. The controlled example assumes no prior revaluation decrease recognised in profit or loss, no tax effect and no subsequent depreciation transfer in the fixture period.

This is a test-only treatment assumption, not a user-approved accounting policy or proof of IAS 16 compliance. Revaluation decreases, prior-loss reversals, deferred tax, later depreciation transfers, valuation frequency/class-wide policy controls and related disclosures are unsupported. Other OCI treatments are unsupported and must not be mapped into profit or loss as a workaround.

Persisting C's three revaluation/OCI mapping keys required an additive update to the UAE demo mapping constraint; existing India mapping tables and calculations are not changed. Desktop rehearsal also exposed narrative saves being assigned to the next sequence number instead of the selected note number. The save handler now preserves the requested stable note number and explicitly rejects a conflicting title/number. The restarted B/C v2 PDFs verify the corrected Note 1 and Note 11 placement while preserving v1.

## Validation and failure cases

| Failure | Expected actionable result | Evidence |
|---|---|---|
| Unbalanced journal | Reports debit total, credit total and exact difference; posting is rejected. | `engagement:test` |
| Unmapped material ledger | Names the account and directs the user to map every non-zero ledger. | `uae:test`; shown in the reporting panel alert |
| Inconsistent supplied disclosure total | Names the note, period and difference and asks for schedule reconciliation. | `uae:test` helper; no structured-disclosure UI exists yet |
| Missing comparative | Requires an imported and selected prior-year comparative TB. | `uae:test`; reporting UI also blocks generation |
| Edit without permission | Protected journal/settings write is denied to reader, partner/admin without edit membership, and unrelated users. | `engagement:test` |

## Generated renderer PDFs

Latest renderer-fixture run:

`%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-IFRS-Testbed\run-2026-10-26T22-41-40-405Z`

- `A-UAE-SAMPLE-01-BASELINE.pdf` — 11 pages; SHA-256 `22169980c7c62e2dca0a59d5f903dd08cccae93257dec267ff8f6d611765df3`.
- `B-SIMPLE-TRADING-LLC.pdf` — 11 pages; SHA-256 `489d29bce0fa46ef1ca34e4f7da9f58300ae7bd149bf76651e89344a60aaf9ad`.
- `C-IAS16-REVALUATION-OCI.pdf` — 11 pages; SHA-256 `1c90d34992939a1e4ab84c432e17da50f54e7cbdd7fe6d436fbd556475e73883`.

The three renderer PDFs in the latest run contain 11 physical pages each (33 total). The saved B/C desktop outputs described below were visually inspected page by page, including contents links, labels, comparative presentation, and absence of India-specific captions. Renderer-fixture PDFs are generated from the production statement-builder HTML with local Edge; they are **not** PDFs saved by the engagement service.

## Saved B/C engagement outputs

Cases B and C were created/reused as separate engagements in the persistent isolated database and exercised through the normal desktop login and reporting UI. Case A remains a deterministic baseline fixture, not a third engagement. Both B and C have selected synthetic firm/office/logo/partner/signatories, current/prior TBs, balanced journals, UAE mappings and their own versioned draft outputs.

| Case | Engagement | Output | Pages | SHA-256 |
|---|---|---|---:|---|
| B | `IFRS-CASE-B-TRADING-2025` (id 3) | v1, preserved | 11 | `ebff508071cc7fe40adfd7e0264479cdc7bdb5e3250e534d306b9c0cd82b820f` |
| B | same | v2, current | 11 | `f85a29c98c718a66758cc8ef55fea36477d7dade25821946e906c79c0a029465` |
| C | `IFRS-CASE-C-OCI-2025` (id 4) | v1, preserved | 11 | `c373c57b678603e1d78874fb7f2f7ef7d5a711960c99fa3cbe895afe7ae2ee17` |
| C | same | v2, current | 11 | `5d7f4dcdea95941e59d2734858488027c3431403ec86a22f8d1bf4271b4041e0` |

Saved PDFs are under `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-IFRS-Testbed\Saved-Engagements\` as `B-SIMPLE-TRADING-LLC-reporting-pack-v1.pdf`, `B-SIMPLE-TRADING-LLC-reporting-pack-v2.pdf`, `C-IAS16-REVALUATION-OCI-reporting-pack-v1.pdf`, and `C-IAS16-REVALUATION-OCI-reporting-pack-v2.pdf`. Restart/reopening against the same isolated database retrieved v2 and verified both v1 hashes remain unchanged. The v2 contents destinations (16 for B, 17 for C) resolve within their 11-page PDFs; all pages were visually inspected. The expected reconciliations and correct note identities/text were rechecked after restart. All outputs remain drafts; no B/C pack was finalised.

The preserved UAE Sample 01 v5 remains `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v5.pdf`, SHA-256 `29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a`. India finalised v5 remains SHA-256 `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`.

## Coverage matrix

| Capability | Status | Scope / evidence |
|---|---|---|
| Deterministic synthetic entity/engagement, current/prior TB, journals, mappings and disclosures for A/B/C | **Implemented and tested** | 241 assertions; no database access |
| TB and statement balance; selected comparatives; note totals; rounding immutability | **Implemented and tested** | Independent static expected values in fixtures and regression assertions |
| Controlled IAS 16 revaluation OCI / revaluation reserve / non-cash cash-flow exclusion | **Implemented and tested** | Case C only, under the explicit assumptions above |
| Journal imbalance, unmapped account, inconsistent supplied note total, missing comparative | **Implemented and tested** | Actionable errors; disclosure-total helper has no editing UI |
| Service permission rejection; versioned PDF/selection persistence across service restart | **Implemented and tested** | Separate temporary-PostgreSQL service integration test, not the A/B/C engagements |
| Journal, mapping and narrative disclosure changes reflected in changed report content | **Implemented and tested** | Test-bed compares generated report HTML; service separately verifies new immutable PDF version storage |
| Renderer PDFs for A/B/C | **Implemented and tested** | Local Edge renderer outputs; not engagement-service saved PDFs |
| Separate B/C engagement records, firm/logo selection, saved draft PDFs and app restart/reopen | **Implemented and tested** | Normal desktop UI; v1/v2 hashes, reporting selections, notes, 11-page PDFs and reopened v2 outputs verified |
| Journal or mapping edits after a saved B/C output create a new persisted version | **Implemented but unverified** | Renderer-level changes are covered; the persisted desktop v2 correction changed disclosure identity/text, not the journal or mapping after v1 |
| Finalising a B/C test-bed pack and verifying its immutable final output | **Implemented but unverified** | B/C outputs intentionally remain drafts; finalisation was not exercised for these test cases |
| Disclosure schedules edited/reconciled in the application UI | **Unsupported** | Current UI stores narrative note disclosures; structured schedule amounts are not implemented |
| General UAE IFRS reporting, complete IAS 16, other OCI standards, deferred tax, currency translation and production readiness | **Unsupported** | Do not infer coverage from these synthetic calculations |

## Next recommended step

Extend the test bed with an integration case that changes a posted journal and a mapping after a saved output, creates the next version, and confirms the previous PDF stays unchanged. Add structured disclosure schedules only after defining their validation rules and independently calculated expected results. Keep all output labelled as a demonstration; this is not complete IFRS coverage.

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

The calculator verifies source-TB balance, current and comparative statements of financial position, profit and OCI separation, total comprehensive income, equity movements, cash movement and note totals. The renderer uses two-decimal display formatting without modifying the fixture balances. Journal, mapping and narrative changes are checked for changed report HTML; separate service tests check that new PDF output versions and saved signing selections survive a service restart.

## Controlled OCI assumption

Case C uses the engineering proposal recorded in [DECISIONS.md](./DECISIONS.md): an IAS 16 revaluation increase for an entire PPE class is recorded in OCI and accumulated in a separate revaluation-surplus reserve. The AED 10,000 revaluation is non-cash, is excluded from cash-flow totals, and does not change profit for the year. The controlled example assumes no prior revaluation decrease recognised in profit or loss, no tax effect and no subsequent depreciation transfer in the fixture period.

This is a test-only treatment assumption, not a user-approved accounting policy or proof of IAS 16 compliance. Revaluation decreases, prior-loss reversals, deferred tax, later depreciation transfers, valuation frequency/class-wide policy controls and related disclosures are unsupported. Other OCI treatments are unsupported and must not be mapped into profit or loss as a workaround.

## Validation and failure cases

| Failure | Expected actionable result | Evidence |
|---|---|---|
| Unbalanced journal | Reports debit total, credit total and exact difference; posting is rejected. | `engagement:test` |
| Unmapped material ledger | Names the account and directs the user to map every non-zero ledger. | `uae:test`; shown in the reporting panel alert |
| Inconsistent supplied disclosure total | Names the note, period and difference and asks for schedule reconciliation. | `uae:test` helper; no structured-disclosure UI exists yet |
| Missing comparative | Requires an imported and selected prior-year comparative TB. | `uae:test`; reporting UI also blocks generation |
| Edit without permission | Protected journal/settings write is denied to reader, partner/admin without edit membership, and unrelated users. | `engagement:test` |

## Generated renderer PDFs

Latest verified renderer-fixture run:

`%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-IFRS-Testbed\run-2026-10-26T20-58-38-113Z`

- `A-UAE-SAMPLE-01-BASELINE.pdf` — 17 pages.
- `B-SIMPLE-TRADING-LLC.pdf` — 17 pages.
- `C-IAS16-REVALUATION-OCI.pdf` — 18 pages.

All 52 pages in the latest run were text-checked for non-empty content, the demonstration label, and absence of India-specific terms. The same report content was reviewed together in a rendered contact sheet, and the key C statement/OCI/note pages were visually inspected. SHA-256: A `D4146DA0ED43A04D927138B1E3608AADF0B3010A9678EC8D2E44BC1D8ACFCDEA`; B `0F1F9150514D3C6FF8E148667DDFD5518E2FB652CD4764220529AA506705C66F`; C `BA4EB64CFA14AED8A28EC31C00564EC80C5AF498AE31DBD2A7E9C70F1CCF0FBB`. These files were rendered from the production statement-builder HTML with local Edge; they are **not** PDFs saved by the engagement service and do not prove application UI or restart behavior for cases A/B/C.

The preserved UAE Sample 01 v5 remains `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v5.pdf`, SHA-256 `29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a`. India finalised v5 remains SHA-256 `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`.

## Coverage matrix

| Capability | Status | Scope / evidence |
|---|---|---|
| Deterministic synthetic entity/engagement, current/prior TB, journals, mappings and disclosures for A/B/C | **Implemented and tested** | 222 assertions; no database access |
| TB and statement balance; selected comparatives; note totals; rounding immutability | **Implemented and tested** | Independent static expected values in fixtures and regression assertions |
| Controlled IAS 16 revaluation OCI / revaluation reserve / non-cash cash-flow exclusion | **Implemented and tested** | Case C only, under the explicit assumptions above |
| Journal imbalance, unmapped account, inconsistent supplied note total, missing comparative | **Implemented and tested** | Actionable errors; disclosure-total helper has no editing UI |
| Service permission rejection; versioned PDF/selection persistence across service restart | **Implemented and tested** | Separate temporary-PostgreSQL service integration test, not the A/B/C engagements |
| Journal, mapping and narrative disclosure changes reflected in changed report content | **Implemented and tested** | Test-bed compares generated report HTML; service separately verifies new immutable PDF version storage |
| Renderer PDFs for A/B/C | **Implemented and tested** | Local Edge renderer outputs; not engagement-service saved PDFs |
| Separate A/B/C engagement records, firm/logo selection through desktop UI, saved-output versions and app restart/reopen | **Implemented but unverified** | Fixtures hold engagement settings, but no A/B/C records were provisioned in the persistent demo; no case PDFs were saved through the desktop UI |
| Disclosure schedules edited/reconciled in the application UI | **Unsupported** | Current UI stores narrative note disclosures; structured schedule amounts are not implemented |
| General UAE IFRS reporting, complete IAS 16, other OCI standards, deferred tax, currency translation and production readiness | **Unsupported** | Do not infer coverage from these synthetic calculations |

## Next recommended step

Provision B and C as separate engagements through the normal isolated desktop/service workflow, then save and reopen each service-generated PDF after an application restart. Preserve UAE Sample 01 v5 and India finalised v5. Expand accounting rules only with reviewed, explicitly scoped treatments and independently authored expected results.

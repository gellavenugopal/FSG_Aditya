# Roadmap

Order reflects the current user-approved delivery priority. Acceptance requires observable application behavior, not just API tests or an architecture document.

## 1. Verify and preserve the India baseline — gate

- **Status: verified 2026-10-27.** Preserve the finalised India PDFs and engagement; do not run demo initialization against the existing database.
- The isolated desktop reopened the saved India engagement and finalised version 5. Retrieved SHA-256 remained `059865a857f2dc5086e9a7d5765d89cc72201fce3ada3d539a776686ddf0e075`.
- The earlier version 6 investigation remains recorded in [CURRENT_STATUS.md](./CURRENT_STATUS.md): v6 is a draft, v5 remains finalised, no automatic reopening was observed, and the precise reason a prior automation stopped after draft generation is unknown.
- Acceptance met for this checkpoint: UI distinguishes draft/finalised state and the existing India v5 remains byte-identical. No India report generation or finalisation policy was bypassed.

## 2. Build UAE Sample 01 — immediate milestone

- **Status: delivered for demonstration, not validated for production or IFRS compliance.** A synthetic UAE LLC engagement `UAE-SAMPLE-01-2025` now has an isolated service-backed AED reporting path, separate from India Schedule III.
- Create one separate synthetic UAE LLC engagement and reporting set for year ended 31 December 2025 with 2024 comparatives, AED functional/source/presentation currency, selected firm identity and separate financial statements.
- Keep UAE report generation separate from the India Schedule III path. Use explicit AED debit/credit sign normalization; do not translate currency or hardcode totals in the renderer.
- Derive statements and notes from the saved final TB, journals and reconciled supporting schedules. Include financial position, profit or loss and OCI, changes in equity, cash flows, notes, editable audit narrative and combined PDF.
- Clearly label the output **Draft for demonstration**; do not claim full IFRS compliance or a production-validated pack. Use supplied client materials only as references; do not commit those files. If references are missing/inconsistent, document the inconsistency and use disclosed synthetic data.
- **Verified acceptance:** the actual desktop workflow saved current/prior synthetic AED TBs, balanced journals, final TB v3 and its 16 UAE mappings without an India mapping-rule-set dependency. The protected desktop generated corrected output v6 using persisted firm/report identity, wording, approval date/place and signatory. It was downloaded through the normal saved-output button after restarting against the same isolated database/profile; all 11 pages and printed contents entries were inspected.
- Corrected fallback: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v6.pdf`, SHA-256 `cefb5b714f1069c73af30970cd637d2049ddb9448333b953ff4773f121fb77a1`. V6 is a draft for demonstration, not finalised.
- **Note-reference correction delivered:** v7 was generated through the visible reporting action after saving a synthetic cash-note narrative. It has no dangling Note 11 reference, lists only included notes, preserves all totals, and was downloaded through its visible saved-output row. Path: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v7-corrected.pdf`; SHA-256 `2d1d41e69827f5eed47f041a0b84ff13dfd80c97a4ccc9d4fd08c67e897838f6` (87,311 bytes, 11 pages). Printed contents page numbers and all physical footers were checked; the PDF has no embedded internal-link annotations. V7 remains a demonstration draft; v5/v6 remain byte-identical.
- Preserve historical v5 unchanged: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v5.pdf`, SHA-256 `29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a`. Review found no auditor-address overflow, but it had no clickable contents destinations, repeated generic note titles, one short note per page, and the adjustment caption “Unmapped demonstration adjustment”; v6 corrects those layout/content-label issues.
- Preserve v3 baseline: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf`, SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237`. Its stored bytes remain unchanged. v4 is an intermediate draft with a pagination defect and is not the recommended walkthrough output.
- The empty engagement list was traced to signing in as `Sample Administrator` from a different firm; the trusted service correctly keeps “All Engagements” firm-scoped. The normal UI now identifies the authenticated firm and defaults administrators/partners to the firm-scoped list. `Demo Administrator` in **FSG Isolated Demo Firm** opened the existing engagement and downloaded v5; no permission bypass or duplicate engagement was created.
- Broader UAE reporting/IFRS validation, currency translation and production use are not claimed. Supplied `UAESample1.zip` and its listed documents were unavailable for direct inspection; the synthetic dataset remains clearly identified as synthetic.
- **First-cut test-bed slice delivered 2026-10-27:** deterministic synthetic A/B/C fixtures and independent expected balances exercise the Sample 01 baseline-calibrated case, a trading LLC and a controlled IAS 16 revaluation-OCI case. `npm run uae:test` covers 241 assertions. Separate B/C engagements were reopened through the desktop; current v2 PDFs are 11 pages each, and case C reconciles AED 10,000 OCI separately from AED 45,000 profit. UAE Sample 01 v5/v6 and India finalised v5 remain unchanged at their recorded hashes. See [UAE_IFRS_TESTBED.md](./UAE_IFRS_TESTBED.md) for exact paths, hashes, coverage and limitations.
- **Next acceptance gap:** exercise a journal and a mapping edit after an existing B/C output, generate a new persisted version, and verify the prior PDF remains unchanged. Structured disclosure schedules and broader UAE IFRS coverage remain unsupported.

## 3. Resume India product corrections

- Continue the India single-client change-to-output, reconciliation, finalisation and reopening work after the UAE demonstration gate.
- Acceptance: representative journal, mapping, disclosure and audit-wording changes reach the correct sections with reconciled values and preserved versions.

## 4. Close remaining operational gaps

- Continue legacy IPC migration only when scheduled after the demonstration.
- Continue extended EPIPE investigation only when it blocks the isolated walkthrough; retain current uncertainty until a live popup is correlated.
- Acceptance: separately scoped authorization coverage and process-correlated EPIPE verification; neither is implied complete by the UAE demo.

## 5. Implement India Ind AS

- Add its reporting basis, templates, calculations and disclosures without changing legacy Schedule III behavior.
- Acceptance: representative synthetic cases reconcile, user can select the correct framework/template, and a complete saved pack survives restart.

## 6. Implement US GAAP

- Add the jurisdiction-specific statements, disclosures and report templates.
- Acceptance: representative synthetic US cases reconcile and a complete saved pack survives restart.

## Deferred

- Currency translation is not part of the current scope; do not infer rates or translate balances.
- Physical multi-computer UAT is deferred until a complete single-client pack is available and separately scheduled.
- Deployment/infrastructure expansion does not supersede the functional reporting milestones.

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
- **Verified acceptance:** the actual desktop workflow saved current/prior synthetic AED TBs, two balanced journals, final TB v2 and its 16 mappings. Readiness verification created final TB v3, saved its 16 UAE mappings without an India mapping-rule-set dependency, and generated corrected output v5 with saved firm/report identity, wording and narrative. v5 was reopened and downloaded after a same-database/profile restart; approval date/place and signatory were restored. Statement, comparative, equity, cash-flow and note totals reconcile.
- Current fallback: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v5.pdf`, SHA-256 `29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a`. All 17 pages were visually inspected; contents/footer pagination align, and India-specific statutory wording is absent.
- Preserve v3 baseline: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf`, SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237`. Its stored bytes remain unchanged. v4 is an intermediate draft with a pagination defect and is not the recommended walkthrough output.
- Remaining within this milestone: rehearse the v5 walkthrough. Non-zero OCI coverage, broader UAE reporting/IFRS validation, currency translation and production use are not claimed. Supplied `UAESample1.zip` and its listed documents were unavailable for direct inspection; the synthetic dataset remains clearly identified as synthetic.

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

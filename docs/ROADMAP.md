# Roadmap

Order reflects the current user-approved delivery priority. Acceptance requires observable application behavior, not just API tests or an architecture document.

## 1. Verify and preserve the India baseline — gate

- Preserve the finalised India PDFs and engagement; do not run demo initialization against the existing database.
- Reopen the saved India engagement and finalised version 5 through the isolated desktop UI and verify its saved hash.
- Investigate draft version 6 and make status/finalisation policy clear; never reopen a finalised engagement automatically.
- Acceptance: the UI shows finalised/reopened state accurately, version 5 remains byte-identical, and draft generation cannot bypass finalisation policy.

## 2. Build UAE Sample 01 — immediate milestone

- **Status: delivered for demonstration, not validated for production or IFRS compliance.** A synthetic UAE LLC engagement `UAE-SAMPLE-01-2025` now has an isolated service-backed AED reporting path, separate from India Schedule III.
- Create one separate synthetic UAE LLC engagement and reporting set for year ended 31 December 2025 with 2024 comparatives, AED functional/source/presentation currency, selected firm identity and separate financial statements.
- Keep UAE report generation separate from the India Schedule III path. Use explicit AED debit/credit sign normalization; do not translate currency or hardcode totals in the renderer.
- Derive statements and notes from the saved final TB, journals and reconciled supporting schedules. Include financial position, profit or loss and OCI, changes in equity, cash flows, notes, editable audit narrative and combined PDF.
- Clearly label the output **Draft for demonstration**; do not claim full IFRS compliance or a production-validated pack. Use supplied client materials only as references; do not commit those files. If references are missing/inconsistent, document the inconsistency and use disclosed synthetic data.
- **Verified acceptance:** the actual desktop workflow saved current/prior synthetic AED TBs, two balanced journals, final TB v2, 16 manual mappings, firm/report identity, wording and narrative edits. Regenerated v3 reflects the second journal and revised Note 1 narrative. Statement, comparative, equity, cash-flow and note totals reconcile. After restart, the engagement and v3 bytes were retrieved through the normal desktop UI and matched the fallback SHA-256 in [CURRENT_STATUS.md](./CURRENT_STATUS.md). All 17 pages were visually inspected; India regressions passed.
- Fallback: `%USERPROFILE%\FSG-Aditya-engagement-demo\outputs\UAE-Sample-01-reporting-pack-v3.pdf`, SHA-256 `916d0d08603132e564ddde93deaa2f922617f4480a5d3708910588b5e4179237`.
- Remaining within this milestone: rehearse the walkthrough, improve the small synthetic logo if time allows, and preserve the draft state. Non-zero OCI coverage, broader UAE reporting/IFRS validation, currency translation and production use are not claimed.

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

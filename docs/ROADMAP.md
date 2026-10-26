# Roadmap

Order reflects the current user-approved delivery priority. Acceptance requires observable application behavior, not just API tests or an architecture document.

## 1. Verify and preserve the India baseline — gate

- Preserve the finalised India PDFs and engagement; do not run demo initialization against the existing database.
- Reopen the saved India engagement and finalised version 5 through the isolated desktop UI and verify its saved hash.
- Investigate draft version 6 and make status/finalisation policy clear; never reopen a finalised engagement automatically.
- Acceptance: the UI shows finalised/reopened state accurately, version 5 remains byte-identical, and draft generation cannot bypass finalisation policy.

## 2. Build UAE Sample 01 — immediate milestone

- Create one separate synthetic UAE LLC engagement and reporting set for year ended 31 December 2025 with 2024 comparatives, AED functional/source/presentation currency, selected firm identity and separate financial statements.
- Keep UAE report generation separate from the India Schedule III path. Use explicit AED debit/credit sign normalization; do not translate currency or hardcode totals in the renderer.
- Derive statements and notes from the saved final TB, journals and reconciled supporting schedules. Include financial position, profit or loss and OCI, changes in equity, cash flows, notes, editable audit narrative and combined PDF.
- Clearly label the output **Draft for demonstration**; do not claim full IFRS compliance or a production-validated pack. Use supplied client materials only as references; do not commit those files. If references are missing/inconsistent, document the inconsistency and use disclosed synthetic data.
- Acceptance: the actual desktop walkthrough saves the UAE engagement; journal and narrative disclosure edits appear after PDF regeneration; totals, comparatives, equity movements, cash flows, note references and UAE/AED captions reconcile; restart/reopen retrieves the same saved output; every PDF page is visually inspected; India regressions still pass.

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

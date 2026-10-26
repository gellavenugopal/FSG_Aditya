# Roadmap

Order reflects the user-approved priority: complete and maintain the single-client pack before adding jurisdictions or deployment requirements. Acceptance requires observable application behavior, not just API tests or an architecture document.

## 1. Maintain the India single-client pack — active

- Keep the saved engagement workflow usable from import through final PDF.
- Fix remaining defects in journals/final TB, manual mapping, structured/narrative notes, prior-year comparisons, report identity and finalisation.
- Regenerate the saved pack after representative journal, mapping, disclosure and audit-wording changes; confirm each change appears in the correct output section with reconciled figures and references.
- Preserve output versions, selected templates, report identity, branding and signing details across master edits and application/service restarts.
- Acceptance: actual desktop generates and saves one combined PDF from a saved engagement; reopening retrieves it after restart; independent TB, statements, notes and comparative reconciliations pass; finalisation blocks edits and authorised reopening retains the prior final output. See [CURRENT_STATUS.md](./CURRENT_STATUS.md) for what has already been verified.

## 2. Close the EPIPE verification gap

- Capture the process tree and complete stack from an actual recurrence, including PID, executable, parent, checkout and launcher log.
- Exercise repeated actual renderer HMR after output-consumer disconnection through the isolated launcher, then normal shutdown/restart.
- Acceptance: the same isolated route demonstrates continued HMR and diagnostic logging after a pipe disconnect, unrelated errors remain visible, and no project-owned dev processes remain orphaned.

## 3. Retire legacy authorization bypasses

- Inventory and move remaining financial/notes/mapping/period/snapshot database operations behind trusted service authorization.
- Keep schema changes additive and preserve current India outputs.
- Acceptance: service authorization applies per operation and engagement; unauthorised/cross-engagement calls fail; service-only mode does not fall back to legacy DB/IPC paths; regression tests and India reconciliations pass.

## 4. Implement UAE IFRS — first case: UAE Sample 01

- Build the initial UAE reporting workflow only after the India pack stays stable.
- Use synthetic data for **UAE Sample 01**; do not commit client source workbooks, statements, or other confidential client files.
- Acceptance: a documented synthetic engagement produces reconciled UAE statements, notes, auditor-authored report and saved combined PDF through the application, with persistence and permission checks. No UAE accounting behavior is complete before this gate passes.

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

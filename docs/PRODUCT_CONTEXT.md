# Product context

## Product

FSG is a generic financial statement generator for professional firms. The desktop application supports firm-level deployment and works with a trusted engagement service for engagement identity, access control and protected reporting workflows.

## Engagement model and roles

- A firm owns clients and engagements. An engagement has an owner, an assigned partner and, where authorised, a substitute partner.
- Engagement owners/admins can invite or grant access to firm users. Read and edit access are distinct and engagement-scoped; access is not inherited merely because users share a client or reporting period.
- Firm administrators and partners may have broad visibility for administration and supervision. Visibility by itself does not imply edit permission or authority to finalise.
- Users with edit rights may post balanced audit journals without a separate approval queue.
- Only the assigned partner or an authorised substitute may finalise or reopen an engagement/report output.
- Invitations are currently provisioned by an administrator using the existing account flow; automatic email invitations are not implemented.

## Financial and reporting foundation

The reporting foundation is the imported trial balance, immutable posted-journal history, and versioned final trial balance. Preserve original imports; adjustments and mapping corrections must be traceable and must not silently rewrite source balances.

Reporting uses versioned template selections and application-generated paper books. A saved reporting output contains the audit report, financial statements and notes in one printable PDF. Auditor-entered wording controls the audit opinion; the application must not infer an opinion from financial figures.

The currently implemented protected reporting basis is the existing India legacy Schedule III workflow in INR, without currency translation. Existing India calculations and disclosure behavior must be preserved while the engagement workflow is completed and maintained.

## Jurisdiction sequence and deployment scope

The intended sequence is:

1. Preserve and complete the existing India reporting workflow.
2. Implement the UAE IFRS workflow, beginning with **UAE Sample 01** as its first synthetic case.
3. Implement India Ind AS.
4. Implement US GAAP.

Currency translation is deferred. No multi-computer UAT is required until a complete single-client reporting pack is available; the current product priority is correctness and usability for one client on one computer.

The product must not be described as fully engagement-isolated or production-ready multi-user software while legacy desktop database/IPC bypasses remain. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [ENGAGEMENT_SERVICE.md](../ENGAGEMENT_SERVICE.md).

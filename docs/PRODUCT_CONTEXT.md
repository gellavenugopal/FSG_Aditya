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

The existing protected India basis remains legacy Schedule III in INR, without currency translation. A separate, limited **UAE Sample 01** synthetic AED demonstration path now exists; it does not constitute general UAE IFRS support or a validated production reporting pack. Preserve India calculations and disclosure behavior while maintaining both workflows.

Firm application appearance, professional firm/office masters, report styles, engagements and signatory records are distinct. Appearance and immutable report-style versions are owned by the authenticated service firm. An engagement selects a report-style version, and each saved reporting output preserves the branding snapshot used at generation. Public-source firm prefill is editable, source-attributed and explicitly demo/draft; it does not imply registration, credential verification or signing authority. Do not populate an existing persistent demo firm or modify its outputs when a separate isolated demo profile has not been provisioned.

## Jurisdiction sequence and deployment scope

The intended sequence is:

1. Preserve and complete the existing India reporting workflow.
2. Validate and implement the UAE IFRS workflow, beginning with **UAE Sample 01** as its first synthetic case. The current synthetic demonstration and first-cut A/B/C test bed are not complete IFRS validation; see [UAE_IFRS_TESTBED.md](./UAE_IFRS_TESTBED.md).
3. Implement India Ind AS.
4. Implement US GAAP.

Currency translation is deferred. No multi-computer UAT is required until a complete single-client reporting pack is available; the current product priority is correctness and usability for one client on one computer.

The product must not be described as fully engagement-isolated or production-ready multi-user software while legacy desktop database/IPC bypasses remain. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [ENGAGEMENT_SERVICE.md](../ENGAGEMENT_SERVICE.md).

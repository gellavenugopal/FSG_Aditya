# Engagement Foundation — Implementation Plan

## Repository findings

- The existing client entity is `entities`; its reporting periods are global `financial_periods` attached through `entity_periods`. Trial balances already reference both the client entity and (optionally) that period anchor.
- Period locking/finalisation lives on `entity_periods`; existing auditors, signatories and global auditor masters are professional records, not application-user identities.
- The Electron main process owns PostgreSQL access and exposes broad legacy operations through IPC. There is no application login, firm-user model, or central trusted API; client nodes currently carry PostgreSQL connection configuration.
- Statement generation reads existing Trial Balance/mapped data and snapshots publish against `entity_periods`. Preserve those tables and values; link engagements additively.

## Stages

1. Additive schema for firm users, firm roles, engagements, one-or-more reporting sets, memberships, access requests, audit history, and explicit legacy-period links. Keep client entities, professional masters, and `entity_periods` distinct.
2. Add main-process authentication and an authorization service. Password hashes use Node crypto; first administrator setup is permitted only while no users exist. Engagement IPC checks permissions server-side; duplicate checks return restricted-safe results and serialize concurrent creates.
3. Add the engagement list, guided create flow, and overview. Drafts may be incomplete; activation is restricted to the implemented India reporting pack and validates required fields. Existing India work is linked explicitly and remains marked unconfirmed where parameters are unknown.
4. Test schema/service validation, visibility/edit/finalisation permissions, duplicate races and disclosure boundaries, plus build and legacy regression checks. Document limitations and the server/second-client setup.

## Security and migration boundary

This repository has no firm-hosted application API. The first slice can enforce engagement access in Electron main-process services but cannot make that service a trusted shared server while desktop clients retain PostgreSQL credentials. Legacy financial IPC handlers also remain callable without engagement authorization. Do not treat this slice as production-ready multi-user isolation; a firm-hosted API and migration of legacy operations are prerequisites. Do not infer legacy ownership, partner assignment, or reporting basis.

## Implementation and verification status

- The additive schema, main-process setup/login and engagement authorization handlers, preload API, and Engagements list/create/overview screens are implemented on the feature branch.
- Legacy trial balances already attached to the selected `entity_periods` remain on that anchor. Unlinked trial balances are listed for owner/admin review and only linked after explicit selection; trial-balance amounts and rows are not changed.
- The production build and engagement-domain self-test pass. PostgreSQL persistence, migration startup, duplicate races, and multi-client integration have not been exercised against a dedicated safe test environment.
- Secure server/second-client deployment instructions are intentionally withheld until a trusted firm-hosted API replaces direct desktop PostgreSQL access and legacy financial IPC operations are permission-enforced.

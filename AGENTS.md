# Repository entry point

Read these shared context files before changing code; follow this order:

1. [Product scope](./docs/PRODUCT_CONTEXT.md)
2. [Confirmed decisions](./docs/DECISIONS.md)
3. [Current architecture and boundaries](./docs/ARCHITECTURE.md)
4. [Current status and next action](./docs/CURRENT_STATUS.md)
5. [Roadmap and acceptance criteria](./docs/ROADMAP.md)
6. [Isolated Windows development setup](./docs/DEVELOPMENT_SETUP.md)
7. [Engagement service operations and UAT](./ENGAGEMENT_SERVICE.md)

[CLAUDE.md](./CLAUDE.md) and [ENGAGEMENT_FOUNDATION_PLAN.md](./ENGAGEMENT_FOUNDATION_PLAN.md) point to this shared context; do not maintain conflicting copies of project status there.

## Working rules

- Inspect `git status`, current branch, and recent history first. Preserve all user work, including uncommitted changes; never revert changes outside the task.
- Never connect to `vera_financial`, read saved production DB configuration, run production migrations, restore a backup, or reverse database changes during development/testing. The production-data incident remains unresolved.
- Use only the explicitly isolated disposable test harness for local desktop/service tests. Verify its target and profile before launching; do not substitute ordinary `npm run dev` with unknown/saved configuration.
- Do not commit secrets, credentials, test databases, generated outputs, or unrelated changes.
- Do not push, merge, or modify the default branch without explicit user instruction.
- Preserve existing India behavior and records; schema changes are additive unless the user separately authorizes otherwise.
- At task completion, update the affected shared context documents and record verified test results and remaining gaps. Never mark planned work complete without observable evidence.
- Keep detailed service procedures in `ENGAGEMENT_SERVICE.md`; link to them rather than duplicating them.

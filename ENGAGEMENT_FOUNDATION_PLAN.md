# Engagement foundation

This file is a short index, not a second status or operational guide.

- Product intent and reporting scope: [docs/PRODUCT_CONTEXT.md](./docs/PRODUCT_CONTEXT.md)
- Confirmed user decisions and explicitly labelled engineering proposals: [docs/DECISIONS.md](./docs/DECISIONS.md)
- Implemented and partial system architecture, including legacy bypasses: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Branch, commits, verified behavior and known gaps: [docs/CURRENT_STATUS.md](./docs/CURRENT_STATUS.md)
- Ordered milestones and acceptance criteria: [docs/ROADMAP.md](./docs/ROADMAP.md)
- Isolated Windows setup and exact commands: [docs/DEVELOPMENT_SETUP.md](./docs/DEVELOPMENT_SETUP.md)
- Full service routes, operating procedures and UAT evidence: [ENGAGEMENT_SERVICE.md](./ENGAGEMENT_SERVICE.md)

## Non-negotiable boundaries

- Never connect to, migrate, restore, or inspect the production `vera_financial` database during development or testing. The prior data-isolation incident remains unresolved.
- Preserve existing records and India calculations; database evolution is additive unless the user explicitly authorizes otherwise.
- Enforce engagement access in the trusted service. Do not infer access from shared entities or periods.
- Preserve imported trial-balance source rows and journal history. Final trial balances are versioned snapshots.
- Do not claim that service-only engagement workflows secure legacy IPC operations.
- Do not push, merge, or modify the default branch without explicit instruction.

Keep [docs/CURRENT_STATUS.md](./docs/CURRENT_STATUS.md), the affected context documents, and the detailed [ENGAGEMENT_SERVICE.md](./ENGAGEMENT_SERVICE.md) handoff accurate at the end of each task.

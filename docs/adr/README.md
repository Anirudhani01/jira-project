# Architecture Decision Records

Each ADR records one decision, its context and its consequences. The full approved design
(including Revisions 1–3 and the precedence rule) lives in
[`docs/architecture/phase-1-plan.md`](../architecture/phase-1-plan.md); the decision log is
[`docs/decisions.md`](../decisions.md).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith with a separate worker | Accepted |
| [0002](0002-technology-stack.md) | Technology stack | Accepted |
| [0003](0003-tenancy-shared-schema-rls.md) | Shared-schema tenancy with PostgreSQL RLS | Accepted |
| [0004](0004-identity-and-sessions.md) | Local identity and server-side sessions | Accepted |
| [0005](0005-data-driven-workflows.md) | Data-driven workflow configuration | Accepted |
| [0006](0006-api-conventions.md) | API conventions | Accepted |
| [0007](0007-failure-mode-policy.md) | Failure-mode and fail-open/closed policy | Accepted |
| [0008](0008-data-classes-retention-access.md) | Data classes, retention and access | Accepted |
| [0009](0009-outbox-worker-email-tokens.md) | Transactional outbox, worker and email tokens | Accepted (M2) |
| [0010](0010-orgs-authz-membership-audit.md) | Organizations, membership-resolved tenancy, authorization and org audit | Accepted (M3, pending review) |

New ADRs: copy the structure of an existing one, take the next number, and link it here.
Superseding an ADR: set the old one's status to "Superseded by NNNN"; never delete it.

# ADR 0001 — Modular monolith with a separate worker

- Status: Accepted (Phase 1, decision A2)
- Plan reference: §Context, R1, V2.1

## Context
The product needs organizations, projects, issues, workflows, boards, sprints, notifications
and audit. There is one team, no independent scaling requirement, and no existing system.

## Decision
Build one FastAPI codebase deployed as two processes: the **API** and a **worker** (outbox
processing, scheduled jobs; introduced in M2). Code is organised into modules
(`identity`, `orgs`, `projects`, `workflow`, `issues`, …) with `models / schemas /
repository / service / router` layers. Modules talk through service interfaces and
in-process events; they do not query each other's tables directly.

## Consequences
- One deployment, one database, ACID transactions across modules; simple local setup.
- Module boundaries keep later extraction possible but are enforced by review and
  architecture tests, not by the network.
- Microservices are explicitly out of scope until a concrete scaling or ownership need
  is demonstrated.

# Decision log

Precedence: Revision 3 > Revision 2 > Revision 1 > base plan
([`architecture/phase-1-plan.md`](architecture/phase-1-plan.md)). Superseded text in the
plan is marked **[SUPERSEDED]** and must not guide implementation.

| ID | Decision | Status | Where |
|---|---|---|---|
| A1 | React + TS + Vite / Python + FastAPI / PostgreSQL / Redis | Approved | ADR 0002 |
| A2 | Modular monolith + separate worker; no microservices | Approved | ADR 0001 |
| A3 | Shared schema + `org_id` + composite FKs + PostgreSQL RLS | Approved | ADR 0003 |
| A4 | Local auth (Argon2id), server-side sessions, OIDC-ready | Approved | ADR 0004 |
| A5 | Data-driven workflows/types/priorities; no custom fields in MVP | Approved | ADR 0005 |
| A6 / D12 | Polling in MVP; WebSockets deferred | Approved | plan §5.4 |
| D1 | Open self-signup; enumeration-safe; prod signup off until M2; verification gates org creation & invite acceptance | Approved | ADR 0004, plan V2.3 |
| D2 | Sessions: idle 24 h, absolute 14 d, no Remember Me, Secure/HttpOnly/SameSite=Lax, rotation, logout revokes current, reset revokes all | Approved | plan V2.4 |
| D3 | Breached-password screening (Pwned Passwords k-anonymity + local denylist) | Approved | plan V2.5 |
| D4 | Readable immutable org slugs; UUIDs internal; slugs never authorize; uniform 404 | Approved | plan V2.6 |
| D5 | Org audit 1 y (owners/admins); platform security events separate; no operator access to customer content; secrets never recorded | Approved | ADR 0008 |
| D6 | Max 20 active sessions per user, LRU eviction | Approved | plan V3.1 |
| D7 | Breach-check outage → fail open to local denylist + metric/alert; never send plaintext or full hash | Approved | plan V3.1 |
| D8 | Staging before M2 behind VPN / identity-protected gateway | Approved | plan V3.1 |
| D9 | Project creation **Option B — explicit grant only**: org owners/admins, or members explicitly granted `can_create_projects` by an owner/admin. Project-admin role confers no org-wide creation right; creating a project grants nothing | Approved | plan V3.6 |
| D10 | Viewers cannot comment or be assigned | Approved | plan V3.3 |
| D11 | Attachments deferred to v1.1 | Approved | plan V3.1 |
| D13 | Deployment provider, region, email provider: future decisions; email provider before M2 production email | Open (by design) | plan V3.1 |
| D14 | **Zero paid software cost**: no paid resources, subscriptions, paid APIs or paid services without explicit owner approval | Approved | plan V3.5 |

## Verification status
Approved decisions describe intended behavior. **Cross-tenant isolation is unverified**
until the M3 cross-tenant suite (plan R3.5) passes in CI. M0 verifies only runtime-role
safety and tenant-context helper behavior.

## M0 review record
M0 accepted on local validation with recorded limitations (plan V3.7): GitHub Actions not
yet run at acceptance; exact `make images` not passed in the sandbox (intercepted TLS;
scratch-copy CA builds are supporting evidence only); cross-tenant isolation unverified
until M3; CI image builds never push or provision paid resources.

## Open questions
- Retention of platform security events (proposed 1 y), application logs (30 d), traces (14 d).
- Org audit events after org deletion (needed before org deletion is built).
- Whether org admins later see their members' login events.

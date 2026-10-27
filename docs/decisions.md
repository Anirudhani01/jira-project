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

## M1 implementation record
Implemented per plan M1 / R2 / V2.3–V2.5 / V2.9. Deviations and additions (none change an
approved decision):
- CSRF token is derived (HMAC of the session token) instead of a stored hash (§4.1).
- Breach-check outage is counted in-process and logged as `breach_check.unavailable`;
  metric export and alerting arrive with observability (M12).
- Local denylist keeps only list entries of 12–128 characters (483 of 100k), since shorter
  ones are rejected by the length rule anyway.
- Extra rate limit on password change (5 per 15 minutes per user).
- `users` INSERT policy requires the bound auth-lookup email (stricter than R3.2's `true`).
- `EMAIL_DELIVERY_ENABLED=true` is rejected until M2 in every environment.
- `openapi-typescript` declares a TypeScript ^5 peer; it works with the pinned TypeScript 6.0.

### M1 security review (pre-commit)
Fixed, with regression tests in `backend/tests/integration/test_security_review.py`,
`tests/unit/test_security_primitives.py` and `tests/unit/test_passwords.py`:
- F1 (medium): auth rate limits were check-then-act, so concurrent attempts bypassed them
  (25/25 parallel wrong-password logins were evaluated). Now an atomic reserve/release.
- F2 (medium): SQL exception text embedded bound parameters (password/token hashes, emails)
  that could reach logs. Engine uses `hide_parameters=True`; log backstop masks emails.
- F3 (medium): the compose nginx appended to client-supplied `X-Forwarded-For` while uvicorn
  trusted `*`, so clients could choose their IP (bypassing per-IP limits, forging event
  IPs; non-IP values caused 500s). nginx now overwrites the header; non-IP peers are ignored.
- F4 (low): a 200 response that was not a range body counted as "clean"; now "unavailable".
- F6 (low): a password change/disable during login verification could still yield a session;
  the session transaction now re-checks the stored hash and status.
- F7 (low): the UI cleared its signed-in state even when the server rejected a logout, so a
  user could believe they had signed out while the session stayed valid. State is now
  cleared only on a confirmed logout, and a failure is shown.

## Open questions
- Retention of platform security events (proposed 1 y), application logs (30 d), traces (14 d).
- Org audit events after org deletion (needed before org deletion is built).
- Production proxy chain must overwrite `X-Forwarded-For` at the edge and set
  `FORWARDED_ALLOW_IPS` to the exact proxy addresses (never `*` when the backend is
  reachable by anything other than the trusted proxy).
- Production egress to `api.pwnedpasswords.com` must be allowed, otherwise breach screening
  silently runs in local-denylist-only mode (observed in the development sandbox).
- Whether org admins later see their members' login events.

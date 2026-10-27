# ADR 0008 — Data classes, retention and access

- Status: Accepted (decision D5)
- Plan reference: V2.7 (authoritative)

## Decision
| Class | Store | Retention | Access |
|---|---|---|---|
| Org audit events | `audit_events` (`org_id NOT NULL`, RLS, append-only) — M3 | 1 year | Org owners/admins only |
| Platform security events | `security.platform_security_events` (separate schema; runtime roles INSERT only) — M1 | 1 year (proposed) | Security team role only; not org admins |
| Application logs | stdout → log platform | 30 days (proposed) | Platform operators |
| Traces / metrics | OTel backend | 14 days / 13 months (proposed) | Platform operators |
| Issue activity | tenant data | lifetime of issue | users with project view |

Platform operators have no grants on tenant tables; production access to tenant data is
break-glass only (ticketed, time-boxed, logged).

## Never recorded
Passwords, password hashes, session tokens, cookies/`Set-Cookie`, `Authorization` headers,
CSRF tokens, verification/reset/invitation tokens, raw bodies of auth endpoints.

## Enforcement implemented in M0
- **Allowlist logging** (`app/core/logging.py`): only the envelope fields plus
  `ALLOWED_EXTRA_FIELDS` are emitted; request bodies, headers, cookies and query strings
  are never logged. The access record uses the route *template*, not the raw path.
- Redaction filter as a backstop for free-text messages and tracebacks.
- uvicorn's own access log is disabled (it logs query strings).
- nginx access log format uses `$uri` (no `$args`, no cookies).
- Settings errors never echo input values (`hide_input_in_errors`).
- Default `Referrer-Policy: strict-origin-when-cross-origin`; token-bearing pages (M2) will
  use `no-referrer`, and email links carry tokens in URL fragments.

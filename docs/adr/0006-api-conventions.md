# ADR 0006 — API conventions

- Status: Accepted
- Plan reference: §3, R4, V2.6

## Decision
- Base path `/api/v1`; additive changes within v1; breaking changes go to `/api/v2` with
  `Deprecation`/`Sunset` headers on v1. Health endpoints (`/healthz`, `/readyz`) are
  unversioned and are not proxied publicly.
- Same-origin deployment (SPA and API behind one origin) ⇒ no CORS.
- **Errors**: RFC 9457 `application/problem+json` with `type`, `title`, `status`, `code`,
  `detail`, `request_id` and, for validation failures, `errors[{field, message}]`.
  Submitted input values are never echoed. Missing and inaccessible resources produce an
  identical 404 body. Unhandled errors return a generic 500 with no internals.
  (Implemented in M0: `app/core/errors.py`, `app/core/middleware.py`.)
- Lists: cursor pagination `{items, next_cursor}`, `limit` ≤ 100, allowlisted sorts.
- Concurrency: `ETag`/`If-Match` on mutable resources (412/428). Idempotency: the
  `Idempotency-Key` header on creates.
- Every response carries `X-Request-ID` (a valid inbound ID is propagated, otherwise one
  is generated).
- `backend/openapi.json` is generated (`make openapi`) and drift-checked in CI.

## Consequences
Clients handle one error shape; request IDs correlate client reports with server logs.

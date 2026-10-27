# ADR 0004 — Local identity and server-side sessions

- Status: Accepted (decisions A4, D1, D2, D3, D6, D7) — **implemented in M1** (M2 adds email verification/reset)
- Plan reference: R2, V2.3–V2.5, V3.1

## Decision
- Email + password with **Argon2id**; identity module shaped so OIDC/SAML can be added.
- **Open self-signup**, enumeration-safe: `POST /auth/signup` always returns `202` with no
  session cookie. Production signup stays disabled until M2 delivers email verification.
  Verification is required before creating an organization or accepting an invitation.
- **Server-side sessions**: opaque 32-byte token in `__Host-session` (Secure, HttpOnly,
  SameSite=Lax); only the SHA-256 hash is stored. Idle 24 h, absolute 14 d, no Remember
  Me, at most 20 active sessions per user (LRU eviction). Rotation on login, password
  change and email verification; password reset revokes all sessions.
- **Breached-password screening** at every password set: local denylist + Pwned Passwords
  k-anonymity range API (5-hex-char SHA-1 prefix only). If the range API is unavailable,
  fall back to the denylist only, with a metric and alert.

## Consequences
Sessions are revocable instantly; no JWT revocation problem. Auth endpoints and config
flags land in M1/M2; M0 contains none of them.

## M1 implementation notes
- **Argon2id** via `argon2-cffi` (defaults t=3, m=64 MiB, p=4; staging/prod refuse anything
  below OWASP minimums t=2, m=19 MiB). Hashes are upgraded transparently at login when
  parameters change. Unknown emails verify against a dummy hash.
- **Session token**: `secrets.token_urlsafe(32)`; only `sha256(token)` is stored. Validity
  (revoked / absolute / idle) is evaluated with the database clock. `last_seen_at` is
  written at most every 5 minutes.
- **CSRF**: the token is `HMAC(derived CSRF key, session token)`, so it is bound to the
  session, rotates with it and is never stored. *Deviation from plan §4.1 "hash stored":
  same security property, no extra column.* All unsafe routes also require
  `Origin == APP_BASE_URL` (login-CSRF defense); non-browser clients must send `Origin`
  until API tokens exist.
- **Key derivation**: one `APP_SECRET_KEY` with domain-separated keys for CSRF, email HMAC
  and rate-limit keys (`app/core/security.py`).
- **Rate limits** are taken with an atomic reserve (Lua) before verification and released on
  success, so concurrent attempts cannot bypass them (security review F1). Redis sliding
  window, per-process fallback when Redis is down: login 5/min
  per (IP, email) and 30/min per IP (failures), signup 5/h per IP, password change 5/15 min
  per user (*addition*: protects current-password guessing).
- **Security events** go to `security.platform_security_events` (INSERT-only for runtime
  roles), with a per-event metadata allowlist; unknown emails are stored as HMACs only.

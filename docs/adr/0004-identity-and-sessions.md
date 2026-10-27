# ADR 0004 — Local identity and server-side sessions

- Status: Accepted (decisions A4, D1, D2, D3, D6, D7) — implemented from M1, not in M0
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

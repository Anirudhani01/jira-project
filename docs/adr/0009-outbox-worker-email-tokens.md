# ADR 0009 — Transactional outbox, worker and email tokens (M2)

- **Status:** Accepted (M2), pending review
- **Plan references:** R2 (M2), R3.1, R4 (outbox rows), R5 (worker failures), C3, C4, V2.5,
  V2.7, D1, D13, D14

## Context
M2 adds email: verification after signup, a notice when someone signs up with an already
registered address, and password reset. Emails must never be sent for work that rolled
back, tokens must never be stored or logged in a reusable form, and the public signup /
reset contract (identical responses whatever the account state) must not change.

## Decision
1. **Transactional outbox.** The API inserts an `outbox` row in the same transaction as the
   business change (`app/modules/outbox/service.py`). Payloads are validated against a
   per-topic allowlist: identifiers only (`{"user_id": <uuid|null>}`). The API role has
   `INSERT` only (no `SELECT`/`UPDATE`/`DELETE`).
2. **Worker process** (`python -m app.worker`, role `app_worker`, `WORKER_DATABASE_URL`):
   claims up to 20 due jobs with `FOR UPDATE SKIP LOCKED` and a 5-minute lease, incrementing
   `attempts` at claim time. Handling happens outside the claim transaction, then the job is
   acked. At-least-once: a crash before the ack means redelivery once the lease expires.
   Failures retry after `min(6h, 1m·5^(n-1))` plus up to 10% jitter; after 10 attempts the
   job is dead-lettered (`dead_at`). Unknown topics and malformed payloads are dead-lettered
   at once. `last_error` stores the exception type only. Ack/fail are guarded by the
   `attempts` value seen at claim time, so a worker whose lease expired cannot overwrite
   the new owner's result. On SIGTERM/SIGINT the current job finishes and unstarted
   claimed jobs are released. The worker checks its own database role at startup, like the
   API.
3. **Operator CLI:** `python -m app.cli outbox list-dead` and `outbox requeue <id>` (worker
   role; prints ids, topics and error types, never payloads).
4. **Tokens are minted by the worker at send time** (`app/modules/identity/emails.py`), so
   the raw token exists only in memory and in the delivered email. `user_tokens` stores
   SHA-256 hashes; only the worker role may `INSERT`. At most 3 usable tokens per user and
   purpose (older ones are invalidated, so a duplicate delivery never breaks the earlier
   link). If sending fails, that attempt's token is invalidated at once, so undelivered
   tokens never count toward the cap and never push out a link the user received. A
   message accepted by the SMTP server counts as sent even if the closing `QUIT` fails.
   The handler refuses to mint anything while delivery is disabled. Lifetimes: verification 24 h, reset 1 h, checked against the database clock.
5. **Links carry the token in the URL fragment** (`/verify-email#token=…`,
   `/reset-password#token=…`); the SPA reads it, removes it from the address bar and posts
   it in a JSON body. Token pages use `Referrer-Policy: no-referrer` (nginx header and
   document meta).
6. **Consumption** is one conditional `UPDATE … RETURNING` (unused, not invalidated,
   unexpired), so concurrent submissions of one token cannot both succeed. Every failure is
   the same `400 invalid_token`.
   - Verification sets `email_verified_at`, invalidates the other verification tokens,
     revokes the owner's sessions and, if the request carried the owner's session, issues a
     rotated session (C3). The route requires the CSRF token when a session is present.
   - Reset: token checked → password policy (D3, `422`, token kept) → hash → in one
     transaction consume, set the password, mark the email verified, invalidate the other
     reset/verification tokens and revoke **every** session. No session is created.
7. **Signup branches** (unchanged `202`): `INSERT … ON CONFLICT DO NOTHING RETURNING id`,
   then the row is read back on every path. New or unverified → `email.verify`; verified →
   `email.signup_existing` (a notice with a link to `/forgot-password`, no token).
8. **Rate limits** (plan §4.5): signup emails and reset emails 3/hour per address, applied
   silently (the response never changes); reset requests 20/hour per IP (`429`); invalid
   token submissions 30/hour per IP (`429`, counted on failure only).
9. **Email delivery is off by default** (`EMAIL_DELIVERY_ENABLED=false`). With delivery off,
   the worker marks email jobs processed without minting tokens or sending anything, and
   `POST /auth/password-reset/request` answers `503 email_unavailable` for every address
   (a global condition, so it reveals nothing about accounts) instead of claiming a link was
   sent. Signup still answers `202` (prod cannot run signup without delivery, D1); its UI
   copy never claims an email was sent. Mail is
   sent with the Python standard library (`smtplib`, no SDK or paid API). Development and
   tests use **Mailpit** (free, local SMTP sink). Staging/prod require STARTTLS or TLS and
   SMTP credentials; the provider itself is still an open decision (D13) and must respect
   D14 (zero paid cost without approval).
10. **Least privilege for `app_worker`** (R3.1): no access to `user_sessions`; `SELECT` only
    on `users` (still subject to RLS); `SELECT/UPDATE` on `outbox`; `SELECT/INSERT/UPDATE`
    on `user_tokens`.

## Consequences
- Duplicate emails are possible (at-least-once). Both links work; `Message-ID` is stable per
  job (`<outbox-{id}@sender-domain>`) so clients and providers can spot duplicates.
- A reset request for an unknown address enqueues a no-op job, so the database work on
  both paths is the same.
- Signup rate-limited per address sends nothing for further attempts within the hour; the
  user waits or resets the password.
- **Temporary M2 decision, not an isolation assumption:** the outbox has no `org_id` and no
  RLS. That is safe only because every M2 topic is a global identity email keyed by user id;
  a unit test fails if a non-`email.` topic or an `org_id` payload key appears. M3 must add
  `org_id` and the R3.2 outbox policies before any tenant-scoped job exists.
- Email jobs processed while delivery was disabled are not replayed when it is enabled;
  users repeat signup or the reset request.
- No production email can be sent until a provider is chosen and configured (D13).

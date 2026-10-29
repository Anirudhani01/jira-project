# Log and trace retention

Application logs are structured JSON on stdout (no secrets, no email addresses, request ids
on every line). Retention is configured on the platform that collects them, not in the app.

| Signal | Retention | Where to configure |
|---|---|---|
| Application logs | 30 days | Render log streams / your log provider's retention setting |
| Traces | 14 days | Trace backend retention (when tracing is enabled) |
| Metrics | 13 months | Metrics backend |
| Database logs | 7 days | Managed Postgres settings |

## Checklist when setting up a new environment
- [ ] Log retention is set to 30 days and verified in the provider's UI.
- [ ] Logs are not forwarded to a destination outside the agreed regions.
- [ ] Alerts exist for: `/readyz` failing, `outbox.dead`, `retention.failed`, `rate_limit.backend_unavailable`.
- [ ] Access to logs is limited to the on-call group.

## OpenTelemetry
Tracing and metrics export are **not implemented yet** (see `docs/decisions.md`, M12 record).
When added, they must stay off by default and respect the retention above.

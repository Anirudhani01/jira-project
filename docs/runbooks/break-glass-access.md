# Break-glass database access

Operators have **no default access** to customer content (decision D5). Direct database
access is a last resort for an incident that cannot be resolved through the application.

## Rules
- Two people: one requests and acts, one approves. Neither is the same person.
- A ticket exists before access is granted. It states the incident, the data needed, and the
  expiry (default 4 hours, never more than 24).
- Access is time-boxed: a dedicated login role is created for the person and dropped at expiry.
- Everything run is logged; read-only access is the default.

## Procedure
1. **Request** (ticket): who, why, which tables, how long.
2. **Approve** (second person) in the ticket.
3. **Grant** (as the database superuser or `app_owner`):
   ```sql
   CREATE ROLE breakglass_<name> LOGIN NOINHERIT NOBYPASSRLS PASSWORD '<one-time-password>'
     VALID UNTIL '<expiry, UTC>';
   GRANT CONNECT ON DATABASE <db> TO breakglass_<name>;
   GRANT app_rw TO breakglass_<name>;          -- read within RLS; needs SET ROLE app_rw
   ```
   Row-level security still applies: the person sees nothing without binding a tenant context,
   which is intentional. Platform security events are readable by the
   `platform_security_reader` role only (`GRANT platform_security_reader TO breakglass_<name>`).
4. **Use** the access, writing queries and results references into the ticket (not the data).
5. **Revoke** at expiry or earlier:
   ```sql
   REVOKE app_rw, platform_security_reader FROM breakglass_<name>;
   DROP ROLE breakglass_<name>;
   ```
6. **Review**: the approver checks the database logs for the role and closes the ticket.

## Never
- Never share the `app_owner` credential, and never use it for investigation (it bypasses nothing
  but owns everything; use it only for migrations).
- Never copy customer data out of the production database for debugging.

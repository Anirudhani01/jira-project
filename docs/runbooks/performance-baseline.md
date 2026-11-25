# Performance baseline (k6)

First recorded run: **2026-11-25**, local stack. It answers whether the API meets the latency targets in the plan (read p95 < 300 ms, write p95 < 500 ms) at the assumed scale of up to **10,000 issues per project**.

## Verdict

| | Target | Measured | Result |
|---|---|---|---|
| Writes (create issue), p95 | < 500 ms | **97 ms** | pass |
| Reads (issue list, board, search), p95, 10 concurrent users | < 300 ms | **2.31 s** | **miss** |
| Failed requests | < 1% | 0% | pass |

Writes are comfortably fast. Reads are not at this scale, and the cause is understood (below). It does not affect small and medium projects: the same endpoints answer in 10 to 20 ms on a project with a handful of issues.

## What was run

| | |
|---|---|
| Data | one project with **10,117 issues** (10,000 seeded through the API plus 117 created by the write scenario), summaries cycling through ten words so the text search matches about one issue in ten |
| Load | `infra/k6/baseline.js`: 10 virtual users reading (issue list, board, search) and 2 writing (create issue) for one minute, one second between iterations |
| Stack | macOS laptop; PostgreSQL 17 and Redis in Docker (Colima); **one** uvicorn process without reload; k6 in Docker; rate limiting off (`RATE_LIMIT_ENABLED=false`) so latency is the application's, not the limiter's |
| Seeding | 10,000 issues created in 85 s at about 118 per second, 20 writers, create p95 190 ms, 0 failures (`infra/k6/seed.js`) |

These are **local figures, not production figures**. Use them as a baseline to compare against after changes, and re-run on the real environment once there is one.

## Per-endpoint view (single requests, no concurrency)

| Endpoint | Project with 6 issues | Project with 10,117 issues |
|---|---|---|
| Issue list (first page, ~30 issues) | 15 ms | 430 to 460 ms |
| Board | n/a | 440 to 455 ms (345 KB) |
| Search (`q=login`) | n/a | 320 to 385 ms |
| Project summary | 20 ms | 1.2 s |
| Project list | 14 ms | 340 to 350 ms |
| Anything not touching issues (session, issue types, priorities, project) | 10 to 20 ms | 10 to 20 ms |

Under 10 concurrent readers on a single process these queue up, which is why the p95 is 2.3 s.

## Why reads are slow at this size

Row-level security on `issues` (`issues_select`, migration `0007`) calls `app_can_view_project(project_id)` for every row a query touches. The function is `STABLE SECURITY DEFINER`, which the planner cannot inline, so it runs once per row: about 30 microseconds each.

`EXPLAIN ANALYZE` of the summary's status-count query, run as the application role with the tenant context set, shows the right index in use (`ix_issues_project_id_status_id_rank`) and the cost in the filter:

```
Index Scan using ix_issues_project_id_status_id_rank on issues i  (actual rows=2528 loops=4)
  Index Cond: ((project_id = ...) AND (status_id = ws.id))
  Filter: ((org_id = ...) AND app_can_view_project(project_id))
Execution Time: 321.828 ms
```

10,117 rows at about 30 microseconds is roughly 320 ms per scan. The project summary does four scans, hence 1.2 s. The list, board and search take 0.3 to 0.45 s at the same size, which is consistent with the same per-row cost, but only the summary's query was planned individually; confirm the others with `EXPLAIN ANALYZE` before changing them. Authentication, membership checks and everything else cost 10 to 20 ms.

**Rough capacity (extrapolated from these numbers, not measured):** single requests stay under 300 ms up to roughly 2,500 issues per project for the summary and roughly 6,000 for the list. Concurrency lowers that.

## Options (none done yet; backlog B3 in `docs/MVP-STATUS.md`)

1. **Evaluate project visibility once per query, not once per row.** Rewrite the `issues_select` policy (and its siblings) as a set-based test, for example `project_id IN (SELECT ... visible projects)`, which Postgres runs once as a hashed subplan. This removes the per-row function call for every issue query at once. It changes a security policy, so it needs an ADR note and the cross-tenant and RLS test suites as the safety net.
2. **Make the summary a single pass** over the issues (one scan with grouping sets instead of four). About a 3x gain for that endpoint alone; the other endpoints do not benefit.
3. **Check what the board loads.** Its response is 345 KB for this project; if it grows with project size, load it per column and page the rest.
4. **Run more than one API process** in production. It helps concurrency, not the single-request time.

Option 1 is the real fix; re-run this baseline after it.

## How to re-run

Needs Docker (nothing else is installed; the k6 image is `grafana/k6`). On Colima, containers only see your home directory, so keep the scripts and output there (for example the git-ignored `.tmp/`).

1. Start the stack and the API **without** `--reload`, bound to loopback; the container reaches it as `host.docker.internal`. Set `RATE_LIMIT_ENABLED=false` and `APP_BASE_URL` to the origin you will send.
2. Log in and note the cookie and CSRF token: `POST /api/v1/auth/login`, then `GET /api/v1/auth/session` for `csrf_token`. Note an issue type id and a priority id (`GET /orgs/<org>/issue-types`, `/priorities`).
3. Create a throwaway project, then seed it:
   ```bash
   docker run --rm -v "$PWD/infra/k6:/scripts:ro" grafana/k6 run \
     -e BASE_URL=http://host.docker.internal:7001 -e ORG=demo -e PROJECT=LOAD \
     -e SESSION=<cookie value> -e CSRF=<token> -e TYPE_ID=<id> -e PRIORITY_ID=<id> \
     -e ORIGIN=<APP_BASE_URL> -e COOKIE_NAME=session -e COUNT=10000 /scripts/seed.js
   ```
4. Run `/scripts/baseline.js` with the same `-e` values (add `-v "$PWD/.tmp/k6:/out" --summary-export /out/baseline-summary.json` to keep the numbers). k6 exits with 99 when a threshold is crossed.
5. Clean up: archive the project (`POST /api/v1/orgs/<org>/projects/<key>/archive`) and soft-delete its issues, or reset the local database.

`COOKIE_NAME` is `session` in the local dev stack and `__Host-session` (the default) when `COOKIE_SECURE` is on.

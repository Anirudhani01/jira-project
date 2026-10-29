// k6 baseline for the API (plan M12). Not run in CI; run before a release against a
// production-like environment seeded with the assumed scale (see docs/runbooks).
//
//   k6 run -e BASE_URL=http://localhost:8001 -e ORG=acme -e PROJECT=WEB \
//          -e SESSION=<__Host-session cookie value> -e CSRF=<csrf token> infra/k6/baseline.js
//
// Thresholds mirror the NFRs: p95 < 300 ms reads, < 500 ms writes.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8001';
const ORG = __ENV.ORG || 'acme';
const PROJECT = __ENV.PROJECT || 'WEB';
const jar = { Cookie: `__Host-session=${__ENV.SESSION || ''}` };
const write = { ...jar, 'X-CSRF-Token': __ENV.CSRF || '', 'Content-Type': 'application/json',
  Origin: __ENV.ORIGIN || 'http://localhost:5173' };

export const options = {
  scenarios: {
    reads: { executor: 'constant-vus', vus: 10, duration: '1m', exec: 'reads' },
    writes: { executor: 'constant-vus', vus: 2, duration: '1m', exec: 'writes' },
  },
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:write}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function reads() {
  const list = http.get(`${BASE}/api/v1/orgs/${ORG}/issues?project=${PROJECT}`, { headers: jar, tags: { kind: 'read' } });
  const board = http.get(`${BASE}/api/v1/orgs/${ORG}/projects/${PROJECT}/board`, { headers: jar, tags: { kind: 'read' } });
  const search = http.get(`${BASE}/api/v1/orgs/${ORG}/issues?q=login`, { headers: jar, tags: { kind: 'read' } });
  check(list, { 'issues 200': (r) => r.status === 200 });
  check(board, { 'board 200': (r) => r.status === 200 });
  check(search, { 'search 200': (r) => r.status === 200 });
  sleep(1);
}

let counter = 0;
export function writes() {
  counter += 1;
  const key = `k6-${__VU}-${__ITER}-${counter}`;
  const response = http.post(
    `${BASE}/api/v1/orgs/${ORG}/projects/${PROJECT}/issues`,
    JSON.stringify({ type_id: __ENV.TYPE_ID, priority_id: __ENV.PRIORITY_ID, summary: `k6 ${key}` }),
    { headers: { ...write, 'Idempotency-Key': key }, tags: { kind: 'write' } },
  );
  check(response, { 'created 201': (r) => r.status === 201 });
  sleep(1);
}

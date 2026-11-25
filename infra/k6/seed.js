// Seeds a project with many issues before the baseline (the plan assumes up to 10,000 issues
// per project). Creates COUNT issues (default 10000) through the API, 20 at a time.
//
//   k6 run -e BASE_URL=... -e ORG=demo -e PROJECT=LOAD -e SESSION=... -e CSRF=... \
//          -e TYPE_ID=... -e PRIORITY_ID=... -e ORIGIN=... -e COOKIE_NAME=session infra/k6/seed.js
//
// Summaries cycle through a few words, so the baseline's text search ("login") matches about
// one issue in ten.
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8001';
const ORG = __ENV.ORG || 'acme';
const PROJECT = __ENV.PROJECT || 'WEB';
const COOKIE = __ENV.COOKIE_NAME || '__Host-session';
const WORDS = ['login', 'checkout', 'board', 'search', 'report', 'profile', 'upload', 'email', 'payment', 'dashboard'];
const headers = {
  Cookie: `${COOKIE}=${__ENV.SESSION || ''}`,
  'X-CSRF-Token': __ENV.CSRF || '',
  'Content-Type': 'application/json',
  Origin: __ENV.ORIGIN || 'http://localhost:5173',
};

export const options = {
  scenarios: {
    seed: {
      executor: 'shared-iterations',
      vus: 20,
      iterations: Number(__ENV.COUNT || 10000),
      maxDuration: '20m',
    },
  },
  thresholds: { http_req_failed: ['rate<0.01'] },
};

export default function () {
  const n = exec.scenario.iterationInTest;
  const response = http.post(
    `${BASE}/api/v1/orgs/${ORG}/projects/${PROJECT}/issues`,
    JSON.stringify({
      type_id: __ENV.TYPE_ID,
      priority_id: __ENV.PRIORITY_ID,
      summary: `${WORDS[n % WORDS.length]} issue ${n}`,
    }),
    { headers: { ...headers, 'Idempotency-Key': `seed-${PROJECT}-${n}` } },
  );
  check(response, { 'created 201': (r) => r.status === 201 });
}

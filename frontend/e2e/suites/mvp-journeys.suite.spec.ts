import { test } from '@playwright/test';

import { mvpScenarios } from './mvp/scenarios';

/**
 * PLAN §1.2 — all MVP user journeys in one suite. Scenario bodies live in
 * `suites/mvp/scenarios.ts` (single source of truth; no duplicate spec files).
 *
 * Run the full suite:  `make e2e-journeys` or `pnpm e2e:journeys`
 * Run one PLAN journey: `pnpm e2e:journeys --grep @journey-07`
 * Smoke subset:         `pnpm e2e:journeys:smoke`
 */
test.describe('MVP user journeys (PLAN §1.2)', { tag: '@mvp' }, () => {
  test.describe.configure({ mode: 'serial' });

  for (const scenario of mvpScenarios) {
    const tags = [`@journey-${scenario.planJourney}`, `@scenario-${scenario.id}`];
    if (scenario.smoke) tags.push('@mvp-smoke');
    test(
      `Journey ${scenario.planJourney} (${scenario.id}) — ${scenario.title}`,
      { tag: tags },
      async ({ page, request, browser }) => {
        await scenario.run({ page, request, browser });
      },
    );
  }
});

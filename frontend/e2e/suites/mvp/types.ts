import type { APIRequestContext, Browser, Page } from '@playwright/test';

/** Fixtures passed to each MVP journey scenario (PLAN §1.2). */
export type MvpFixtures = {
  page: Page;
  request: APIRequestContext;
  browser: Browser;
};

export type MvpScenario = {
  /** PLAN §1.2 journey number (`01`–`10`) for `@journey-NN` tags. */
  planJourney: string;
  /** Unique scenario id for reports and `@scenario-*` tags (e.g. `03-kanban`). */
  id: string;
  title: string;
  /** Included in `pnpm e2e:journeys:smoke` / `@mvp-smoke`. */
  smoke?: boolean;
  run: (fixtures: MvpFixtures) => Promise<void>;
};

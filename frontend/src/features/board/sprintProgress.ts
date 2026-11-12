const DAY_MS = 86_400_000;

export interface SprintTimeProgress {
  elapsedDays: number;
  totalDays: number;
  /** 0–100, rounded. */
  percent: number;
}

/** How much of the sprint's time has passed. `null` when either date is missing or invalid. */
export function sprintTimeProgress(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  now: Date = new Date(),
): SprintTimeProgress | null {
  if (!startAt || !endAt) return null;
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const totalDays = Math.max(1, Math.round((end - start) / DAY_MS));
  const elapsedDays = Math.min(
    totalDays,
    Math.max(0, Math.floor((now.getTime() - start) / DAY_MS)),
  );
  return { elapsedDays, totalDays, percent: Math.round((elapsedDays / totalDays) * 100) };
}

/** Share of issues done, 0–100. `null` when there are no issues to measure. */
export function donePercent(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((Math.min(done, total) / total) * 100);
}

export interface ProjectSuggestInput {
  key: string;
  name: string;
}

export interface ProjectSuggestResult {
  label: string;
  applyValue: string;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const ai = a[i - 1];
      const bj = b[j - 1];
      if (ai === undefined || bj === undefined) continue;
      const cost = ai === bj ? 0 : 1;
      const del = (curr[j - 1] ?? 0) + 1;
      const ins = (prev[j] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

function sharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

function maxEditDistance(queryLength: number): number {
  return queryLength >= 6 ? 2 : 1;
}

type MatchCandidate = {
  distance: number;
  preferKey: boolean;
  label: string;
  applyValue: string;
  projectKey: string;
};

function bestMatchForProject(
  query: string,
  project: ProjectSuggestInput,
  maxDist: number,
): MatchCandidate | null {
  const key = project.key.toLowerCase();
  const name = project.name.toLowerCase();
  let best: MatchCandidate | null = null;

  for (const [text, preferKey, label, applyValue] of [
    [key, true, project.key, project.key] as const,
    [name, false, project.name, project.name] as const,
  ]) {
    if (sharedPrefixLength(query, text) < 2) continue;
    const distance = levenshtein(query, text);
    if (distance === 0 || distance > maxDist) continue;

    const candidate: MatchCandidate = {
      distance,
      preferKey,
      label,
      applyValue,
      projectKey: project.key,
    };

    if (!best) {
      best = candidate;
      continue;
    }
    if (candidate.distance < best.distance) {
      best = candidate;
      continue;
    }
    if (candidate.distance === best.distance && candidate.preferKey && !best.preferKey) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Conservative typo suggestion for project search (name/key corpus only).
 * Returns at most one candidate; null on ties, weak matches, or short queries.
 */
export function suggestProjectQuery(
  query: string,
  projects: ProjectSuggestInput[],
): ProjectSuggestResult | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3 || projects.length === 0) return null;

  const maxDist = maxEditDistance(q.length);
  const matches: MatchCandidate[] = [];

  for (const project of projects) {
    const match = bestMatchForProject(q, project, maxDist);
    if (match) matches.push(match);
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.preferKey !== b.preferKey) return a.preferKey ? -1 : 1;
    return a.projectKey.localeCompare(b.projectKey);
  });

  const bestDistance = matches[0]?.distance;
  if (bestDistance === undefined) return null;

  const atBest = matches.filter((m) => m.distance === bestDistance);
  if (atBest.length !== 1) return null;

  const winner = atBest[0];
  if (!winner) return null;
  return { label: winner.label, applyValue: winner.applyValue };
}

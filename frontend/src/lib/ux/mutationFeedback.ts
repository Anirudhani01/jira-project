export type ToastFn = (input: {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error';
}) => void;

const MAX_ENTRIES = 200;
const MAX_AGE_MS = 10 * 60 * 1000;

const shownSuccessByInvocation = new Map<string, number>();

function pruneFeedbackRegistry(now: number): void {
  for (const [id, shownAt] of shownSuccessByInvocation) {
    if (now - shownAt > MAX_AGE_MS) shownSuccessByInvocation.delete(id);
  }
  if (shownSuccessByInvocation.size <= MAX_ENTRIES) return;
  const sorted = [...shownSuccessByInvocation.entries()].sort((a, b) => a[1] - b[1]);
  const removeCount = shownSuccessByInvocation.size - MAX_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    const entry = sorted[i];
    if (entry) shownSuccessByInvocation.delete(entry[0]);
  }
}

/** One id per user-initiated action; share across duplicate success callbacks for that action. */
export function createFeedbackInvocationId(): string {
  return crypto.randomUUID();
}

/**
 * Shows at most one success toast per feedbackInvocationId. Returns false if suppressed.
 */
export function showSuccessToast(
  toast: ToastFn,
  input: {
    feedbackInvocationId: string;
    title: string;
    description?: string;
  },
): boolean {
  const id = input.feedbackInvocationId.trim();
  if (!id) return false;

  const now = Date.now();
  pruneFeedbackRegistry(now);

  if (shownSuccessByInvocation.has(id)) return false;

  shownSuccessByInvocation.set(id, now);
  toast({
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    variant: 'success',
  });
  return true;
}

/** Test helper */
export function resetMutationFeedbackForTests(): void {
  shownSuccessByInvocation.clear();
}

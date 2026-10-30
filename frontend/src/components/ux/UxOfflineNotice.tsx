import { cn } from '../../lib/cn';

export type UxOfflineNoticeVariant = 'banner' | 'inline';

export interface UxOfflineNoticeProps {
  offline: boolean;
  variant?: UxOfflineNoticeVariant;
  message?: string;
  className?: string;
}

const DEFAULT_MESSAGE =
  'You appear to be offline. You can still view content that is already loaded, but saving and other network actions are unavailable until connection returns.';

export function UxOfflineNotice({
  offline,
  variant = 'banner',
  message = DEFAULT_MESSAGE,
  className,
}: UxOfflineNoticeProps) {
  if (!offline) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'text-sm text-fg',
        variant === 'banner'
          ? 'rounded-lg border border-warning/40 bg-warning/10 px-4 py-3'
          : 'text-fg-muted',
        className,
      )}
    >
      {message}
    </p>
  );
}

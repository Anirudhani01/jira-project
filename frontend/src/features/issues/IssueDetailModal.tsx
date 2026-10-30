import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { IconButton } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

import { IssueDetailPage } from './IssueDetailPage';
import { readIssueDetailModalState } from './issueDetailNavigation';

/** PR 5a — issue detail over board/list/backlog via background-location routing. */
export function IssueDetailModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const modalState = readIssueDetailModalState(location.state);

  const close = () => {
    if (!modalState) return;
    const { pathname, search, hash } = modalState.backgroundLocation;
    void navigate(`${pathname}${search}${hash}`, { replace: true, state: null });
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/45" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-[3vh] z-[70] flex max-h-[94vh] w-[min(96vw,72rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl',
            'focus:outline-none',
          )}
          onEscapeKeyDown={close}
        >
          <div className="flex shrink-0 items-center justify-end border-b border-line px-3 py-2">
            <DialogPrimitive.Close asChild>
              <IconButton label="Close issue" size="sm" onClick={close}>
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <IssueDetailPage presentation="modal" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

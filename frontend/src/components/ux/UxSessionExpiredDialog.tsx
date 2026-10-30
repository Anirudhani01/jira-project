import { Button } from '../ui/Button';
import { Dialog, DialogContent } from '../ui/Overlay';

export interface UxSessionExpiredDialogProps {
  open: boolean;
  recoverableField: 'summary' | 'description' | null;
  persistError: string | null;
  navigationError: string | null;
  onContinue: () => void;
  onContinueWithoutRecovery: () => void;
  onRetryPersist: () => void;
}

export function UxSessionExpiredDialog({
  open,
  recoverableField,
  persistError,
  navigationError,
  onContinue,
  onContinueWithoutRecovery,
  onRetryPersist,
}: UxSessionExpiredDialogProps) {
  const recoveryHint =
    recoverableField === 'summary'
      ? 'If you were editing the issue summary, you can restore that text after you sign in again on the same issue. Nothing is saved to the server until you press Save.'
      : recoverableField === 'description'
        ? 'If you were editing the issue description, you can restore that text after you sign in again on the same issue. Nothing is saved to the server until you press Save.'
        : 'Sign in again to continue working. Edits on other pages are not recovered automatically.';

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        /* Session expiry requires an explicit action. */
      }}
    >
      <DialogContent
        title="Session expired"
        description="Your sign-in session is no longer valid."
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
        }}
      >
        <div className="space-y-4 text-sm text-fg">
          <p>{recoveryHint}</p>
          {persistError ? (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger"
            >
              {persistError} You can retry saving the draft for recovery or continue without saving
              it.
            </p>
          ) : null}
          {navigationError ? (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger"
            >
              {navigationError}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {navigationError ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={onContinueWithoutRecovery}>
                  Continue without recovery
                </Button>
                <Button type="button" variant="primary" size="sm" onClick={onContinue}>
                  Retry sign in
                </Button>
              </>
            ) : persistError ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={onContinueWithoutRecovery}>
                  Continue without recovery
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={onRetryPersist}>
                  Retry saving draft
                </Button>
              </>
            ) : recoverableField ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={onContinueWithoutRecovery}>
                  Continue without recovery
                </Button>
                <Button type="button" variant="primary" size="sm" onClick={onContinue}>
                  Continue to sign in
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" size="sm" onClick={onContinue}>
                Continue to sign in
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

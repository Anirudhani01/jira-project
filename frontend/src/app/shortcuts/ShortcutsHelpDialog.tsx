import { Button } from '../../components/ui/Button';
import { Dialog, DialogContent } from '../../components/ui/Overlay';

import { GROUPS, SHORTCUTS, keysLabel } from './shortcutDefs';

/** The shortcut cheat sheet, opened with `?` or the Help button, with the on/off switch. */
export function ShortcutsHelpDialog({
  enabled,
  onEnabledChange,
  onClose,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="Keyboard shortcuts"
        description="Single-key shortcuts work when you are not typing in a field."
        className="w-[min(94vw,42rem)]"
      >
        <label className="mb-3 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              onEnabledChange(event.target.checked);
            }}
          />
          Keyboard shortcuts are enabled
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group} aria-label={group}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {group}
              </h3>
              <dl className="space-y-1 text-sm">
                {SHORTCUTS.filter((s) => s.group === group).map((shortcut) => (
                  <div key={shortcut.id} className="flex items-center justify-between gap-3">
                    <dt>{shortcut.description}</dt>
                    <dd>
                      <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                        {keysLabel(shortcut.keys)}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

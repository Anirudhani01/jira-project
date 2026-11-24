import { Bookmark, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState, type SyntheticEvent } from 'react';

import { Button, IconButton } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { Field, Input } from '../../components/ui/Input';
import {
  Dialog,
  DialogContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/Overlay';
import { useToast } from '../../components/ui/Toast';
import type { SavedFilter } from '../../lib/api/types';
import { cn } from '../../lib/cn';
import { createFeedbackInvocationId, showSuccessToast } from '../../lib/ux/mutationFeedback';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';

import { filtersToParams, savedParamsMatch } from './issueListSearchParams';
import {
  useCreateSavedFilter,
  useDeleteSavedFilter,
  useRenameSavedFilter,
  useSavedFilters,
} from './savedFilters';

type Dialogue =
  | { kind: 'save' }
  | { kind: 'rename'; filter: SavedFilter }
  | { kind: 'delete'; filter: SavedFilter };

function NameDialog({
  org,
  project,
  params,
  filter,
  onClose,
}: {
  org: string;
  project: string;
  params: Record<string, string>;
  filter?: SavedFilter;
  onClose: () => void;
}) {
  const create = useCreateSavedFilter(org, project);
  const rename = useRenameSavedFilter(org, project);
  const toast = useToast();
  const [name, setName] = useState(filter?.name ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  const mutation = filter ? rename : create;
  const trimmed = name.trim();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!trimmed || mutation.isPending) return;
    const done = (title: string) => () => {
      showSuccessToast(toast, { feedbackInvocationId: createFeedbackInvocationId(), title });
      onClose();
    };
    if (filter) {
      rename.mutate({ id: filter.id, name: trimmed }, { onSuccess: done('Filter renamed') });
    } else {
      create.mutate({ name: trimmed, params }, { onSuccess: done('Filter saved') });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={filter ? 'Rename saved filter' : 'Save current filters'}
        {...(filter ? {} : { description: 'Only you can see your saved filters.' })}
        className="w-[min(92vw,26rem)]"
        onOpenAutoFocus={(event) => {
          // Start in the name field, not on the dialog's close button.
          event.preventDefault();
          nameRef.current?.focus();
          nameRef.current?.select();
        }}
      >
        <form onSubmit={submit} className="space-y-3">
          <FormError>
            {mutation.error ? mutationErrorMessage(mutation.error, 'generic-project') : null}
          </FormError>
          <Field label="Name">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                ref={nameRef}
                maxLength={60}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!trimmed || mutation.isPending}
              aria-busy={mutation.isPending}
            >
              {filter ? 'Rename' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  org,
  project,
  filter,
  onClose,
}: {
  org: string;
  project: string;
  filter: SavedFilter;
  onClose: () => void;
}) {
  const remove = useDeleteSavedFilter(org, project);
  const toast = useToast();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={`Delete “${filter.name}”?`}
        description="This removes the saved filter. Your issues are not affected."
        className="w-[min(92vw,26rem)]"
      >
        <FormError>
          {remove.error ? mutationErrorMessage(remove.error, 'generic-project') : null}
        </FormError>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={remove.isPending}
            aria-busy={remove.isPending}
            onClick={() => {
              remove.mutate(filter.id, {
                onSuccess: () => {
                  showSuccessToast(toast, {
                    feedbackInvocationId: createFeedbackInvocationId(),
                    title: 'Filter deleted',
                  });
                  onClose();
                },
              });
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Saved filters" menu for the issue list: apply, rename or delete your own named filters and
 * save the current ones. Applying replaces the filters, search text and sort in the URL. */
export function SavedFiltersMenu({
  org,
  project,
  search,
  onApply,
}: {
  org: string;
  project: string;
  search: URLSearchParams;
  onApply: (params: Record<string, string>) => void;
}) {
  const saved = useSavedFilters(org, project);
  const [open, setOpen] = useState(false);
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const current = filtersToParams(search);
  const canSave = Object.keys(current).length > 0;
  const items = saved.data ?? [];

  const openDialogue = (next: Dialogue) => {
    setOpen(false);
    setDialogue(next);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="secondary" size="sm">
            <Bookmark className="size-4" aria-hidden="true" />
            Saved filters
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label="Saved filters"
          className="w-[min(20rem,calc(100vw-2rem))] p-1.5"
        >
          <div className="max-h-72 overflow-y-auto">
            {saved.isPending ? (
              <p role="status" className="px-2 py-3 text-sm text-fg-muted">
                Loading saved filters…
              </p>
            ) : saved.isError ? (
              <div role="alert" className="space-y-2 px-2 py-3 text-sm">
                <p className="text-danger">Could not load your saved filters.</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void saved.refetch();
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-2 py-3 text-sm text-fg-muted">
                No saved filters yet. Set some filters, then save them here.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {items.map((filter) => {
                  const active = savedParamsMatch(search, filter.params);
                  return (
                    <li key={filter.id} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          onApply(filter.params);
                          setOpen(false);
                        }}
                        className={cn(
                          'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent',
                          active ? 'bg-accent-soft font-medium text-fg' : 'text-fg',
                        )}
                      >
                        {filter.name}
                      </button>
                      <IconButton
                        label={`Rename ${filter.name}`}
                        size="sm"
                        onClick={() => {
                          openDialogue({ kind: 'rename', filter });
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Delete ${filter.name}`}
                        size="sm"
                        onClick={() => {
                          openDialogue({ kind: 'delete', filter });
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-1 border-t border-line pt-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              disabled={!canSave}
              onClick={() => {
                openDialogue({ kind: 'save' });
              }}
            >
              Save current filters…
            </Button>
            {canSave ? null : (
              <p className="px-3 pb-1 text-xs text-fg-muted">Set a filter or search to save it.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {dialogue?.kind === 'save' ? (
        <NameDialog
          org={org}
          project={project}
          params={current}
          onClose={() => {
            setDialogue(null);
          }}
        />
      ) : null}
      {dialogue?.kind === 'rename' ? (
        <NameDialog
          org={org}
          project={project}
          params={current}
          filter={dialogue.filter}
          onClose={() => {
            setDialogue(null);
          }}
        />
      ) : null}
      {dialogue?.kind === 'delete' ? (
        <DeleteDialog
          org={org}
          project={project}
          filter={dialogue.filter}
          onClose={() => {
            setDialogue(null);
          }}
        />
      ) : null}
    </>
  );
}

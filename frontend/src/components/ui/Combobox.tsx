import { Command } from 'cmdk';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useId, useState, type ReactNode, type Ref } from 'react';

import { cn } from '../../lib/cn';

import { Popover, PopoverContent, PopoverTrigger } from './Overlay';

export interface ComboOption {
  value: string;
  label: string;
  /** Secondary text shown after the label (e.g. an issue summary or an email). */
  description?: string;
  icon?: ReactNode;
  /** Extra words that match when searching (client-side filtering only). */
  keywords?: string[];
}

interface BaseProps {
  /** Visible label and accessible name. */
  label: string;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  error?: string | null;
  /** Server-side search: when set, options are shown as given (no client filtering) and the
   * typed text is reported so the caller can fetch matches. */
  onSearch?: (query: string) => void;
  loading?: boolean;
  className?: string;
  /** Lets a form focus the control when it holds the first invalid value. */
  triggerRef?: Ref<HTMLButtonElement>;
}
interface SingleProps extends BaseProps {
  multiple?: false;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Adds a first row that clears the value (e.g. "Unassigned"). */
  clearLabel?: string;
}
interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}
export type ComboboxProps = SingleProps | MultiProps;

/** Searchable picker (single or multi). The trigger is a `combobox` button named by its
 * label; the list is a `listbox` with keyboard navigation (cmdk). */
export function Combobox({ triggerRef, ...props }: ComboboxProps) {
  const { label, options, disabled, error, onSearch, loading, className } = props;
  const clearLabel = props.multiple ? undefined : props.clearLabel;
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  const errorId = useId();
  const selected = props.multiple ? props.value : props.value ? [props.value] : [];
  const byValue = new Map(options.map((o) => [o.value, o]));
  const chosen = selected.map((value) => byValue.get(value)).filter((o): o is ComboOption => !!o);

  const pick = (value: string) => {
    if (props.multiple) {
      props.onChange(
        props.value.includes(value)
          ? props.value.filter((v) => v !== value)
          : [...props.value, value],
      );
      return;
    }
    props.onChange(value);
    setOpen(false);
  };

  const summary = props.multiple
    ? chosen.length === 0
      ? (props.placeholder ?? 'None')
      : chosen.map((o) => o.label).join(', ')
    : (chosen[0]?.label ?? clearLabel ?? props.placeholder ?? 'None');

  return (
    <div className={cn('space-y-1', className)}>
      <span id={labelId} className="block text-[13px] font-medium text-fg">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-labelledby={`${labelId} ${valueId}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            disabled={disabled}
            className={cn(
              'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-sm hover:border-fg-subtle disabled:opacity-60',
              error && 'border-danger',
            )}
          >
            <span id={valueId} className="flex min-w-0 items-center gap-2">
              {!props.multiple && chosen[0]?.icon ? chosen[0].icon : null}
              <span
                className={cn('truncate', chosen.length === 0 && !clearLabel && 'text-fg-subtle')}
              >
                {summary}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
        >
          <Command shouldFilter={!onSearch} label={`Search ${label}`} loop>
            <div className="flex items-center border-b border-line px-2">
              <Command.Input
                placeholder={props.searchPlaceholder ?? 'Search…'}
                {...(onSearch ? { onValueChange: onSearch } : {})}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle"
              />
            </div>
            <Command.List className="max-h-60 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-3 text-center text-sm text-fg-muted">
                {loading ? 'Searching…' : (props.emptyText ?? 'No matches')}
              </Command.Empty>
              {!props.multiple && clearLabel ? (
                <Command.Item
                  value="__clear__"
                  keywords={[clearLabel]}
                  onSelect={() => {
                    props.onChange(null);
                    setOpen(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-surface-hover"
                >
                  <X className="size-4 text-fg-subtle" aria-hidden="true" />
                  {clearLabel}
                </Command.Item>
              ) : null}
              {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <Command.Item
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, option.description ?? '', ...(option.keywords ?? [])]}
                    onSelect={() => {
                      pick(option.value);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-surface-hover"
                  >
                    {option.icon}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                      {option.description ? (
                        <span className="ml-2 text-xs text-fg-muted">{option.description}</span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <Check className="size-4 text-accent" aria-label="Selected" />
                    ) : null}
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

import { CalendarDays, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import {
  compareDays,
  DATE_PRESETS,
  formatRangeLabel,
  isoToRange,
  isSameDay,
  normaliseRange,
  presetRange,
  rangeToIso,
  startOfDay,
  timeValue,
  weekStartFor,
  withTime,
  type DateRange,
  type WeekStart,
} from '../../lib/dateRange';
import { cn } from '../../lib/cn';

import { Button } from './Button';
import { DateRangeCalendar } from './DateRangeCalendar';
import { Popover, PopoverContent, PopoverTrigger } from './Overlay';

export interface IsoRange {
  from: string | null;
  to: string | null;
}

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });

const timeInputClass =
  'h-7 w-full rounded-md border border-control bg-surface px-2 text-sm text-fg disabled:opacity-50';

function RangePanel({
  range,
  now,
  weekStart,
  onApply,
  onClose,
}: {
  range: DateRange;
  now: Date;
  weekStart: WeekStart;
  onApply: (range: IsoRange) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState<Date | null>(range.from ? startOfDay(range.from) : null);
  const [end, setEnd] = useState<Date | null>(range.to ? startOfDay(range.to) : null);
  const [startTime, setStartTime] = useState(range.from ? timeValue(range.from) : '00:00');
  const [endTime, setEndTime] = useState(range.to ? timeValue(range.to) : '23:59');
  const [focusDay, setFocusDay] = useState(() => start ?? end ?? startOfDay(now));
  const [hover, setHover] = useState<Date | null>(null);
  const [message, setMessage] = useState('');

  const pick = (day: Date) => {
    if (!start || end) {
      setStart(day);
      setEnd(null);
      setMessage(`Start ${DAY_FORMAT.format(day)}. Choose an end day.`);
      return;
    }
    if (compareDays(day, start) < 0) {
      setEnd(start);
      setStart(day);
    } else {
      setEnd(day);
    }
    setMessage('Range selected. Press Apply.');
  };

  const sameDayBackwards = Boolean(start && end && isSameDay(start, end) && endTime < startTime);
  const apply = () => {
    const next = normaliseRange({
      from: start ? withTime(start, startTime, 'start') : null,
      to: end ? withTime(end, endTime, 'end') : null,
    });
    onApply(rangeToIso(next));
  };

  return (
    <div className="flex flex-col sm:flex-row">
      <div className="grid grid-cols-2 gap-0.5 border-b border-line p-1.5 sm:flex sm:w-32 sm:flex-col sm:border-b-0 sm:border-r">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              onApply(rangeToIso(presetRange(preset.id, now)));
            }}
            className="rounded-md px-2.5 py-1.5 text-left text-[13px] text-fg outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-2 p-2.5">
        <DateRangeCalendar
          focusDay={focusDay}
          onFocusDayChange={setFocusDay}
          start={start}
          end={end}
          hover={hover}
          onHoverChange={setHover}
          onPick={pick}
          weekStart={weekStart}
          today={startOfDay(now)}
          focusOnMount
        />
        <p className="text-xs leading-snug text-fg-muted">
          {start && !end
            ? 'Pick an end day, or Apply for no end.'
            : 'Pick a start day, then an end day.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Start time
            <input
              type="time"
              value={startTime}
              disabled={!start}
              onChange={(event) => {
                setStartTime(event.target.value);
              }}
              className={timeInputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            End time
            <input
              type="time"
              value={endTime}
              disabled={!end}
              onChange={(event) => {
                setEndTime(event.target.value);
              }}
              className={timeInputClass}
            />
          </label>
        </div>
        {sameDayBackwards ? (
          <p role="alert" className="text-xs text-danger">
            The end time must be after the start time.
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="sr-only">
          {message}
        </p>
        {/* Pinned to the bottom of the popover so Apply stays visible when it scrolls. */}
        <div className="sticky bottom-0 -mx-2.5 -mb-2.5 flex items-center justify-between gap-2 border-t border-line bg-surface p-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onApply({ from: null, to: null });
            }}
          >
            Clear
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={(!start && !end) || sameDayBackwards}
              onClick={apply}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Date range filter: a button showing the range that opens a calendar popover with quick ranges,
 * a day range and optional times. `from` / `to` are ISO instants (as kept in the URL); nothing is
 * reported until Apply or a quick range, so the page does not refetch on every click. Times are
 * in the browser's local timezone. */
export function DateRangePicker({
  label,
  from,
  to,
  onChange,
  weekStart,
  now,
}: {
  label: string;
  from: string | null;
  to: string | null;
  onChange: (range: IsoRange) => void;
  /** First day of the week; defaults to the browser locale's. */
  weekStart?: WeekStart;
  /** Reference "now" (tests); defaults to the current time when the popover opens. */
  now?: Date;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  const range = useMemo(() => isoToRange(from, to), [from, to]);
  const hasValue = Boolean(range.from ?? range.to);
  const firstDay = weekStart ?? weekStartFor(undefined);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={labelId}>{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <div
          className={cn(
            'inline-flex h-8 max-w-full items-center rounded-md border border-control bg-surface text-sm text-fg',
            'focus-within:ring-2 focus-within:ring-accent',
          )}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-labelledby={`${labelId} ${valueId}`}
              className="inline-flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-3 outline-none hover:bg-surface-hover"
            >
              <CalendarDays className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
              <span id={valueId} className={cn('truncate', !hasValue && 'text-fg-muted')}>
                {formatRangeLabel(range)}
              </span>
            </button>
          </PopoverTrigger>
          {hasValue ? (
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => {
                onChange({ from: null, to: null });
              }}
              className="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <PopoverContent
          align="start"
          collisionPadding={16}
          aria-label={label}
          role="dialog"
          // On a short window the popover scrolls inside itself instead of running off the screen.
          className="max-h-[var(--radix-popover-content-available-height)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-0"
          onOpenAutoFocus={(event) => {
            // The calendar puts focus on the selected (or today's) day itself.
            event.preventDefault();
          }}
        >
          <RangePanel
            range={range}
            now={now ?? new Date()}
            weekStart={firstDay}
            onApply={(next) => {
              onChange(next);
              setOpen(false);
            }}
            onClose={() => {
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

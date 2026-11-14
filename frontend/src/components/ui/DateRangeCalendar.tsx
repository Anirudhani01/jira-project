import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react';

import {
  addDays,
  addMonths,
  compareDays,
  isSameDay,
  monthGrid,
  startOfDay,
  weekdayOrder,
  type WeekStart,
} from '../../lib/dateRange';
import { cn } from '../../lib/cn';

import { IconButton } from './Button';

const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const WEEKDAY_NARROW = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const WEEKDAY_LONG = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A known Sunday (1 Nov 2026) plus `weekday` days, to name a weekday column. */
function sampleWeekday(weekday: number): Date {
  return new Date(2026, 10, 1 + weekday);
}

/** One-month calendar for picking a day range: a labelled grid with a roving tab stop, arrow /
 * Home / End / Page keys, and a preview of the range under the pointer. */
export function DateRangeCalendar({
  focusDay,
  onFocusDayChange,
  start,
  end,
  hover,
  onHoverChange,
  onPick,
  weekStart,
  today,
  focusOnMount = false,
}: {
  /** The day that holds the tab stop; its month is the one shown. */
  focusDay: Date;
  onFocusDayChange: (day: Date) => void;
  start: Date | null;
  end: Date | null;
  /** Day under the pointer while the end of the range is still to be chosen. */
  hover: Date | null;
  onHoverChange: (day: Date | null) => void;
  onPick: (day: Date) => void;
  weekStart: WeekStart;
  today: Date;
  focusOnMount?: boolean;
}) {
  const titleId = useId();
  const gridRef = useRef<HTMLTableElement>(null);
  const focusRequested = useRef(focusOnMount);
  const weeks = useMemo(
    () => monthGrid(focusDay.getFullYear(), focusDay.getMonth(), weekStart),
    [focusDay, weekStart],
  );
  const preview = start && !end && hover ? hover : null;
  const rangeStart = start && preview && compareDays(preview, start) < 0 ? preview : start;
  const rangeEnd = end ?? (start && preview && compareDays(preview, start) >= 0 ? preview : null);

  // Move real focus to the current day after a keyboard move or when the calendar opens.
  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${dayKey(focusDay)}"]`)?.focus();
  }, [focusDay]);

  const move = (day: Date) => {
    focusRequested.current = true;
    onFocusDayChange(day);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const shift = event.shiftKey;
    const weekday = (focusDay.getDay() - weekStart + 7) % 7;
    const next: Date | null = (() => {
      switch (event.key) {
        case 'ArrowLeft':
          return addDays(focusDay, -1);
        case 'ArrowRight':
          return addDays(focusDay, 1);
        case 'ArrowUp':
          return addDays(focusDay, -7);
        case 'ArrowDown':
          return addDays(focusDay, 7);
        case 'Home':
          return addDays(focusDay, -weekday);
        case 'End':
          return addDays(focusDay, 6 - weekday);
        case 'PageUp':
          return addMonths(focusDay, shift ? -12 : -1);
        case 'PageDown':
          return addMonths(focusDay, shift ? 12 : 1);
        default:
          return null;
      }
    })();
    if (next) {
      event.preventDefault();
      move(next);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between gap-2">
        <IconButton
          label="Previous month"
          size="sm"
          onClick={() => {
            onFocusDayChange(addMonths(focusDay, -1));
          }}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <h2 id={titleId} className="text-sm font-medium text-fg" aria-live="polite">
          {MONTH_LABEL.format(focusDay)}
        </h2>
        <IconButton
          label="Next month"
          size="sm"
          onClick={() => {
            onFocusDayChange(addMonths(focusDay, 1));
          }}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onMouseLeave={() => {
          onHoverChange(null);
        }}
        className="w-full table-fixed border-collapse text-center"
      >
        <thead>
          <tr>
            {weekdayOrder(weekStart).map((weekday) => (
              <th
                key={weekday}
                scope="col"
                abbr={WEEKDAY_LONG.format(sampleWeekday(weekday))}
                className="pb-0.5 text-xs font-medium text-fg-muted"
              >
                {WEEKDAY_NARROW.format(sampleWeekday(weekday))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={dayKey(week[0] as Date)}>
              {week.map((day) => {
                const outside = day.getMonth() !== focusDay.getMonth();
                const isStart = Boolean(start) && isSameDay(day, start as Date);
                const isEnd = Boolean(end) && isSameDay(day, end as Date);
                const inRange =
                  Boolean(rangeStart && rangeEnd) &&
                  compareDays(day, rangeStart as Date) >= 0 &&
                  compareDays(day, rangeEnd as Date) <= 0;
                const isEdge =
                  isStart ||
                  isEnd ||
                  (Boolean(rangeStart) && Boolean(rangeEnd) && isSameDay(day, rangeEnd as Date)) ||
                  (Boolean(rangeStart) && Boolean(rangeEnd) && isSameDay(day, rangeStart as Date));
                const isToday = isSameDay(day, today);
                const tabStop = isSameDay(day, focusDay);
                return (
                  <td
                    key={dayKey(day)}
                    role="gridcell"
                    aria-selected={isStart || isEnd || inRange}
                    className={cn('p-0', inRange && !isEdge && 'bg-accent-soft')}
                  >
                    <button
                      type="button"
                      data-day={dayKey(day)}
                      tabIndex={tabStop ? 0 : -1}
                      aria-label={DAY_LABEL.format(day)}
                      aria-current={isToday ? 'date' : undefined}
                      onClick={() => {
                        onFocusDayChange(startOfDay(day));
                        onPick(startOfDay(day));
                      }}
                      onMouseEnter={() => {
                        onHoverChange(startOfDay(day));
                      }}
                      className={cn(
                        'mx-auto my-px flex size-9 items-center justify-center rounded-md text-[13px] tabular-nums outline-none sm:size-7',
                        'focus-visible:ring-2 focus-visible:ring-accent',
                        // Days of the neighbouring months are dimmed; inside the range they need the stronger
                        // muted colour to keep 4.5:1 on the tinted background (dark theme).
                        outside ? (inRange ? 'text-fg-muted' : 'text-fg-subtle') : 'text-fg',
                        isEdge ? 'bg-accent font-medium text-accent-fg' : 'hover:bg-surface-hover',
                        isToday && !isEdge && 'ring-1 ring-inset ring-[var(--control-border)]',
                      )}
                    >
                      {day.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

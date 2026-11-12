import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { endOfDay, presetRange, startOfDay } from '../../lib/dateRange';

import { DateRangePicker, type IsoRange } from './DateRangePicker';

const NOW = new Date(2026, 10, 13, 10, 30); // Friday 13 November 2026
const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const day = (n: number, month = 10) => DAY_LABEL.format(new Date(2026, month, n));
const iso = (date: Date) => date.toISOString();

function setup(props: { from?: string | null; to?: string | null } = {}) {
  const onChange = vi.fn<(range: IsoRange) => void>();
  const user = userEvent.setup();
  render(
    <DateRangePicker
      label="Date range"
      from={props.from ?? null}
      to={props.to ?? null}
      onChange={onChange}
      weekStart={0}
      now={NOW}
    />,
  );
  const trigger = () => screen.getByRole('button', { name: /^Date range/ });
  const open = async () => {
    await user.click(trigger());
    return screen.findByRole('dialog', { name: 'Date range' });
  };
  return { onChange, user, trigger, open };
}

describe('DateRangePicker', () => {
  it('shows what is selected on the button', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Date range Any time' })).toBeInTheDocument();
  });

  it('shows a set range and clears it from the button without opening the popover', async () => {
    const { onChange, user } = setup({
      from: iso(startOfDay(new Date(2026, 10, 10))),
      to: iso(endOfDay(new Date(2026, 10, 15))),
    });
    expect(screen.getByRole('button', { name: /^Date range.*10.*15/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear date range' }));
    expect(onChange).toHaveBeenCalledWith({ from: null, to: null });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('applies a quick range straight away', async () => {
    const { onChange, user, open } = setup();
    const dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Last 7 days' }));
    const expected = presetRange('week', NOW);
    expect(onChange).toHaveBeenCalledWith({
      from: expected.from?.toISOString(),
      to: expected.to?.toISOString(),
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on today and applies a picked range as whole days', async () => {
    const { onChange, user, open } = setup();
    const dialog = await open();
    expect(within(dialog).getByRole('button', { name: day(13) })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: day(10) }));
    await user.click(within(dialog).getByRole('button', { name: day(15) }));
    expect(onChange).not.toHaveBeenCalled(); // nothing is sent until Apply
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({
      from: iso(startOfDay(new Date(2026, 10, 10))),
      to: iso(endOfDay(new Date(2026, 10, 15))),
    });
  });

  it('puts a later first click after an earlier second click in order', async () => {
    const { onChange, user, open } = setup();
    const dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: day(15) }));
    await user.click(within(dialog).getByRole('button', { name: day(10) }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({
      from: iso(startOfDay(new Date(2026, 10, 10))),
      to: iso(endOfDay(new Date(2026, 10, 15))),
    });
  });

  it('allows a range with no end and a single day', async () => {
    const first = setup();
    let dialog = await first.open();
    await first.user.click(within(dialog).getByRole('button', { name: day(10) }));
    await first.user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(first.onChange).toHaveBeenCalledWith({
      from: iso(startOfDay(new Date(2026, 10, 10))),
      to: null,
    });
    document.body.innerHTML = '';

    const second = setup();
    dialog = await second.open();
    await second.user.click(within(dialog).getByRole('button', { name: day(10) }));
    await second.user.click(within(dialog).getByRole('button', { name: day(10) }));
    await second.user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(second.onChange).toHaveBeenCalledWith({
      from: iso(startOfDay(new Date(2026, 10, 10))),
      to: iso(endOfDay(new Date(2026, 10, 10))),
    });
  });

  it('uses the chosen start and end times', async () => {
    const { onChange, user, open } = setup();
    const dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: day(10) }));
    await user.click(within(dialog).getByRole('button', { name: day(15) }));
    await user.clear(within(dialog).getByLabelText('Start time'));
    await user.type(within(dialog).getByLabelText('Start time'), '09:30');
    await user.clear(within(dialog).getByLabelText('End time'));
    await user.type(within(dialog).getByLabelText('End time'), '17:05');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({
      from: iso(new Date(2026, 10, 10, 9, 30)),
      to: iso(new Date(2026, 10, 15, 17, 5, 59, 999)),
    });
  });

  it('refuses an end time before the start time on the same day', async () => {
    const { onChange, user, open } = setup();
    const dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: day(10) }));
    await user.click(within(dialog).getByRole('button', { name: day(10) }));
    await user.clear(within(dialog).getByLabelText('Start time'));
    await user.type(within(dialog).getByLabelText('Start time'), '15:00');
    await user.clear(within(dialog).getByLabelText('End time'));
    await user.type(within(dialog).getByLabelText('End time'), '09:00');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/end time must be after/i);
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves around the calendar with the keyboard and picks with Enter', async () => {
    const { onChange, user, open } = setup();
    const dialog = await open();
    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('button', { name: day(14) })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('button', { name: day(21) })).toHaveFocus();
    await user.keyboard('{Home}'); // Sunday 15 November
    expect(within(dialog).getByRole('button', { name: day(15) })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard('{End}'); // Saturday 21 November
    await user.keyboard('{Enter}');
    await user.keyboard('{PageDown}');
    expect(within(dialog).getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    await user.keyboard('{PageUp}');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({
      from: iso(startOfDay(new Date(2026, 10, 15))),
      to: iso(endOfDay(new Date(2026, 10, 21))),
    });
  });

  it('changes month with the buttons', async () => {
    const { user, open } = setup();
    const dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Next month' }));
    expect(within(dialog).getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Previous month' }));
    await user.click(within(dialog).getByRole('button', { name: 'Previous month' }));
    expect(within(dialog).getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
  });

  it('closes on Escape or Cancel without changing anything, and Clear empties the range', async () => {
    const { onChange, user, trigger, open } = setup({
      from: iso(startOfDay(new Date(2026, 10, 10))),
      to: iso(endOfDay(new Date(2026, 10, 15))),
    });
    let dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: day(20) }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith({ from: null, to: null });
  });

  it('preselects the days of an existing range and labels today', async () => {
    const { open } = setup({
      from: iso(startOfDay(new Date(2026, 10, 10))),
      to: iso(endOfDay(new Date(2026, 10, 15))),
    });
    const dialog = await open();
    expect(
      within(dialog)
        .getByRole('button', { name: day(10) })
        .closest('td'),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      within(dialog)
        .getByRole('button', { name: day(12) })
        .closest('td'),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      within(dialog)
        .getByRole('button', { name: day(20) })
        .closest('td'),
    ).toHaveAttribute('aria-selected', 'false');
    expect(within(dialog).getByRole('button', { name: day(13) })).toHaveAttribute(
      'aria-current',
      'date',
    );
  });
});

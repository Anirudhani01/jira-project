import { donePercent, sprintTimeProgress } from './sprintProgress';

const START = '2026-11-06T09:00:00Z';
const END = '2026-11-20T17:00:00Z';

describe('sprintTimeProgress', () => {
  it('counts whole days elapsed out of the sprint length', () => {
    expect(sprintTimeProgress(START, END, new Date('2026-11-12T10:00:00Z'))).toEqual({
      elapsedDays: 6,
      totalDays: 14,
      percent: 43,
    });
  });

  it('is empty before the start and full after the end', () => {
    expect(sprintTimeProgress(START, END, new Date('2026-11-01T00:00:00Z'))?.percent).toBe(0);
    expect(sprintTimeProgress(START, END, new Date('2026-12-01T00:00:00Z'))).toMatchObject({
      elapsedDays: 14,
      percent: 100,
    });
  });

  it('returns null when a date is missing or the range is invalid', () => {
    expect(sprintTimeProgress(null, END)).toBeNull();
    expect(sprintTimeProgress(START, undefined)).toBeNull();
    expect(sprintTimeProgress(END, START)).toBeNull();
    expect(sprintTimeProgress('not a date', END)).toBeNull();
  });
});

describe('donePercent', () => {
  it('rounds the share of done issues and caps at 100', () => {
    expect(donePercent(1, 4)).toBe(25);
    expect(donePercent(1, 3)).toBe(33);
    expect(donePercent(5, 4)).toBe(100);
  });

  it('is null when there are no issues', () => {
    expect(donePercent(0, 0)).toBeNull();
  });
});

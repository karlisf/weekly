import { describe, expect, it } from 'vitest';
import { datesAfterMove, delayedTasks, isDelayed, orderBetween, placementsForDay, unscheduledTasks, type PlanTask } from './plan';
import { addDays, diffDays, isoWeek, startOfWeek, weekDays } from './dates';

const T = (o: Partial<PlanTask>): PlanTask => ({
  id: Math.random().toString(36),
  title: 't',
  startDate: null,
  endDate: null,
  doneAt: null,
  sortOrder: 0,
  createdAt: 0,
  ...o,
});

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(startOfWeek('2026-11-10')).toBe('2026-11-09'); // Tue -> Mon
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09'); // Sun -> Mon
    expect(weekDays('2026-11-09')).toHaveLength(7);
  });
  it('crosses month, year and DST boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-11-10', '2026-11-03')).toBe(-7);
  });
  it('computes ISO week numbers', () => {
    expect(isoWeek('2026-11-10')).toBe(46);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2026-01-01')).toBe(1);
  });
});

describe('plan', () => {
  const today = '2026-11-10';
  const weekStart = '2026-11-09';

  it('marks open tasks whose last day has passed as delayed', () => {
    expect(isDelayed(T({ startDate: '2026-11-09' }), today)).toBe(true);
    expect(isDelayed(T({ startDate: '2026-11-09', doneAt: 1 }), today)).toBe(false);
    expect(isDelayed(T({ startDate: '2026-11-08', endDate: '2026-11-10' }), today)).toBe(false);
    expect(isDelayed(T({ startDate: '2026-11-08', endDate: '2026-11-09' }), today)).toBe(true);
    expect(isDelayed(T({}), today)).toBe(false);
  });

  it('sorts delayed by how late they are, and lists open unscheduled tasks', () => {
    const a = T({ startDate: '2026-11-05' });
    const b = T({ startDate: '2026-11-01', endDate: '2026-11-07' });
    const c = T({ startDate: '2026-11-02' });
    expect(delayedTasks([a, b, c], today).map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    const u = T({});
    expect(unscheduledTasks([u, T({ doneAt: 5 }), a])).toEqual([u]);
  });

  it('places a multi-day span on each covered day, full on start, today and week start', () => {
    const span = T({ startDate: '2026-11-07', endDate: '2026-11-12' });
    const kinds = weekDays(weekStart).map((d) => placementsForDay([span], d, today, weekStart)[0]?.kind ?? '-');
    expect(kinds).toEqual(['full', 'full', 'continuation', 'continuation', '-', '-', '-']);
    expect(placementsForDay([span], '2026-11-10', today, weekStart)[0]).toMatchObject({ index: 4, length: 6 });
  });

  it('shows unscheduled tasks on the day they were completed', () => {
    const done = T({ doneAt: new Date(2026, 10, 10, 15).getTime() });
    expect(placementsForDay([done], '2026-11-10', today, weekStart)).toHaveLength(1);
    expect(placementsForDay([done], '2026-11-11', today, weekStart)).toHaveLength(0);
  });

  it('moves spans by the distance dragged, keeping their length', () => {
    const span = T({ startDate: '2026-11-09', endDate: '2026-11-11' });
    expect(datesAfterMove(span, '2026-11-10', '2026-11-13')).toEqual({ startDate: '2026-11-12', endDate: '2026-11-14' });
    expect(datesAfterMove(span, null, '2026-11-13')).toEqual({ startDate: '2026-11-13', endDate: '2026-11-15' });
    expect(datesAfterMove(T({}), null, '2026-11-13')).toEqual({ startDate: '2026-11-13', endDate: null });
    expect(datesAfterMove(T({ startDate: '2026-11-01' }), '2026-11-01', '2026-11-10')).toEqual({
      startDate: '2026-11-10',
      endDate: null,
    });
  });

  it('orders between neighbours', () => {
    expect(orderBetween(1, 2)).toBe(1.5);
    expect(orderBetween(undefined, 2)).toBe(1);
    expect(orderBetween(3, undefined)).toBe(4);
    expect(orderBetween(undefined, undefined)).toBe(0);
  });
});

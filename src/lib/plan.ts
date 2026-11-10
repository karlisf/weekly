/*
 * Pure planning rules: which task shows where in the week, what counts as
 * delayed, and how a drag changes a task's dates. No I/O, so it is unit-tested.
 */
import { addDays, diffDays, toDay, type Day } from './dates';
import type { Task } from '../db/schema';

export type PlanTask = Pick<Task, 'id' | 'title' | 'startDate' | 'endDate' | 'doneAt' | 'sortOrder' | 'createdAt'>;

export function lastDay(t: PlanTask): Day | null {
  return t.endDate ?? t.startDate;
}

export function spanLength(t: PlanTask): number {
  return t.startDate ? diffDays(t.startDate, lastDay(t)!) + 1 : 1;
}

export function isOpen(t: PlanTask): boolean {
  return t.doneAt == null;
}

export function isUnscheduled(t: PlanTask): boolean {
  return t.startDate == null;
}

/** Open task whose last day is before today. */
export function isDelayed(t: PlanTask, today: Day): boolean {
  return isOpen(t) && t.startDate != null && lastDay(t)! < today;
}

export function covers(t: PlanTask, day: Day): boolean {
  return t.startDate != null && t.startDate <= day && day <= lastDay(t)!;
}

export const byOrder = (a: PlanTask, b: PlanTask) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt;

export interface Placement<T extends PlanTask = PlanTask> {
  task: T;
  /** 'full' shows the whole card; 'continuation' is a slim line for the middle of a multi-day span. */
  kind: 'full' | 'continuation';
  /** 1-based position within a multi-day span, and the span length. */
  index: number;
  length: number;
}

/**
 * Tasks to show on one day column.
 * - Scheduled tasks covering the day (multi-day tasks on every day of their span).
 *   A span shows as a full card on its first day, on today, and on the first
 *   visible day of the week; on other days it collapses to a continuation line.
 * - Unscheduled tasks completed that day, so finished "anytime" work stays visible.
 */
export function placementsForDay<T extends PlanTask>(tasks: T[], day: Day, today: Day, weekStart: Day): Placement<T>[] {
  const out: Placement<T>[] = [];
  for (const t of tasks) {
    if (covers(t, day)) {
      const length = spanLength(t);
      const index = diffDays(t.startDate!, day) + 1;
      const full = length === 1 || day === t.startDate || day === today || day === weekStart;
      out.push({ task: t, kind: full ? 'full' : 'continuation', index, length });
    } else if (t.startDate == null && t.doneAt != null && toDay(new Date(t.doneAt)) === day) {
      out.push({ task: t, kind: 'full', index: 1, length: 1 });
    }
  }
  return out.sort((a, b) => byOrder(a.task, b.task));
}

export function delayedTasks<T extends PlanTask>(tasks: T[], today: Day): T[] {
  return tasks
    .filter((t) => isDelayed(t, today))
    .sort((a, b) => (lastDay(a)! < lastDay(b)! ? -1 : lastDay(a)! > lastDay(b)! ? 1 : byOrder(a, b)));
}

export function unscheduledTasks<T extends PlanTask>(tasks: T[]): T[] {
  return tasks.filter((t) => isUnscheduled(t) && isOpen(t)).sort(byOrder);
}

/**
 * New dates after dropping a task on a day.
 * - From a day column (`fromDay` set): shift the whole span by the distance moved,
 *   so the grabbed day lands on the target.
 * - From a panel (`fromDay` null): the span starts on the target, keeping its length.
 * - Unscheduled tasks become single-day tasks on the target.
 */
export function datesAfterMove(t: PlanTask, fromDay: Day | null, toDay: Day): { startDate: Day; endDate: Day | null } {
  if (t.startDate == null) return { startDate: toDay, endDate: null };
  const length = spanLength(t);
  const start = fromDay ? addDays(t.startDate, diffDays(fromDay, toDay)) : toDay;
  return { startDate: start, endDate: length > 1 ? addDays(start, length - 1) : null };
}

/** A sortOrder strictly between two neighbours (either may be missing). */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

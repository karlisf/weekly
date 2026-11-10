import { addDays, type Day } from './dates';
import type { Task } from '../db/schema';

const EXAMPLE_TITLES = new Set([
  'Drag this card to another day',
  'Open a task to add notes and dates',
  'Three-day task: plan the week',
  'Missed yesterday, so it is delayed',
  'Something for whenever',
]);

/** True for the untouched first-run examples. */
export function isExampleTask(t: Pick<Task, 'title'>): boolean {
  return EXAMPLE_TITLES.has(t.title);
}

/** First-run tasks that show how the planner works. Delete them any time. */
export function seedTasks(today: Day): Task[] {
  const now = Date.now();
  const make = (title: string, startDate: Day | null, endDate: Day | null, notes = '', i = 0): Task => ({
    id: crypto.randomUUID(),
    title,
    notes,
    startDate,
    endDate,
    doneAt: null,
    sortOrder: i,
    createdAt: now + i,
    updatedAt: now + i,
    deletedAt: null,
    clocks: {},
  });
  return [
    make('Drag this card to another day', today, null, 'On a phone, press and hold a card to pick it up.', 0),
    make('Open a task to add notes and dates', today, null, 'Tap the title. Notes, start and end day live here.', 1),
    make(
      'Three-day task: plan the week',
      addDays(today, -1),
      addDays(today, 1),
      'Set an end day to spread a task across several days. It shows on each day until it ends; if it is still open after that, it moves to Delayed.',
      2,
    ),
    make('Missed yesterday, so it is delayed', addDays(today, -1), null, 'Drag it onto a day to reschedule it.', 3),
    make('Something for whenever', null, null, 'Tasks without a date sit under No date and appear on today, pencilled in.', 4),
  ];
}

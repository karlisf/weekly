import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

/*
 * Sync-readiness conventions (see docs/SYNC.md):
 * - Primary keys are client-generated UUID strings, so two devices never collide.
 * - Every row carries updatedAt (ms epoch) for last-writer-wins merging.
 * - Rows are never hard-deleted; deletedAt is a tombstone that can be replicated.
 * - Dates without time are stored as local calendar days, 'YYYY-MM-DD'.
 */

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    /** First day of the task. NULL = unscheduled ("no date"). */
    startDate: text('start_date'),
    /** Last day (inclusive) of a multi-day task. NULL = single-day task. */
    endDate: text('end_date'),
    /** When the task was completed (ms epoch). NULL = open. */
    doneAt: integer('done_at'),
    /** Manual order within a day; fractional so inserts never renumber siblings. */
    sortOrder: real('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('tasks_start_idx').on(t.startDate), index('tasks_updated_idx').on(t.updatedAt)],
);

/** Key/value settings. Values are JSON-encoded. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

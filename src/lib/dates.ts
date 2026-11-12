/** A local calendar day, formatted 'YYYY-MM-DD'. Sorts and compares as a string. */
export type Day = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDay(d: Date): Day {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): Day {
  return toDay(new Date());
}

export function addDays(day: Day, n: number): Day {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Whole days from a to b (b - a). Uses UTC so DST shifts do not matter. */
export function diffDays(a: Day, b: Day): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(day: Day): number {
  return (parseDay(day).getDay() + 6) % 7;
}

export function startOfWeek(day: Day): Day {
  return addDays(day, -weekdayIndex(day));
}

export function weekDays(weekStart: Day): Day[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function isWeekend(day: Day): boolean {
  return weekdayIndex(day) >= 5;
}

/** ISO-8601 week number (weeks start Monday; week 1 contains Jan 4th). */
export function isoWeek(day: Day): number {
  const thursday = addDays(day, 3 - weekdayIndex(day));
  const jan4 = `${thursday.slice(0, 4)}-01-04`;
  return 1 + Math.floor(diffDays(startOfWeek(jan4), thursday) / 7);
}

export function isValidDay(s: unknown): s is Day {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toDay(parseDay(s)) === s;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function fmt(day: Day, opts: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(undefined, opts)));
  return f.format(parseDay(day));
}

const rangeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortRangeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/**
 * Locale-aware range, e.g. "Nov 9 – 15, 2026" or "9–15 Nov 2026".
 * With `omitYearIn`, the year is left out when the whole week falls in that year.
 */
export function weekRangeLabel(weekStart: Day, omitYearIn?: number): string {
  const end = addDays(weekStart, 6);
  const sameYear = omitYearIn != null && weekStart.startsWith(`${omitYearIn}-`) && end.startsWith(`${omitYearIn}-`);
  return (sameYear ? shortRangeFmt : rangeFmt).formatRange(parseDay(weekStart), parseDay(end));
}

/** Human distance from today: "today", "yesterday", "3 days ago", "in 2 days". */
export function relativeDay(day: Day, ref: Day): string {
  const n = diffDays(ref, day);
  if (n === 0) return 'today';
  if (n === -1) return 'yesterday';
  if (n === 1) return 'tomorrow';
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
}

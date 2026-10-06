/**
 * Turns a deadline as people say it ("today or tomorrow mid-day", "before Friday", "over the
 * weekend", "Oct 30") into a calendar date, counted from the day of the meeting.
 *
 * - A range or a choice ends on its latest day: "today or tomorrow" → tomorrow, "this week" →
 *   Friday, "the weekend" → Sunday. A task is due when the last option runs out.
 * - "before X" is the day before X; "by X" and "until X" are X.
 * - Times of day ("mid-day", "EOD", "3pm") don't change the date.
 * - A weekday is the next one after the meeting day; "next Friday" is the one in the following week.
 *
 * Returns null when nothing in the phrase is a date we can place; the summarizer's own answer is
 * used then.
 */

const DAY = 86_400_000;
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?';
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const weekday = (t: number) => new Date(t).getUTCDay();
/** Monday of the week `t` is in (weeks start on Monday). */
const monday = (t: number) => t - ((weekday(t) + 6) % 7) * DAY;

interface Hit {
  /** Where in the text the date was found (to apply a "before" right in front of it). */
  at: number;
  t: number;
}

export function resolveDueDate(due: string | null | undefined, meeting: Date): string | null {
  if (!due) return null;
  const text = ` ${due.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ')} `;
  if (/\b(asap|soon|later|eventually|whenever|ongoing|tbd|no deadline)\b/.test(text) && !/\b(today|tomorrow|week|weekend|month|day)\b/.test(text)) {
    return null;
  }
  const today = utcDay(meeting);
  const hits: Hit[] = [];
  const add = (index: number, t: number) => hits.push({ at: index, t });

  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const m of text.matchAll(isoMatch)) add(m.index, Date.UTC(+m[1], +m[2] - 1, +m[3]));

  for (const m of text.matchAll(/\bday after tomorrow\b/g)) add(m.index, today + 2 * DAY);
  for (const m of text.matchAll(/\b(today|tonight|eod|end of (the )?day|close of business|cob)\b/g)) add(m.index, today);
  for (const m of text.matchAll(/(?<!after )\btomorrow\b/g)) add(m.index, today + DAY);

  for (const m of text.matchAll(/\bin (\d{1,2}|a|one|two|three|four) (day|week)s?\b/g)) {
    const n = ({ a: 1, one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[m[1]] ?? Number(m[1]);
    add(m.index, today + n * (m[2] === 'week' ? 7 : 1) * DAY);
  }

  // Weekdays: "friday", "this friday", "by fri", "next friday".
  for (const m of text.matchAll(new RegExp(`\\b(next |this |coming )?${WEEKDAY_RE}\\b`, 'g'))) {
    const target = WEEKDAYS[m[2].slice(0, 3)];
    if (m[1] === 'next ') {
      add(m.index, monday(today) + 7 * DAY + ((target + 6) % 7) * DAY);
    } else {
      const ahead = (target - weekday(today) + 7) % 7 || 7;
      add(m.index, today + ahead * DAY);
    }
  }

  // Weeks and weekends.
  for (const m of text.matchAll(/\b(end of (the )?week|eow|this week|by the end of the week)\b/g)) add(m.index, monday(today) + 4 * DAY);
  for (const m of text.matchAll(/\b(end of )?next week\b/g)) add(m.index, monday(today) + 11 * DAY);
  for (const m of text.matchAll(/\b(next|following) weekend\b/g)) add(m.index, monday(today) + 13 * DAY);
  for (const m of text.matchAll(/(?<!(next|following) )\bweekend\b/g)) add(m.index, monday(today) + 6 * DAY);

  // Months.
  for (const m of text.matchAll(/\b(end of (the )?month|eom|this month)\b/g)) {
    const d = new Date(today);
    add(m.index, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  }
  for (const m of text.matchAll(/\b(end of )?next month\b/g)) {
    const d = new Date(today);
    add(m.index, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
  }
  for (const m of text.matchAll(/\b(end of (the )?quarter|eoq)\b/g)) {
    const d = new Date(today);
    const quarterEnd = Math.floor(d.getUTCMonth() / 3) * 3 + 3;
    add(m.index, Date.UTC(d.getUTCFullYear(), quarterEnd, 0));
  }

  // Calendar dates: "oct 30", "october 30th", "30 october", "30th of october".
  const onDay = (index: number, month: number, day: number) => {
    if (day < 1 || day > 31) return;
    const d = new Date(today);
    let t = Date.UTC(d.getUTCFullYear(), month, day);
    // A date already past this year means next year's.
    if (t < today - 7 * DAY) t = Date.UTC(d.getUTCFullYear() + 1, month, day);
    add(index, t);
  };
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE} (\\d{1,2})(st|nd|rd|th)?\\b`, 'g'))) onDay(m.index, MONTHS[m[1].slice(0, 3)], +m[2]);
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?( of)? ${MONTH_RE}`, 'g'))) onDay(m.index, MONTHS[m[4].slice(0, 3)], +m[1]);
  // "the 20th" alone: this month's, or next month's if it has passed.
  for (const m of text.matchAll(/\bthe (\d{1,2})(st|nd|rd|th)\b(?! of)/g)) {
    const d = new Date(today);
    const day = +m[1];
    if (day < 1 || day > 31) continue;
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day);
    if (t < today) t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day);
    add(m.index, t);
  }

  if (hits.length === 0) return null;
  // "before X" ends the day before X.
  const dates = hits.map((h) => (/\b(before|prior to)\s+(the\s+|next\s+|this\s+)?$/.test(text.slice(Math.max(0, h.at - 16), h.at)) ? h.t - DAY : h.t));
  const latest = Math.max(...dates);
  return latest < today ? null : iso(latest);
}

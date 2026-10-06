import type { TaskItem } from '@boringtalks/shared';
import { addDays, daysBetween, formatDay, startOfWeek } from './dates';

export type TaskGroupKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'undated' | 'done';

export interface TaskGroup {
  key: TaskGroupKey;
  label: string;
  items: TaskItem[];
}

const LABELS: Record<TaskGroupKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  later: 'Later',
  undated: 'No date',
  done: 'Done',
};

const ORDER: TaskGroupKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'undated', 'done'];

/** `ignoreDone` keeps a task that was just ticked off in its date section instead of moving it to Done. */
export function groupOf(task: Pick<TaskItem, 'done' | 'dueDate'>, today: string, ignoreDone = false): TaskGroupKey {
  if (task.done && !ignoreDone) return 'done';
  if (!task.dueDate) return 'undated';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  if (task.dueDate === addDays(today, 1)) return 'tomorrow';
  // Through Sunday of this week.
  return task.dueDate <= addDays(startOfWeek(today), 6) ? 'week' : 'later';
}

/** Splits tasks (already sorted by the API) into the tasks page's sections, skipping empty ones. */
export function groupTasks(tasks: readonly TaskItem[], today: string, { ignoreDone = false } = {}): TaskGroup[] {
  const groups = new Map<TaskGroupKey, TaskItem[]>();
  for (const t of tasks) {
    const key = groupOf(t, today, ignoreDone);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return ORDER.filter((k) => groups.has(k)).map((key) => ({ key, label: LABELS[key], items: groups.get(key)! }));
}

/** "Due today", "Due tomorrow", "Due Fri, Oct 9", "3 days late". */
export function dueLabel(dueDate: string | null, today: string): string | null {
  if (!dueDate) return null;
  const d = daysBetween(today, dueDate);
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d < 0) return d === -1 ? '1 day late' : `${-d} days late`;
  return `Due ${formatDay(dueDate, today)}`;
}

/** Everyone who owns an open task, most tasks first. */
export function ownersOf(tasks: readonly TaskItem[]): string[] {
  const count = new Map<string, number>();
  for (const t of tasks) if (t.owner) count.set(t.owner, (count.get(t.owner) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([o]) => o);
}

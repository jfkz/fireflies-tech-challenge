import type { TaskItem } from '@boringtalks/shared';
import { describe, expect, it } from 'vitest';
import { dueLabel, groupOf, groupTasks, ownersOf } from './tasks';

const today = '2026-10-07'; // a Wednesday
const task = (id: string, dueDate: string | null, done = false, owner: string | null = null): TaskItem => ({
  id,
  text: id,
  owner,
  due: null,
  dueDate,
  done,
  meeting: { id: '00000000-0000-4000-8000-000000000001', title: 'M', startedAt: '2026-10-01T10:00:00.000Z' },
});

describe('task groups', () => {
  it('puts each task in its section relative to today', () => {
    expect(groupOf(task('a', '2026-10-06'), today)).toBe('overdue');
    expect(groupOf(task('a', today), today)).toBe('today');
    expect(groupOf(task('a', '2026-10-08'), today)).toBe('tomorrow');
    expect(groupOf(task('a', '2026-10-11'), today)).toBe('week');
    expect(groupOf(task('a', '2026-10-12'), today)).toBe('later');
    expect(groupOf(task('a', null), today)).toBe('undated');
    expect(groupOf(task('a', '2026-10-06', true), today)).toBe('done');
    expect(groupOf(task('a', '2026-10-06', true), today, true)).toBe('overdue');
  });

  it('keeps the API order inside sections and skips empty ones', () => {
    const groups = groupTasks([task('x', '2026-10-01'), task('y', today), task('z', null), task('w', today)], today);
    expect(groups.map((g) => [g.label, g.items.map((t) => t.id)])).toEqual([
      ['Overdue', ['x']],
      ['Today', ['y', 'w']],
      ['No date', ['z']],
    ]);
  });

  it('says when something is due, or how late it is', () => {
    expect(dueLabel(today, today)).toBe('Due today');
    expect(dueLabel('2026-10-08', today)).toBe('Due tomorrow');
    expect(dueLabel('2026-10-09', today)).toBe('Due Fri, Oct 9');
    expect(dueLabel('2026-10-06', today)).toBe('1 day late');
    expect(dueLabel('2026-10-01', today)).toBe('6 days late');
    expect(dueLabel(null, today)).toBeNull();
  });

  it('lists owners with the most tasks first', () => {
    expect(ownersOf([task('a', null, false, 'Leo'), task('b', null, false, 'Maya'), task('c', null, false, 'Maya'), task('d', null)])).toEqual(['Maya', 'Leo']);
  });
});

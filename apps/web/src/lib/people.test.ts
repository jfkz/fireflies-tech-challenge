import { describe, expect, it } from 'vitest';
import { aroundRange, chainNeighbours, dayNeighbours, isTyping, linkCandidates, localDayRange } from './meeting-nav';
import { isPersonName, lastMetLabel, nameFromParam, peopleHref, periodFromParam, personHref, talkShare } from './people';

describe('people helpers', () => {
  it('tells people from made-up labels and the account holder', () => {
    expect(isPersonName('Maya')).toBe(true);
    expect(['You', 'Others', 'Speaker 2', 'speaker3', 'Unknown speaker', ' '].map((n) => isPersonName(n))).toEqual([false, false, false, false, false, false]);
    // "You" is renamed to the account holder's first name; that's not someone you meet.
    expect(isPersonName('Mikhail', 'Mikhail Pershin')).toBe(false);
    expect(isPersonName('mikhail pershin', 'Mikhail Pershin')).toBe(false);
    expect(isPersonName('Maya', 'Mikhail Pershin')).toBe(true);
  });

  it('builds and reads person URLs', () => {
    expect(personHref('Maya Chen')).toBe('/people/Maya%20Chen');
    expect(personHref('A/B')).toBe('/people/A%2FB');
    expect(nameFromParam('Maya%20Chen')).toBe('Maya Chen');
    expect(nameFromParam('100%')).toBe('100%');
  });

  it('keeps the period in the URL, 30 days by default', () => {
    expect([null, '30', '90', 'all', 'nonsense'].map(periodFromParam)).toEqual([30, 30, 90, null, 30]);
    expect([30, 90, null].map((d) => peopleHref(d as 30 | 90 | null))).toEqual(['/people', '/people?days=90', '/people?days=all']);
  });

  it('works out talk share and when you last met', () => {
    expect(talkShare(1200, 3600)).toBe(33);
    expect(talkShare(10, 0)).toBe(0);
    expect(talkShare(5000, 3600)).toBe(100);
    const now = new Date('2026-10-07T12:00:00');
    expect(lastMetLabel(new Date('2026-10-07T09:00:00').toISOString(), now)).toBe('today');
    expect(lastMetLabel(new Date('2026-10-06T09:00:00').toISOString(), now)).toBe('yesterday');
    expect(lastMetLabel(new Date('2026-10-02T09:00:00').toISOString(), now)).toBe('5 days ago');
    expect(lastMetLabel(new Date('2026-09-16T09:00:00').toISOString(), now)).toBe('3 weeks ago');
    expect(lastMetLabel(new Date('2026-06-01T09:00:00').toISOString(), now)).toBe('Jun 1');
  });
});

describe('meeting navigation helpers', () => {
  const ref = (n: number, startedAt: string) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title: `M${n}`, startedAt });

  it('spans the local calendar day', () => {
    expect(localDayRange(new Date('2026-10-06T15:30:00').toISOString())).toEqual({
      from: new Date('2026-10-06T00:00:00').toISOString(),
      to: new Date('2026-10-07T00:00:00').toISOString(),
    });
  });

  it('finds the meetings before and after on the same day, in time order', () => {
    const a = ref(1, '2026-10-06T09:00:00.000Z');
    const b = ref(2, '2026-10-06T11:00:00.000Z');
    const c = ref(3, '2026-10-06T14:00:00.000Z');
    // The API lists newest first; the current one is in the list too.
    expect(dayNeighbours(b, [c, b, a])).toEqual({ prev: a, next: c, index: 1, total: 3 });
    expect(dayNeighbours(a, [c, b])).toMatchObject({ prev: null, next: b, index: 0, total: 3 });
    expect(dayNeighbours(c, [])).toEqual({ prev: null, next: null, index: 0, total: 1 });
  });

  it('steps through a chain in its order', () => {
    const chain = { id: '00000000-0000-4000-8000-0000000000c1', reason: null, meetings: [ref(1, '2026-10-01T09:00:00.000Z'), ref(2, '2026-10-03T09:00:00.000Z'), ref(3, '2026-10-05T09:00:00.000Z')] };
    expect(chainNeighbours(chain, chain.meetings[2].id)).toEqual({ prev: chain.meetings[1], next: null, index: 2, total: 3 });
    expect(chainNeighbours(chain, 'elsewhere')).toBeNull();
  });

  it('offers meetings to link to: not itself or its chain, nearest first unless searched', () => {
    expect(aroundRange('2026-10-06T12:00:00.000Z', 2)).toEqual({ from: '2026-10-04T12:00:00.000Z', to: '2026-10-08T12:00:00.000Z' });
    const self = ref(5, '2026-10-05T09:00:00.000Z');
    const [a, b, c, d] = [ref(1, '2026-10-01T09:00:00.000Z'), ref(3, '2026-10-03T09:00:00.000Z'), ref(7, '2026-10-07T09:00:00.000Z'), ref(9, '2026-10-20T09:00:00.000Z')];
    // Newest first from the API; b and c are two days away either side, so the earlier one leads.
    expect(linkCandidates([d, c, self, b, a], self, true)).toEqual([b, c, a, d]);
    expect(linkCandidates([d, c, self, b, a], self, false)).toEqual([d, c, b, a]);
    const chained = { ...self, chain: { id: '00000000-0000-4000-8000-0000000000c1', reason: null, meetings: [a, self] } };
    expect(linkCandidates([d, c, self, b, a], chained, true)).toEqual([b, c, d]);
  });

  it('knows when someone is typing', () => {
    expect(isTyping(document.createElement('input'))).toBe(true);
    expect(isTyping(document.createElement('textarea'))).toBe(true);
    expect(isTyping(document.body)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { filtersFromParams, filtersToSearch, hasFilters, meetingsHref, pageFromParams, pageHref, pageRange } from './filters';

describe('meeting list filters in the URL', () => {
  it('reads only known, non-empty keys', () => {
    expect(filtersFromParams(new URLSearchParams('speaker=Maya&topic=%20&q=launch&x=1'))).toEqual({ speaker: 'Maya', q: 'launch' });
  });

  it('writes a stable query string, or nothing', () => {
    expect(filtersToSearch({ topic: 'Launch Planning', speaker: 'Maya', q: '' })).toBe('?speaker=Maya&topic=Launch+Planning');
    expect(filtersToSearch({})).toBe('');
    expect(meetingsHref({ speaker: 'Dana' })).toBe('/meetings?speaker=Dana');
  });

  it('knows when anything is filtered', () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ q: 'x' })).toBe(true);
  });

  it('reads and writes the page number', () => {
    expect(pageFromParams(new URLSearchParams('page=3'))).toBe(3);
    for (const bad of ['', 'page=0', 'page=-2', 'page=2.5', 'page=x']) expect(pageFromParams(new URLSearchParams(bad))).toBe(1);
    expect(pageHref('/meetings', {}, 1)).toBe('/meetings');
    expect(pageHref('/meetings', {}, 2)).toBe('/meetings?page=2');
    expect(pageHref('/meetings', { topic: 'Pricing' }, 3)).toBe('/meetings?topic=Pricing&page=3');
  });

  it('shows the pages around the current one, with gaps', () => {
    expect(pageRange(1, 1)).toEqual([1]);
    expect(pageRange(1, 3)).toEqual([1, 2, 3]);
    expect(pageRange(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageRange(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageRange(3, 10)).toEqual([1, 2, 3, 4, null, 10]);
    expect(pageRange(10, 10)).toEqual([1, null, 9, 10]);
  });
});

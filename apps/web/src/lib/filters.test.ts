import { describe, expect, it } from 'vitest';
import { filtersFromParams, filtersToSearch, hasFilters, meetingsHref } from './filters';

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
});

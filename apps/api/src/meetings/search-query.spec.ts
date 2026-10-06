import { toTsQuery } from './search-query';

describe('toTsQuery', () => {
  it('matches every word as a prefix', () => {
    expect(toTsQuery('pric launch')).toBe('pric:* & launch:*');
    expect(toTsQuery('  Ценообразование  ')).toBe('ценообразование:*');
  });
  it('keeps quoted phrases in order and supports -exclude and or', () => {
    expect(toTsQuery('"launch email" -draft')).toBe('(launch <-> email) & !draft:*');
    expect(toTsQuery('pricing or billing hiring')).toBe('pricing:* | billing:* & hiring:*');
  });
  it('splits words joined by punctuation and drops everything that is not a letter or digit', () => {
    expect(toTsQuery('q3-planning')).toBe('(q3:* & planning:*)');
    expect(toTsQuery("o'brien & | ! ( ) :*")).toBe('(o:* & brien:*)');
  });
  it('returns null when there is nothing to look for', () => {
    expect(toTsQuery('')).toBeNull();
    expect(toTsQuery('&&& !!')).toBeNull();
    expect(toTsQuery('-draft')).toBeNull();
    // A lone "or" is just a word.
    expect(toTsQuery('or')).toBe('or:*');
  });
});

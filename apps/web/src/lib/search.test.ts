import { describe, expect, it } from 'vitest';
import { hasMatch, highlightParts, markedParts, searchTerms } from './search';

describe('search highlighting', () => {
  it('reads the server’s marked snippets', () => {
    expect(markedParts('we agreed ⟦pricing⟧ is ⟦fine⟧')).toEqual([
      { text: 'we agreed ', hit: false },
      { text: 'pricing', hit: true },
      { text: ' is ', hit: false },
      { text: 'fine', hit: true },
    ]);
    expect(markedParts('no marks')).toEqual([{ text: 'no marks', hit: false }]);
    expect(markedParts('broken ⟦mark')).toEqual([
      { text: 'broken ', hit: false },
      { text: 'mark', hit: false },
    ]);
  });

  it('takes the words of a search, minus operators and exclusions', () => {
    expect(searchTerms('"Launch email" pric -draft or Billing')).toEqual(['launch', 'email', 'pric', 'billing']);
    expect(searchTerms('  ')).toEqual([]);
  });

  it('highlights words that start with a term, case-insensitively', () => {
    expect(highlightParts('Pricing and repricing, PRICE.', ['pric'])).toEqual([
      { text: 'Pricing', hit: true },
      { text: ' and repricing, ', hit: false },
      { text: 'PRICE', hit: true },
      { text: '.', hit: false },
    ]);
    expect(highlightParts('text', [])).toEqual([{ text: 'text', hit: false }]);
    expect(hasMatch('Привет, мир', ['мир'])).toBe(true);
  });
});

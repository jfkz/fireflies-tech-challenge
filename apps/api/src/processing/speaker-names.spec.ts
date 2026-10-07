import { displayNames, firstName, isPlaceholderLabel, renameSpeakers, resolveSpeakerNames } from './speaker-names';
import { normalizeTopics } from './topics';

describe('resolveSpeakerNames', () => {
  const labels = ['You', 'Speaker 1', 'Speaker 2', 'Speaker 3'];

  it('names "You" after the account holder and the others from the conversation', () => {
    const map = resolveSpeakerNames(
      labels,
      [
        { label: 'Speaker 1', name: 'Maya', role: null },
        { label: 'speaker 2', name: null, role: 'recruiter' },
        { label: 'Speaker 3', name: 'Unknown', role: null },
      ],
      'mikhail pershin',
    );
    expect(displayNames(map)).toEqual({ You: 'Mikhail', 'Speaker 1': 'Maya', 'Speaker 2': 'Recruiter' });
    expect(map['Speaker 1'].by).toBe('ai');
    // A role isn't a person to follow across meetings.
    expect(map['Speaker 2'].role).toBe(true);
    expect(map['Speaker 1'].role).toBeUndefined();
  });

  it('keeps "You" without an account name unless the conversation names them', () => {
    expect(resolveSpeakerNames(['You'], [], null)).toEqual({});
    expect(displayNames(resolveSpeakerNames(['You'], [{ label: 'You', name: 'Sam', role: null }], null))).toEqual({ You: 'Sam' });
  });

  it('calls the account holder found among numbered speakers by their first name', () => {
    const map = resolveSpeakerNames(['Speaker 1', 'Speaker 2'], [{ label: 'Speaker 2', name: 'Mikhail Pershin', role: null }], 'Mikhail Pershin');
    expect(displayNames(map)).toEqual({ 'Speaker 2': 'Mikhail' });
  });

  it('rejects answers that are not names', () => {
    const guesses = ['Speaker 4', 'unknown speaker', '"N/A"', 'Me', 'x'.repeat(41)].map((name) => ({ label: 'Speaker 1', name, role: null }));
    for (const g of guesses) expect(resolveSpeakerNames(['Speaker 1'], [g], null)).toEqual({});
  });

  it('never gives two voices the same guessed name', () => {
    const map = resolveSpeakerNames(
      ['Speaker 1', 'Speaker 2', 'Dana'],
      [
        { label: 'Speaker 1', name: 'Leo', role: null },
        { label: 'Speaker 2', name: 'Leo', role: null },
        { label: 'Dana', name: 'Someone else', role: null },
      ],
      null,
    );
    expect(displayNames(map)).toEqual({ 'Speaker 1': 'Leo', 'Speaker 2': 'Leo 2' });
  });

  it('keeps names the user typed and lets them merge two labels into one person', () => {
    const existing = { 'Speaker 1': { name: 'Boss', by: 'user' as const }, 'Speaker 2': { name: 'Boss', by: 'user' as const }, 'Speaker 3': { name: 'Old', by: 'ai' as const } };
    const map = resolveSpeakerNames(['Speaker 1', 'Speaker 2', 'Speaker 3'], [{ label: 'Speaker 1', name: 'Leo', role: null }], null, existing);
    expect(displayNames(map)).toEqual({ 'Speaker 1': 'Boss', 'Speaker 2': 'Boss' });
  });

  it('only renames placeholder labels', () => {
    expect(isPlaceholderLabel('Speaker 12')).toBe(true);
    expect(isPlaceholderLabel('Others')).toBe(true);
    expect(isPlaceholderLabel('Dana')).toBe(false);
  });

  it('shortens account names to a first name', () => {
    expect(firstName('  ann  b ')).toBe('Ann');
    expect(firstName('o')).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});

describe('renameSpeakers', () => {
  const labels = ['You', 'Speaker 1'];
  const map = { 'Speaker 1': { name: 'Maya', by: 'ai' as const } };

  it('renames by the current display name and records the change', () => {
    const r = renameSpeakers(labels, map, { Maya: 'Mia', You: 'You' })!;
    expect(r.map['Speaker 1']).toEqual({ name: 'Mia', by: 'user' });
    expect(r.map.You).toEqual({ name: 'You', by: 'user' });
    expect(r.changes).toEqual([['Maya', 'Mia']]);
  });

  it('refuses a name that is not one of the speakers', () => {
    expect(renameSpeakers(labels, map, { 'Speaker 1': 'X' })).toBeNull();
  });
});

describe('normalizeTopics', () => {
  it('trims, dedupes, caps at four and reuses existing spellings', () => {
    expect(normalizeTopics(['#pricing.', 'Pricing', ' launch  planning ', '', 'x'.repeat(41), 'Hiring', 'Billing', 'More'], ['Launch Planning'])).toEqual([
      'Pricing',
      'Launch Planning',
      'Hiring',
      'Billing',
    ]);
  });
});

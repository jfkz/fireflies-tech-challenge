import { MockLanguageModelV4 } from 'ai/test';
import { seg } from '../testing/fixtures';
import { FakeSummarizer, FakeTranscriber } from './fake-ai';
import { finalize, GatewaySummarizer, validDate } from './gateway-summarizer';
import { chunkSegments, clamp, fallbackTitle, isGenericTitle, SINGLE_PASS_MAX_CHARS, SYSTEM_PROMPT } from './summary-prompt';

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

const draft = {
  title: 'Pricing review: Pro tier to $29, launch moved to Nov 3',
  description: 'The team raised the Pro price and moved the launch.',
  summary: 'Pro goes to $29. Launch moves to Nov 3. Free tier stays.',
  keyTopics: ['Pricing', 'Launch date', 'Free tier'],
  topics: ['pricing', 'Launch'],
  speakers: [{ label: 'Speaker 1', name: 'Dana', role: null }],
  actionItems: [{ text: 'Update the pricing page', owner: 'Dana', due: 'Oct 30', dueDate: '2026-10-30' }],
  decisions: ['Pro is $29'],
};

type Call = { prompt: Array<{ role: string; content: unknown }>; responseFormat?: { type: string } };

function mockModel(object: object = draft) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV4({
    modelId: 'mock-haiku',
    doGenerate: (options) => {
      const call = options as unknown as Call;
      calls.push(call);
      const json = call.responseFormat?.type === 'json';
      const text = json ? JSON.stringify(object) : `notes for part ${calls.length}`;
      return Promise.resolve({
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: usage(100, 10),
        warnings: [],
      });
    },
  });
  return { model, calls };
}

const promptText = (call: Call) => JSON.stringify(call.prompt);

describe('GatewaySummarizer', () => {
  it('sends the transcript and parses the structured result', async () => {
    const { model, calls } = mockModel();
    const result = await new GatewaySummarizer(model).summarize({
      segments: [seg('You', 0, 1000, 'Pro goes to twenty-nine.'), seg('Dana', 2000, 3000, 'I will update the pricing page.')],
      language: 'en',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].responseFormat?.type).toBe('json');
    const text = promptText(calls[0]);
    expect(text).toContain('[0:00] You: Pro goes to twenty-nine.');
    expect(text).toContain('[0:02] Dana: I will update the pricing page.');
    expect(text).toContain('language code is \\"en\\"');
    expect(text).toContain('Never use a generic title');
    expect(result).toMatchObject({
      title: draft.title,
      model: 'mock-haiku',
      inputTokens: 100,
      outputTokens: 10,
      decisions: ['Pro is $29'],
      actionItems: [{ text: 'Update the pricing page', owner: 'Dana', due: 'Oct 30', dueDate: '2026-10-30', done: false }],
    });
    expect(result.actionItems[0].id).toMatch(/^[\w-]{10}$/);
  });

  it('tells the model who is recording and which topic tags exist, and returns its speaker guesses', async () => {
    const { model, calls } = mockModel();
    const result = await new GatewaySummarizer(model).summarize({
      segments: [seg('You', 0, 1000, 'Thanks, Dana.'), seg('Speaker 1', 2000, 3000, 'Sure.')],
      language: null,
      ownerName: 'Ann',
      knownTopics: ['Pricing', 'Hiring'],
      meetingDate: new Date('2026-10-09T15:00:00Z'),
    });
    expect(result.actionItems[0].dueDate).toBe('2026-10-30');
    const text = promptText(calls[0]);
    expect(text).toContain('Speaker \\"You\\" is Ann');
    expect(text).toContain('existing topic tags');
    expect(text).toContain('\\"Hiring\\"');
    expect(text).toContain('Never guess or invent a name');
    expect(text).toContain('Friday, October 9, 2026 (2026-10-09)');
    // "pricing" is spelled like the existing tag.
    expect(result.topics).toEqual(['Pricing', 'Launch']);
    expect(result.speakers).toEqual([{ label: 'Speaker 1', name: 'Dana', role: null }]);
  });

  it('falls back to key topics when the model gives no tags', async () => {
    const { model } = mockModel({ ...draft, topics: [], speakers: [] });
    const result = await new GatewaySummarizer(model).summarize({ segments: [seg('You', 0, 1, 'x')], language: null });
    expect(result.topics).toEqual(['Pricing', 'Launch date', 'Free tier']);
    expect(result.speakers).toEqual([]);
  });

  it('map-reduces long transcripts in ~20 minute parts', async () => {
    const { model, calls } = mockModel();
    // 90 minutes of speech, ~1000 chars per minute: well over the single-pass limit.
    const segments = Array.from({ length: 90 }, (_, i) => seg(i % 2 ? 'You' : 'Speaker 1', i * 60_000, i * 60_000 + 50_000, `minute ${i} ${'x'.repeat(1_000)}`));
    const result = await new GatewaySummarizer(model).summarize({ segments, language: null });
    const notes = calls.filter((c) => c.responseFormat?.type !== 'json');
    expect(notes.length).toBe(5);
    expect(promptText(notes[0])).toContain('part 1 of 5');
    expect(promptText(notes[0])).toContain('minute 0');
    expect(promptText(notes[0])).not.toContain('minute 21 ');
    const final = calls[calls.length - 1];
    expect(final.responseFormat?.type).toBe('json');
    expect(promptText(final)).toContain('notes for part 1');
    expect(promptText(final)).toContain('## Part 5');
    expect(result.inputTokens).toBe(600);
  });

  it('replaces a generic title', async () => {
    const { model } = mockModel({ ...draft, title: 'Team meeting' });
    const result = await new GatewaySummarizer(model).summarize({ segments: [seg('You', 0, 1, 'hi')], language: null });
    expect(result.title).toBe('Pricing: Launch date, Free tier');
  });

  it('reports the model id when given a gateway string', () => {
    expect((new GatewaySummarizer('anthropic/claude-haiku-4.5') as unknown as { modelName(): string }).modelName()).toBe('anthropic/claude-haiku-4.5');
  });
});

describe('summary helpers', () => {
  it.each(['Meeting', 'Team meeting', 'Weekly sync', 'Discussion', 'Call', 'Quick catch-up', 'stand-up notes', 'x'])('"%s" is generic', (t) =>
    expect(isGenericTitle(t)).toBe(true),
  );
  it.each(['Pricing review: Pro to $29', 'Hiring sync: two offers out', 'Q3 roadmap call with Acme'])('"%s" is specific', (t) =>
    expect(isGenericTitle(t)).toBe(false),
  );

  it('clamps at a word boundary', () => {
    expect(clamp('short', 80)).toBe('short');
    const long = clamp('one two three four five six seven eight nine ten', 20);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long).toBe('one two three four…');
    expect(clamp('x'.repeat(30), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('builds fallback titles from topics or the summary', () => {
    expect(fallbackTitle({ keyTopics: ['Budget'], summary: '' })).toBe('Budget');
    expect(fallbackTitle({ keyTopics: [], summary: 'We cut the budget. Then lunch.' })).toBe('We cut the budget.');
    expect(fallbackTitle({ keyTopics: [' '], summary: '' })).toBe('Untitled recording');
  });

  it('chunks by time and by size', () => {
    const segs = Array.from({ length: 6 }, (_, i) => seg('A', i * 10 * 60_000, i * 10 * 60_000 + 1000, 'hello'));
    expect(chunkSegments(segs).map((c) => c.length)).toEqual([2, 2, 2]);
    expect(chunkSegments(segs, 60 * 60_000, 30).map((c) => c.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(chunkSegments([])).toEqual([]);
    expect(SINGLE_PASS_MAX_CHARS).toBe(60_000);
  });

  it('finalize trims, caps and drops empty items', () => {
    const out = finalize({
      ...draft,
      description: 'd'.repeat(300),
      keyTopics: ['a', '', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      actionItems: [
        { text: ' ', owner: null, due: null, dueDate: null },
        { text: 'Ship', owner: ' ', due: ' ', dueDate: '2026-02-30' },
      ],
      decisions: [' ok ', ''],
    });
    expect(out.description.length).toBeLessThanOrEqual(200);
    expect(out.keyTopics).toHaveLength(8);
    // An impossible date is dropped rather than stored.
    expect(out.actionItems).toEqual([{ id: expect.any(String), text: 'Ship', owner: null, due: null, dueDate: null, done: false }]);
    expect(out.decisions).toEqual(['ok']);
    expect(SYSTEM_PROMPT).toContain('same language as the transcript');
  });
});

describe('fakes', () => {
  it('produce deterministic, schema-shaped output', async () => {
    const s = await new FakeSummarizer().summarize({ segments: [seg('You', 0, 1, 'Ship it')], language: null });
    expect(s).toMatchObject({ title: 'Fake summary: Ship it', model: 'fake', actionItems: [{ owner: 'You' }] });
    const empty = await new FakeSummarizer().summarize({ segments: [], language: null });
    expect(empty.actionItems[0].owner).toBeNull();
    const t = await new FakeTranscriber().transcribe({ audio: new Uint8Array(7), mediaType: 'audio/webm', language: null });
    expect(t.segments[0].text).toContain('7 bytes');
  });
});

describe('validDate', () => {
  it('keeps real calendar dates and drops everything else', () => {
    expect(validDate(' 2026-10-09 ')).toBe('2026-10-09');
    expect(validDate('2026-02-29')).toBeNull();
    expect(validDate('Friday')).toBeNull();
    expect(validDate('1999-12-31')).toBeNull();
    expect(validDate(null)).toBeNull();
  });
});

import { MockLanguageModelV4 } from 'ai/test';
import { seg } from '../testing/fixtures';
import { applyVoices, diarizePrompt, FakeDiarizer, GatewayDiarizer } from './diarizer';

const parts = vi.hoisted(() => vi.fn());
vi.mock('./audio-prep', async (original) => ({ ...(await original<typeof import('./audio-prep')>()), speechParts: (...a: unknown[]) => parts(...a) }));

function model(answers: object[]) {
  const calls: { prompt: unknown }[] = [];
  let i = 0;
  return {
    calls,
    model: new MockLanguageModelV4({
      modelId: 'mock-gemini',
      doGenerate: (options) => {
        calls.push(options as never);
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify(answers[i++]) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        });
      },
    }),
  };
}

const segments = [seg('Speaker 1', 0, 1000, 'Morning, Daniel.'), seg('Speaker 1', 1000, 2000, 'Morning, Samantha.'), seg('Speaker 1', 2000, 3000, 'Shall we?')];

describe('applyVoices', () => {
  it('numbers voices by first appearance and fills lines the model skipped with the voice before', () => {
    expect(applyVoices(segments, ['b', 'A', undefined]).map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 2']);
    expect(applyVoices(segments, []).map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 1', 'Speaker 1']);
  });
});

describe('diarizePrompt', () => {
  it('numbers the lines with their times and carries the voices heard before', () => {
    const text = diarizePrompt([{ n: 1, startMs: 61_000, endMs: 64_500, text: 'Hello' }], [{ voice: 'B', text: 'Earlier words' }]);
    expect(text).toContain('1. [1:01–1:04] Hello');
    expect(text).toContain('B: Earlier words');
    expect(text).toContain('not by what is said');
  });
});

describe('GatewayDiarizer', () => {
  beforeEach(() => parts.mockReset());

  it('sends the audio and the numbered lines, and labels each line by voice', async () => {
    parts.mockResolvedValue([{ audio: new Uint8Array([7]), mediaType: 'audio/mpeg', offsetMs: 0 }]);
    const m = model([{ voices: 2, lines: [{ n: 1, voice: 'A' }, { n: 2, voice: 'B' }, { n: 3, voice: 'A' }] }]);
    const out = await new GatewayDiarizer(m.model).diarize({ audio: new Uint8Array(3), segments });
    expect(out.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']);
    const prompt = JSON.stringify(m.calls[0].prompt);
    expect(prompt).toContain('audio/mpeg');
    expect(prompt).toContain('2. [0:01–0:02] Morning, Samantha.');
  });

  it('keeps voices across parts of a long recording', async () => {
    parts.mockResolvedValue([
      { audio: new Uint8Array([1]), mediaType: 'audio/mpeg', offsetMs: 0 },
      { audio: new Uint8Array([2]), mediaType: 'audio/mpeg', offsetMs: 2000 },
    ]);
    const m = model([
      { voices: 2, lines: [{ n: 1, voice: 'A' }, { n: 2, voice: 'B' }] },
      { voices: 2, lines: [{ n: 1, voice: 'B' }] },
    ]);
    const out = await new GatewayDiarizer(m.model).diarize({ audio: new Uint8Array(3), segments });
    expect(out.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 2']);
    // The second part is told which voices were heard before it, and its times start at its own zero.
    const second = JSON.stringify(m.calls[1].prompt);
    expect(second).toContain('B: Morning, Samantha.');
    expect(second).toContain('1. [0:00–0:01] Shall we?');
  });

  it('leaves the transcript alone when it is off, has one line, can’t read the audio or the model fails', async () => {
    expect(await new GatewayDiarizer(null).diarize({ audio: new Uint8Array(1), segments })).toBe(segments);
    const m = model([]);
    expect(await new GatewayDiarizer(m.model).diarize({ audio: new Uint8Array(1), segments: segments.slice(0, 1) })).toEqual(segments.slice(0, 1));
    parts.mockResolvedValueOnce(null);
    expect(await new GatewayDiarizer(m.model).diarize({ audio: new Uint8Array(1), segments })).toBe(segments);
    parts.mockRejectedValueOnce(new Error('ffmpeg exploded'));
    expect(await new GatewayDiarizer(m.model).diarize({ audio: new Uint8Array(1), segments })).toBe(segments);
    expect(await new FakeDiarizer().diarize({ segments })).toBe(segments);
  });
});

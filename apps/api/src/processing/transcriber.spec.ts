import { testConfig } from '../testing/fixtures';
import {
  diarizesItself,
  fromPhrases,
  GatewayTranscriber,
  isFillerOnly,
  isNoSpeechText,
  isSilenceHallucination,
  joinDiarized,
  joinResults,
  mainLanguage,
  shiftResult,
  tailText,
  toTranscribeResult,
} from './gateway-transcriber';

const transcribe = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...(await original<typeof import('ai')>()), transcribe }));
const prepare = vi.hoisted(() => vi.fn());
vi.mock('./audio-prep', async (original) => ({
  ...(await original<typeof import('./audio-prep')>()),
  prepareForTranscription: (...args: unknown[]) => prepare(...args),
}));
beforeEach(() => {
  transcribe.mockReset();
  prepare.mockImplementation(async (audio: Uint8Array, mediaType: string) => [{ audio, mediaType, offsetMs: 0 }]);
});
const whisper = testConfig({ TRANSCRIBE_MODEL: 'openai/whisper-1' });

const phrase = (speaker: number | undefined, fromMs: number, toMs: number, text: string, locale = 'en-US') => ({
  text,
  offsetMilliseconds: fromMs,
  durationMilliseconds: toMs - fromMs,
  locale,
  ...(speaker === undefined ? {} : { speaker }),
});
const maiResult = (phrases: ReturnType<typeof phrase>[], durationInSeconds?: number) => ({
  text: phrases.map((p) => p.text).join(' '),
  segments: phrases.map((p) => ({ text: p.text, startSecond: p.offsetMilliseconds / 1000, endSecond: (p.offsetMilliseconds + p.durationMilliseconds) / 1000 })),
  language: undefined,
  durationInSeconds,
  providerMetadata: { azure: { phrases } },
});

describe('MAI-Transcribe (diarizing model)', () => {
  it('is the default and asks for diarization on MP3 parts of up to an hour', async () => {
    expect(diarizesItself(testConfig().env.TRANSCRIBE_MODEL)).toBe(true);
    expect(diarizesItself('openai/whisper-1')).toBe(false);
    prepare.mockResolvedValueOnce([{ audio: new Uint8Array([1]), mediaType: 'audio/mpeg', offsetMs: 0, durationMs: 20_000 }]);
    transcribe.mockResolvedValueOnce(
      maiResult([phrase(0, 200, 3_200, "We'll have the admin page soon then."), phrase(1, 3_560, 14_800, 'Yeah, I guess, if things go well, today.'), phrase(0, 15_080, 15_360, 'Okay.', 'de-DE')]),
    );
    const out = await new GatewayTranscriber(testConfig()).transcribe({ audio: new Uint8Array(30), mediaType: 'audio/mp4', language: null });
    expect(prepare).toHaveBeenLastCalledWith(expect.any(Uint8Array), 'audio/mp4', { encode: true, partSeconds: 3600, overlapSeconds: 90 });
    expect(transcribe.mock.lastCall?.[0]).toMatchObject({ model: 'microsoft/mai-transcribe-2', providerOptions: { azure: { diarization: { enabled: true } } } });
    expect(out).toEqual({
      segments: [
        { speaker: 'Speaker 1', startMs: 200, endMs: 3_200, text: "We'll have the admin page soon then." },
        { speaker: 'Speaker 2', startMs: 3_560, endMs: 14_800, text: 'Yeah, I guess, if things go well, today.' },
        { speaker: 'Speaker 1', startMs: 15_080, endMs: 15_360, text: 'Okay.' },
      ],
      language: 'en',
      durationSec: 20,
      diarized: true,
    });
  });

  it('falls back to plain segments when the phrases carry no speakers', () => {
    const out = fromPhrases(maiResult([phrase(undefined, 0, 1_000, 'Hello there.')], 1), '0');
    expect(out).toEqual({ segments: [{ speaker: 'Speaker 1', startMs: 0, endMs: 1_000, text: 'Hello there.' }], language: null, durationSec: 1, diarized: false });
    expect(fromPhrases({ ...maiResult([], 1), providerMetadata: undefined, text: '' }, '0').diarized).toBe(false);
  });

  it('drops hallucinated phrases and a transcript of fillers only', () => {
    expect(fromPhrases(maiResult([phrase(0, 0, 900, 'Thank you for watching!'), phrase(1, 1_000, 2_000, 'Real words.')]), '0').segments).toEqual([
      { speaker: '0:1', startMs: 1_000, endMs: 2_000, text: 'Real words.' },
    ]);
    expect(fromPhrases(maiResult([phrase(0, 0, 500, 'Bye.'), phrase(1, 600, 900, 'Okay.')]), '0').segments).toEqual([]);
  });

  it('takes the language spoken longest', () => {
    expect(mainLanguage([{ locale: 'de-DE', durationMilliseconds: 300 }, { locale: 'en-GB', durationMilliseconds: 9_000 }])).toBe('en');
    expect(mainLanguage([{ durationMilliseconds: 300 }])).toBeNull();
  });

  it('matches the speakers of two parts where they overlap', () => {
    // Part 0 covers 0–100 s; part 1 starts at 90 s and numbers the same people the other way round.
    const a = { segments: [
      { speaker: '0:0', startMs: 0, endMs: 40_000, text: 'Alex opens.' },
      { speaker: '0:1', startMs: 40_000, endMs: 92_000, text: 'Bea answers at length.' },
      { speaker: '0:0', startMs: 93_000, endMs: 99_000, text: 'Alex again.' },
    ], language: 'en', durationSec: 100, diarized: true };
    const b = { segments: [
      { speaker: '1:1', startMs: 90_500, endMs: 92_000, text: 'at length.' },
      { speaker: '1:0', startMs: 93_000, endMs: 99_000, text: 'Alex again.' },
      { speaker: '1:1', startMs: 101_000, endMs: 110_000, text: 'Bea after the cut.' },
      { speaker: '1:2', startMs: 111_000, endMs: 115_000, text: 'Cy joins late.' },
    ], language: null, durationSec: 120, diarized: true };
    expect(joinDiarized([a, b])).toEqual({
      segments: [
        { speaker: 'Speaker 1', startMs: 0, endMs: 40_000, text: 'Alex opens.' },
        { speaker: 'Speaker 2', startMs: 40_000, endMs: 92_000, text: 'Bea answers at length.' },
        { speaker: 'Speaker 1', startMs: 93_000, endMs: 99_000, text: 'Alex again.' },
        { speaker: 'Speaker 2', startMs: 101_000, endMs: 110_000, text: 'Bea after the cut.' },
        { speaker: 'Speaker 3', startMs: 111_000, endMs: 115_000, text: 'Cy joins late.' },
      ],
      language: 'en',
      durationSec: 120,
      diarized: true,
    });
  });

  it('transcribes each part with its offset and joins them', async () => {
    prepare.mockResolvedValueOnce([
      { audio: new Uint8Array([1]), mediaType: 'audio/mpeg', offsetMs: 0, durationMs: 3_600_000 },
      { audio: new Uint8Array([2]), mediaType: 'audio/mpeg', offsetMs: 3_510_000, durationMs: 600_000 },
    ]);
    transcribe
      .mockResolvedValueOnce(maiResult([phrase(0, 0, 10_000, 'First hour.'), phrase(1, 3_515_000, 3_520_000, 'Near the end.')]))
      .mockResolvedValueOnce(maiResult([phrase(0, 5_000, 10_000, 'Near the end.'), phrase(0, 100_000, 110_000, 'Later on.')]));
    const out = await new GatewayTranscriber(testConfig()).transcribe({ audio: new Uint8Array(30), mediaType: 'audio/mpeg', language: null });
    expect(out.segments.map((s) => [s.speaker, s.startMs, s.text])).toEqual([
      ['Speaker 1', 0, 'First hour.'],
      ['Speaker 2', 3_515_000, 'Near the end.'],
      ['Speaker 2', 3_610_000, 'Later on.'],
    ]);
    expect(out.durationSec).toBe(4110);
  });
});

describe('GatewayTranscriber', () => {
  it('transcribes a long recording part by part, carrying context and dropping the overlap', async () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    prepare.mockResolvedValueOnce([
      { audio: a, mediaType: 'audio/mpeg', offsetMs: 0 },
      { audio: b, mediaType: 'audio/mpeg', offsetMs: 1_195_000 },
    ]);
    transcribe
      .mockResolvedValueOnce({
        text: '',
        segments: [
          { text: 'Thanks, Priya.', startSecond: 1, endSecond: 2 },
          { text: 'The import runs Monday.', startSecond: 1196, endSecond: 1199 },
        ],
        language: 'en',
        durationInSeconds: 1200,
      })
      .mockResolvedValueOnce({
        text: '',
        segments: [
          // The overlap (1195–1200 s) heard again by the second part:
          { text: 'import runs Monday.', startSecond: 1, endSecond: 4 },
          { text: 'And SSO is mine.', startSecond: 6, endSecond: 8 },
        ],
        language: undefined,
        durationInSeconds: 600,
      });
    const out = await new GatewayTranscriber(whisper).transcribe({ audio: new Uint8Array(30), mediaType: 'audio/wav', language: null });
    expect(transcribe.mock.calls.map((c) => c[0].audio)).toEqual([a, b]);
    // The second part knows how the first ended, and is held to its language.
    expect(transcribe.mock.calls[1][0].providerOptions.openai).toEqual({
      timestampGranularities: ['segment'],
      language: 'en',
      prompt: 'Thanks, Priya. The import runs Monday.',
    });
    expect(out).toEqual({
      segments: [
        { speaker: 'Speaker 1', startMs: 1000, endMs: 2000, text: 'Thanks, Priya.' },
        { speaker: 'Speaker 1', startMs: 1_196_000, endMs: 1_199_000, text: 'The import runs Monday.' },
        { speaker: 'Speaker 1', startMs: 1_201_000, endMs: 1_203_000, text: 'And SSO is mine.' },
      ],
      language: 'en',
      durationSec: 1795,
    });
  });

  it('keeps the context to the last ~200 characters, cut at a word', () => {
    const long = { segments: [{ speaker: 'S', startMs: 0, endMs: 1, text: `${'word '.repeat(60)}end` }], language: null, durationSec: 1 };
    const tail = tailText(long);
    expect(tail.length).toBeLessThanOrEqual(200);
    expect(tail.startsWith('word')).toBe(true);
    expect(tail.endsWith('end')).toBe(true);
  });

  it('takes the length from the last part', () => {
    const r = (durationSec: number | null) => ({ segments: [], language: null, durationSec });
    expect(joinResults([r(10), r(null)]).durationSec).toBeNull();
    expect(shiftResult(r(5), 0)).toEqual(r(5));
    expect(shiftResult(r(5), 10_000).durationSec).toBe(15);
  });

  it('asks the gateway model for segment timestamps and labels one speaker', async () => {
    transcribe.mockResolvedValue({
      text: 'Hello there. Bye.',
      segments: [
        { text: ' Hello there. ', startSecond: 0, endSecond: 1.25 },
        { text: '  ', startSecond: 1.3, endSecond: 1.4 },
        { text: 'Bye.', startSecond: 2, endSecond: 1.9 },
      ],
      language: 'en',
      durationInSeconds: 2.4,
    });
    const audio = new Uint8Array([1, 2, 3]);
    const out = await new GatewayTranscriber(whisper).transcribe({ audio, mediaType: 'audio/webm', language: 'de' });
    expect(transcribe).toHaveBeenCalledWith({
      model: 'openai/whisper-1',
      audio,
      providerOptions: { openai: { timestampGranularities: ['segment'], language: 'de' } },
    });
    expect(out).toEqual({
      segments: [
        { speaker: 'Speaker 1', startMs: 0, endMs: 1250, text: 'Hello there.' },
        { speaker: 'Speaker 1', startMs: 2000, endMs: 2000, text: 'Bye.' },
      ],
      language: 'en',
      durationSec: 2,
    });
  });

  it('keeps text-only results as a single segment', () => {
    expect(toTranscribeResult({ text: ' Just text ', segments: [], language: undefined, durationInSeconds: undefined })).toEqual({
      segments: [{ speaker: 'Speaker 1', startMs: 0, endMs: 0, text: 'Just text' }],
      language: null,
      durationSec: null,
    });
    expect(toTranscribeResult({ text: '', segments: [], language: undefined, durationInSeconds: 3 }).segments).toEqual([]);
  });

  describe('Whisper silence hallucinations', () => {
    const seg = (text: string, startSecond = 0) => ({ text, startSecond, endSecond: startSecond + 2 });

    it.each([
      'Thank you for watching!',
      'Thanks for watching.',
      'Please subscribe to my channel',
      'Subtitles by the Amara.org community',
      'Дякую за перегляд!',
      'Спасибо за просмотр!',
      'Субтитры сделал DimaTorzok',
      'Продолжение следует...',
      'Vielen Dank fürs Zuschauen!',
      'ご視聴ありがとうございました',
    ])('recognizes "%s"', (text) => expect(isSilenceHallucination(text)).toBe(true));

    it.each(['Thanks for watching the budget closely, Anna.', 'We should subscribe to the vendor newsletter later.', 'Спасибо за отчёт'])(
      'keeps real speech: "%s"',
      (text) => expect(isSilenceHallucination(text)).toBe(false),
    );

    it('turns an all-hallucination transcript into no speech', () => {
      const r = toTranscribeResult({
        text: 'Дякую за перегляд! Спасибо за просмотр!',
        segments: [seg('Дякую за перегляд!'), seg('Спасибо за просмотр!', 30)],
        language: 'uk',
        durationInSeconds: 31,
      });
      expect(r.segments).toEqual([]);
    });

    it('drops a lone "Thank you." but keeps it inside a real meeting', () => {
      expect(toTranscribeResult({ text: 'Thank you.', segments: [seg('Thank you.')], language: 'en', durationInSeconds: 5 }).segments).toEqual([]);
      const meeting = toTranscribeResult({
        text: 'Ship it Monday. Thank you.',
        segments: [seg('Ship it Monday.'), seg('Thank you.', 3)],
        language: 'en',
        durationInSeconds: 6,
      });
      expect(meeting.segments.map((s) => s.text)).toEqual(['Ship it Monday.', 'Thank you.']);
      expect(isFillerOnly(' OK! ')).toBe(true);
      expect(isNoSpeechText('Thank you. Thanks for watching!')).toBe(true);
      expect(isNoSpeechText('Thank you. Ship it.')).toBe(false);
      expect(toTranscribeResult({ text: 'Thanks for watching!', segments: [], language: 'en', durationInSeconds: 3 }).segments).toEqual([]);
    });

    it('drops hallucinated sign-offs at the end of real speech', () => {
      const r = toTranscribeResult({
        text: 'Launch on Monday. Thanks for watching!',
        segments: [seg('Launch on Monday.'), seg('Thanks for watching!', 20)],
        language: 'en',
        durationInSeconds: 25,
      });
      expect(r.segments.map((s) => s.text)).toEqual(['Launch on Monday.']);
    });
  });
});


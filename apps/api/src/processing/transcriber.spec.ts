import { testConfig } from '../testing/fixtures';
import { GatewayTranscriber, isFillerOnly, isNoSpeechText, isSilenceHallucination, joinResults, shiftResult, toTranscribeResult } from './gateway-transcriber';

const transcribe = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...(await original<typeof import('ai')>()), transcribe }));
const prepare = vi.hoisted(() => vi.fn());
vi.mock('./audio-prep', async (original) => ({
  ...(await original<typeof import('./audio-prep')>()),
  prepareForTranscription: (...args: unknown[]) => prepare(...args),
}));
beforeEach(() => prepare.mockImplementation(async (audio: Uint8Array, mediaType: string) => [{ audio, mediaType, offsetMs: 0 }]));

describe('GatewayTranscriber', () => {
  it('transcribes a long recording in parts and stitches them back in place', async () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    prepare.mockResolvedValueOnce([
      { audio: a, mediaType: 'audio/mpeg', offsetMs: 0 },
      { audio: b, mediaType: 'audio/mpeg', offsetMs: 3_600_000 },
    ]);
    transcribe
      .mockResolvedValueOnce({ text: 'One', segments: [{ text: 'One', startSecond: 1, endSecond: 2 }], language: 'en', durationInSeconds: 3600 })
      .mockResolvedValueOnce({ text: 'Two', segments: [{ text: 'Two', startSecond: 5, endSecond: 6 }], language: undefined, durationInSeconds: 600 });
    const out = await new GatewayTranscriber(testConfig()).transcribe({ audio: new Uint8Array(30), mediaType: 'audio/wav', language: null });
    expect(transcribe.mock.calls.map((c) => c[0].audio)).toEqual([a, b]);
    expect(out).toEqual({
      segments: [
        { speaker: 'Speaker 1', startMs: 1000, endMs: 2000, text: 'One' },
        { speaker: 'Speaker 1', startMs: 3_605_000, endMs: 3_606_000, text: 'Two' },
      ],
      language: 'en',
      durationSec: 4200,
    });
  });

  it('only knows the total length when every part does', () => {
    const r = (durationSec: number | null) => ({ segments: [], language: null, durationSec });
    expect(joinResults([r(10), r(null)]).durationSec).toBeNull();
    expect(shiftResult(r(5), 0)).toEqual(r(5));
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
    const out = await new GatewayTranscriber(testConfig()).transcribe({ audio, mediaType: 'audio/webm', language: 'de' });
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


import { testConfig } from '../testing/fixtures';
import { GatewayTranscriber, isFillerOnly, isNoSpeechText, isSilenceHallucination, toTranscribeResult } from './gateway-transcriber';

const transcribe = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...(await original<typeof import('ai')>()), transcribe }));

describe('GatewayTranscriber', () => {
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


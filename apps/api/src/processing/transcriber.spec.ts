import { testConfig } from '../testing/fixtures';
import { GatewayTranscriber, toTranscribeResult } from './gateway-transcriber';

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
});

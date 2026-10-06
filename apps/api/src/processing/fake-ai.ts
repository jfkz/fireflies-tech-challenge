import { Injectable } from '@nestjs/common';
import { mergeSegments, speakersOf } from '@boringtalks/shared';
import { finalize } from './gateway-summarizer';
import { Summarizer, type SummarizeInput, type SummaryResult } from './summarizer';
import { SERVER_SPEAKER, Transcriber, type TranscribeInput, type TranscribeResult } from './transcriber';

/** Deterministic stand-ins used when AI_FAKE=1 (tests only; config refuses it elsewhere). */
@Injectable()
export class FakeSummarizer extends Summarizer {
  summarize({ segments }: SummarizeInput): Promise<SummaryResult> {
    const merged = mergeSegments(segments);
    const first = merged[0]?.text ?? 'nothing';
    const speakers = speakersOf(merged);
    const draft = {
      title: `Fake summary: ${first}`,
      description: `${merged.length} turns between ${speakers.join(', ')}.`,
      summary: `The meeting opened with "${first}". ${speakers.length} people spoke.`,
      keyTopics: ['Testing', 'Fake summaries', 'Pipelines'],
      topics: ['Testing'],
      speakers: speakers.map((label, i) => ({ label, name: i === 1 ? 'Maya' : null, role: null })),
      actionItems: [{ text: 'Check the fake summary', owner: speakers[0] ?? null, due: null }],
      decisions: ['Use fakes in tests'],
    };
    return Promise.resolve({ ...finalize(draft), model: 'fake', inputTokens: 0, outputTokens: 0 });
  }
}

@Injectable()
export class FakeTranscriber extends Transcriber {
  transcribe({ audio }: TranscribeInput): Promise<TranscribeResult> {
    return Promise.resolve({
      segments: [
        { speaker: SERVER_SPEAKER, startMs: 0, endMs: 2_000, text: `Fake transcript of ${audio.byteLength} bytes.` },
        { speaker: SERVER_SPEAKER, startMs: 2_500, endMs: 5_000, text: 'We agreed to ship on Friday.' },
      ],
      language: 'en',
      durationSec: 5,
    });
  }
}

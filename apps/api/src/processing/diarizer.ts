import { Inject, Injectable, Logger } from '@nestjs/common';
import { formatTimestamp, type Segment } from '@boringtalks/shared';
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { speechParts } from './audio-prep';

/** Tells voices apart in a server transcript (which comes back as one "Speaker 1"). */
export abstract class Diarizer {
  /** The segments with a speaker per voice ("Speaker 1", "Speaker 2"…), or them unchanged when it can't. */
  abstract diarize(input: { audio: Uint8Array; segments: Segment[] }): Promise<Segment[]>;
}

/** The model that listens to the recording; empty DIARIZE_MODEL turns diarization off. */
export const DIARIZE_LANGUAGE_MODEL = Symbol('DIARIZE_LANGUAGE_MODEL');

const VoicesSchema = z.object({
  voices: z.number().describe('How many different voices speak'),
  lines: z.array(z.object({ n: z.number().describe('Line number'), voice: z.string().describe('"A", "B", "C"… by order of first appearance') })),
});

/** How many lines before a part are shown to the next one, so the same voice keeps its letter. */
const CARRY_LINES = 12;

export function diarizePrompt(lines: readonly { n: number; startMs: number; endMs: number; text: string }[], before: readonly { voice: string; text: string }[]): string {
  const context = before.length
    ? `Earlier in the same recording these voices were already named; keep the same letters for the same voices:\n${before.map((b) => `${b.voice}: ${b.text}`).join('\n')}\n\n`
    : '';
  return `${context}This is the transcript of the attached recording, one numbered line per utterance, with times:
${lines.map((l) => `${l.n}. [${formatTimestamp(l.startMs)}–${formatTimestamp(l.endMs)}] ${l.text}`).join('\n')}

Listen to the voices. For every line, say which voice speaks it, as "A", "B", "C"… in order of first appearance. The same voice keeps the same letter throughout. Judge by the sound of the voice, not by what is said. If one line holds two voices, give the one that speaks most of it.`;
}

/** Letters per line → "Speaker 1…N" in order of first appearance; lines the model skipped keep the voice before them. */
export function applyVoices(segments: readonly Segment[], voices: readonly (string | undefined)[]): Segment[] {
  const names = new Map<string, string>();
  let previous: string | undefined;
  return segments.map((s, i) => {
    const v = voices[i]?.trim().toUpperCase() || previous;
    previous = v;
    if (!v) return s;
    if (!names.has(v)) names.set(v, `Speaker ${names.size + 1}`);
    return { ...s, speaker: names.get(v)! };
  });
}

/** Through the AI Gateway: an audio-capable model (Gemini Flash) hears the recording and labels each line. */
@Injectable()
export class GatewayDiarizer extends Diarizer {
  private readonly logger = new Logger(GatewayDiarizer.name);

  constructor(@Inject(DIARIZE_LANGUAGE_MODEL) private readonly model: LanguageModel | null) {
    super();
  }

  async diarize({ audio, segments }: { audio: Uint8Array; segments: Segment[] }): Promise<Segment[]> {
    if (!this.model || segments.length < 2) return segments;
    try {
      const parts = await speechParts(audio);
      if (!parts) return segments;
      const voices: (string | undefined)[] = new Array(segments.length);
      for (const [p, part] of parts.entries()) {
        const end = parts[p + 1]?.offsetMs ?? Infinity;
        const inPart = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.startMs >= part.offsetMs && s.startMs < end);
        if (inPart.length === 0) continue;
        const before = segments
          .map((s, i) => ({ s, i }))
          .filter(({ s, i }) => s.startMs < part.offsetMs && voices[i])
          .slice(-CARRY_LINES)
          .map(({ s, i }) => ({ voice: voices[i]!, text: s.text }));
        const lines = inPart.map(({ s }, k) => ({ n: k + 1, startMs: s.startMs - part.offsetMs, endMs: s.endMs - part.offsetMs, text: s.text }));
        const { output } = await generateText({
          model: this.model,
          output: Output.object({ schema: VoicesSchema }),
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: part.audio, mediaType: part.mediaType },
                { type: 'text', text: diarizePrompt(lines, before) },
              ],
            },
          ],
        });
        for (const l of output.lines) {
          const hit = inPart[l.n - 1];
          if (hit) voices[hit.i] = l.voice;
        }
      }
      const labelled = applyVoices(segments, voices);
      this.logger.log({ segments: segments.length, voices: new Set(labelled.map((s) => s.speaker)).size }, 'voices told apart');
      return labelled;
    } catch (err) {
      // Telling voices apart is a bonus: without it the meeting is still transcribed and summarized.
      this.logger.warn({ err: (err as Error).message }, 'diarization failed; keeping one speaker');
      return segments;
    }
  }
}

/** Tests: keeps the transcript as it is. */
@Injectable()
export class FakeDiarizer extends Diarizer {
  diarize({ segments }: { segments: Segment[] }): Promise<Segment[]> {
    return Promise.resolve(segments);
  }
}

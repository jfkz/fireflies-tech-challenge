import { Inject, Injectable, Logger } from '@nestjs/common';
import { mergeSegments, transcriptText } from '@boringtalks/shared';
import { generateText, Output, type LanguageModel } from 'ai';
import { nanoid } from 'nanoid';
import {
  chunkNotesPrompt,
  chunkSegments,
  clamp,
  DESCRIPTION_MAX,
  fallbackTitle,
  isGenericTitle,
  SINGLE_PASS_MAX_CHARS,
  summaryPrompt,
  SummarySchema,
  SYSTEM_PROMPT,
  TITLE_MAX,
  type SummaryDraft,
} from './summary-prompt';
import { Summarizer, type SummarizeInput, type SummaryResult } from './summarizer';
import { resolveDueDate } from './due-date';
import { normalizeTopics } from './topics';

/** The model the summarizer calls: a gateway id like "anthropic/claude-haiku-4.5", or a mock in tests. */
export const SUMMARY_LANGUAGE_MODEL = Symbol('SUMMARY_LANGUAGE_MODEL');

interface Usage {
  input: number;
  output: number;
}

/** Summarizes through the Vercel AI Gateway with AI SDK structured output. */
@Injectable()
export class GatewaySummarizer extends Summarizer {
  private readonly logger = new Logger(GatewaySummarizer.name);

  constructor(@Inject(SUMMARY_LANGUAGE_MODEL) private readonly model: LanguageModel) {
    super();
  }

  async summarize({ segments, language, ownerName, knownTopics = [], meetingDate }: SummarizeInput): Promise<SummaryResult> {
    const context = { ownerName, knownTopics, meetingDate };
    const merged = mergeSegments(segments);
    const transcript = transcriptText(merged);
    const usage: Usage = { input: 0, output: 0 };

    let draft: SummaryDraft;
    if (transcript.length <= SINGLE_PASS_MAX_CHARS) {
      draft = await this.structured(summaryPrompt(transcript, language, false, context), usage);
    } else {
      const chunks = chunkSegments(merged);
      this.logger.log({ chars: transcript.length, chunks: chunks.length }, 'long transcript: map-reduce');
      const notes: string[] = [];
      for (const [i, chunk] of chunks.entries()) {
        notes.push(await this.notes(chunkNotesPrompt(transcriptText(chunk), i + 1, chunks.length), usage));
      }
      const body = notes.map((n, i) => `## Part ${i + 1}\n${n}`).join('\n\n');
      draft = await this.structured(summaryPrompt(body, language, true, context), usage);
    }
    return { ...finalize(draft, knownTopics, meetingDate), model: this.modelName(), inputTokens: usage.input, outputTokens: usage.output };
  }

  private async structured(prompt: string, usage: Usage): Promise<SummaryDraft> {
    const result = await generateText({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt,
      output: Output.object({ schema: SummarySchema }),
      temperature: 0.2,
    });
    addUsage(usage, result.usage);
    return result.output;
  }

  private async notes(prompt: string, usage: Usage): Promise<string> {
    const result = await generateText({ model: this.model, system: SYSTEM_PROMPT, prompt, temperature: 0.2 });
    addUsage(usage, result.usage);
    return result.text;
  }

  private modelName(): string {
    return typeof this.model === 'string' ? this.model : this.model.modelId;
  }
}

function addUsage(total: Usage, u: { inputTokens: number | undefined; outputTokens: number | undefined }): void {
  total.input += u.inputTokens ?? 0;
  total.output += u.outputTokens ?? 0;
}

/** Enforces the limits the schema cannot: lengths, counts, non-generic title, stable action item ids. */
export function finalize(
  draft: SummaryDraft,
  knownTopics: readonly string[] = [],
  meetingDate?: Date,
): Omit<SummaryResult, 'model' | 'inputTokens' | 'outputTokens'> {
  const keyTopics = draft.keyTopics.map((t) => t.trim()).filter(Boolean).slice(0, 8);
  const title = isGenericTitle(draft.title) ? fallbackTitle({ keyTopics, summary: draft.summary }) : clamp(draft.title, TITLE_MAX);
  return {
    title,
    description: clamp(draft.description, DESCRIPTION_MAX),
    summary: draft.summary.trim(),
    keyTopics,
    // Older prompts (and a model that skips the field) still get tags: fall back to the key topics.
    topics: normalizeTopics(draft.topics?.length ? draft.topics : keyTopics, knownTopics),
    speakers: draft.speakers.map((s) => ({ label: s.label, name: s.name ?? null, role: s.role ?? null })),
    actionItems: draft.actionItems
      .filter((a) => a.text.trim())
      .map((a) => ({
        id: nanoid(10),
        text: a.text.trim(),
        owner: a.owner?.trim() || null,
        due: a.due?.trim() || null,
        // Common phrases ("today or tomorrow", "before Friday", "the weekend") are placed by rule; the
        // model's own date is the fallback for everything else.
        dueDate: (meetingDate && resolveDueDate(a.due, meetingDate)) || validDate(a.dueDate),
        done: false,
      })),
    decisions: draft.decisions.map((d) => d.trim()).filter(Boolean),
  };
}

/** A real calendar date "YYYY-MM-DD" in a sane range, or null (models sometimes answer "Friday" or "2026-02-30"). */
export function validDate(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  const year = d.getUTCFullYear();
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && year >= 2000 && year <= 2100 ? v : null;
}

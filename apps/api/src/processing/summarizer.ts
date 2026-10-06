import type { ActionItem, Segment } from '@boringtalks/shared';

/** What the pipeline stores for a meeting; ids and `done` flags are added by us, not the model. */
export interface SummaryResult {
  title: string;
  description: string;
  summary: string;
  keyTopics: string[];
  actionItems: ActionItem[];
  decisions: string[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface SummarizeInput {
  segments: Segment[];
  /** ISO code when known; otherwise the model answers in the transcript's language. */
  language: string | null;
}

/** Turns a transcript into title, summary, topics, action items and decisions. */
export abstract class Summarizer {
  abstract summarize(input: SummarizeInput): Promise<SummaryResult>;
}

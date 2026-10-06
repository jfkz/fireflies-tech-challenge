import type { ActionItem, Segment } from '@boringtalks/shared';
import type { SpeakerGuess } from './speaker-names';

/** What the pipeline stores for a meeting; ids and `done` flags are added by us, not the model. */
export interface SummaryResult {
  title: string;
  description: string;
  summary: string;
  keyTopics: string[];
  /** Up to four reusable tags for filtering. */
  topics: string[];
  /** Who each speaker label might be; the pipeline turns this into display names. Action item owners are still labels. */
  speakers: SpeakerGuess[];
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
  /** Account name of the person recording (speaker "You"), when known. */
  ownerName?: string | null;
  /** Topic tags the user's other meetings already use, most used first. */
  knownTopics?: readonly string[];
}

/** Turns a transcript into title, summary, topics, action items and decisions. */
export abstract class Summarizer {
  abstract summarize(input: SummarizeInput): Promise<SummaryResult>;
}

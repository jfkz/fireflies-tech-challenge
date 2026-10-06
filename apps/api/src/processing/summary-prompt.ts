import type { Segment } from '@boringtalks/shared';
import { z } from 'zod';

/** Above this many characters the transcript is summarized in parts first (map-reduce). */
export const SINGLE_PASS_MAX_CHARS = 60_000;
/** Length of one part in the map step. */
export const CHUNK_MS = 20 * 60 * 1000;

export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 200;

/**
 * Schema the model fills. Length limits live in the prompt and in `finalize`,
 * not in the schema, because providers' structured-output modes reject many
 * JSON Schema constraints.
 */
export const SummarySchema = z.object({
  title: z
    .string()
    .describe(`Specific, informative title (max ${TITLE_MAX} chars) naming the main outcome, e.g. "Pricing review: Pro tier to $29, launch moved to Nov 3"`),
  description: z.string().describe(`One sentence (max ${DESCRIPTION_MAX} chars) saying what happened`),
  summary: z.string().describe('3 to 6 sentences covering the substance of the meeting'),
  keyTopics: z.array(z.string()).describe('3 to 8 short topic labels'),
  actionItems: z
    .array(
      z.object({
        text: z.string().describe('The task, starting with a verb'),
        owner: z.string().nullable().describe('Speaker label or the name mentioned for the person who owns it, else null'),
        due: z.string().nullable().describe('Due date or time as said in the meeting, else null'),
      }),
    )
    .describe('Concrete follow-ups someone agreed to do'),
  decisions: z.array(z.string()).describe('Decisions that were actually made'),
});
export type SummaryDraft = z.infer<typeof SummarySchema>;

export const SYSTEM_PROMPT = `You write meeting notes for BoringTalks.
Rules:
- Write in the same language as the transcript.
- The title must be specific and informative: name the topic and the main outcome, with concrete numbers, names or dates when they matter. Never use a generic title such as "Meeting", "Discussion", "Call", "Sync", "Team meeting" or "Weekly catch-up". At most ${TITLE_MAX} characters.
- The description is one sentence of at most ${DESCRIPTION_MAX} characters.
- The summary has 3 to 6 sentences and states facts from the transcript only.
- Key topics: 3 to 8 short labels.
- Action items: only tasks someone actually took on or was asked to do. Owner is the speaker label exactly as it appears in the transcript (for example "You" or "Speaker 2"), or the person's name if one is mentioned; null if unclear. Due is the deadline as said, or null.
- Decisions: only things that were agreed, not proposals. Empty if none.
- Speaker "You" is the person who recorded the meeting.`;

export function summaryPrompt(body: string, language: string | null, fromNotes: boolean): string {
  const lang = language ? `The transcript language code is "${language}".\n` : '';
  const what = fromNotes
    ? 'Below are notes on consecutive parts of one long meeting, in order. Summarize the whole meeting.'
    : 'Below is the transcript, one line per turn: [time] speaker: text.';
  return `${lang}${what}\n\n<transcript>\n${body}\n</transcript>`;
}

export function chunkNotesPrompt(body: string, part: number, total: number): string {
  return `This is part ${part} of ${total} of a long meeting transcript, one line per turn: [time] speaker: text.
Write dense notes in the transcript's language: what was discussed, numbers, names, every decision and every action item with its owner (speaker label) and due date. No preamble.

<transcript>
${body}
</transcript>`;
}

/** Splits a transcript into parts of about CHUNK_MS each, also capping each part's size. */
export function chunkSegments(segments: readonly Segment[], chunkMs = CHUNK_MS, maxChars = SINGLE_PASS_MAX_CHARS): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let startMs = 0;
  let chars = 0;
  for (const s of segments) {
    const size = s.text.length + s.speaker.length + 12;
    if (current.length > 0 && (s.startMs - startMs >= chunkMs || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    if (current.length === 0) startMs = s.startMs;
    current.push(s);
    chars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const GENERIC_TITLE =
  /^(the\s+)?(our\s+)?((team|weekly|daily|monthly|quick|short|internal|project|status|general|online|zoom|video)\s+)*(meeting|discussion|call|sync|chat|conversation|catch[\s-]?up|check[\s-]?in|stand[\s-]?up|huddle|session|untitled|notes|recording|summary)(\s+(notes|summary|recording))?$/i;

export function isGenericTitle(title: string): boolean {
  const t = title.trim().replace(/[.!:"'«»]/g, '');
  return t.length < 4 || GENERIC_TITLE.test(t);
}

export function clamp(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** A title built from the topics when the model still returned a generic one. */
export function fallbackTitle(draft: Pick<SummaryDraft, 'keyTopics' | 'summary'>): string {
  const [first, ...rest] = draft.keyTopics.map((t) => t.trim()).filter(Boolean);
  if (first) return clamp(rest.length > 0 ? `${first}: ${rest.slice(0, 2).join(', ')}` : first, TITLE_MAX);
  const sentence = draft.summary.split(/(?<=[.!?])\s/)[0] ?? '';
  return clamp(sentence || 'Untitled recording', TITLE_MAX);
}

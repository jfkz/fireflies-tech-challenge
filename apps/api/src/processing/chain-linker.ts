import { Inject, Injectable } from '@nestjs/common';
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { MeetingRow } from '../db/schema';
import type { MeetingsRepository } from '../meetings/meetings.repository';
import { SUMMARY_LANGUAGE_MODEL } from './gateway-summarizer';

/** A meeting as the linker sees it. */
export interface ChainMeeting {
  id: string;
  title: string;
  description: string | null;
  startedAt: Date;
  speakers: readonly string[];
  topics: readonly string[];
}

export interface ChainInput {
  meeting: ChainMeeting & { summary: string };
  /** The user's other meetings around the same time, nearest first. */
  candidates: readonly ChainMeeting[];
}

export interface ChainLink {
  meetingId: string;
  /** One short sentence for the meeting page ("Follows up on the admin page plan"). */
  reason: string;
}

/** Decides whether a meeting continues another one (the same recurring meeting, a follow-up on the same work). */
export abstract class ChainLinker {
  abstract link(input: ChainInput): Promise<ChainLink | null>;
}

const REASON_MAX = 160;

const LinkSchema = z.object({
  related: z.number().int().nullable().describe('Number of the meeting this one continues, or null'),
  reason: z.string().describe('One short sentence: what connects them'),
});

const day = (d: Date) => d.toISOString().slice(0, 10);

function describe(m: ChainMeeting): string {
  const parts = [`[${day(m.startedAt)}] ${m.title}`];
  if (m.description) parts.push(m.description);
  if (m.speakers.length) parts.push(`people: ${m.speakers.join(', ')}`);
  if (m.topics.length) parts.push(`topics: ${m.topics.join(', ')}`);
  return parts.join(' — ');
}

export function chainPrompt({ meeting, candidates }: ChainInput): string {
  return `A user records their meetings. Decide whether this meeting continues one of their other meetings.

This meeting:
${describe(meeting)}
Summary: ${meeting.summary}

Other meetings:
${candidates.map((c, i) => `${i + 1}. ${describe(c)}`).join('\n')}

They belong together when this is the same recurring meeting (the same stand-up, the same one-on-one) or a follow-up on the same project, plan or decision: the same work is picked up again. Sharing only a broad topic ("Hiring") or one person is not enough. Answer with the number of the meeting it is most closely connected to, or null if none is, and one short sentence (at most ${REASON_MAX} characters) saying what connects them.`;
}

/** The summary model (Claude Haiku through the AI Gateway) reads this meeting and its neighbours. */
@Injectable()
export class GatewayChainLinker extends ChainLinker {
  constructor(@Inject(SUMMARY_LANGUAGE_MODEL) private readonly model: LanguageModel) {
    super();
  }

  async link(input: ChainInput): Promise<ChainLink | null> {
    if (input.candidates.length === 0) return null;
    const { output } = await generateText({
      model: this.model,
      temperature: 0,
      output: Output.object({ schema: LinkSchema }),
      prompt: chainPrompt(input),
    });
    return toLink(output, input.candidates);
  }
}

/** The model's answer as a link; a number that isn't on the list means none. */
export function toLink(answer: z.infer<typeof LinkSchema>, candidates: readonly ChainMeeting[]): ChainLink | null {
  const picked = answer.related !== null ? candidates[answer.related - 1] : undefined;
  if (!picked) return null;
  const reason = answer.reason.trim().replace(/\s+/g, ' ').slice(0, REASON_MAX) || 'Related meeting';
  return { meetingId: picked.id, reason };
}

/** How many nearby meetings a meeting is compared with. */
export const CHAIN_CANDIDATES = 20;

type ChainRepo = Pick<MeetingsRepository, 'chainCandidates' | 'joinChain'>;

/**
 * Links a finished meeting that continues another one into that meeting's chain. A meeting already
 * in a chain, or one the user linked or unlinked by hand, keeps its place. Returns the link made.
 */
export async function linkIntoChain(repo: ChainRepo, linker: ChainLinker, meeting: MeetingRow, summary: string): Promise<ChainLink | null> {
  if (meeting.chainId || meeting.chainLocked) return null;
  const candidates = await repo.chainCandidates(meeting.userId, meeting.id, meeting.startedAt, CHAIN_CANDIDATES);
  if (candidates.length === 0) return null;
  const link = await linker.link({ meeting: { ...meeting, summary }, candidates });
  if (link) await repo.joinChain(meeting.id, link.meetingId, { reason: link.reason, locked: false });
  return link;
}

/** AI_FAKE: links to the nearest meeting that shares both a person and a topic. */
@Injectable()
export class FakeChainLinker extends ChainLinker {
  link({ meeting, candidates }: ChainInput): Promise<ChainLink | null> {
    const lower = (xs: readonly string[]) => new Set(xs.map((x) => x.toLowerCase()));
    const people = lower(meeting.speakers);
    const topics = lower(meeting.topics);
    const match = candidates.find((c) => c.speakers.some((s) => people.has(s.toLowerCase())) && c.topics.some((t) => topics.has(t.toLowerCase())));
    return Promise.resolve(match ? { meetingId: match.id, reason: `Same people and topic as “${match.title}”` } : null);
  }
}

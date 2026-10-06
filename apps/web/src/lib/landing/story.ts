/**
 * The landing page's scroll story as data, so the components stay dumb and the
 * beats can be unit tested.
 */

export type HeadMood = 'chatty' | 'listening' | 'yawning' | 'asleep' | 'cheering';

export interface MeetingBeat {
  /** Index of the beat, 0 = hero chatter. */
  index: number;
  /** Caption shown over the scene (null in the hero). */
  caption: string | null;
  /** What each of the four heads is doing. */
  heads: [HeadMood, HeadMood, HeadMood, HeadMood];
  /** The line the one talking head is saying in this beat (hero chatter uses CHATTER instead). */
  line: { head: number; text: string } | null;
  /** The big "meetings are boring" statement is on screen. */
  statement: boolean;
}

export const MEETING_BEATS: readonly MeetingBeat[] = [
  { index: 0, caption: null, heads: ['chatty', 'chatty', 'chatty', 'chatty'], line: null, statement: false },
  {
    index: 1,
    caption: 'Minute 12. Someone shares the wrong screen.',
    heads: ['listening', 'chatty', 'listening', 'yawning'],
    line: { head: 1, text: 'Ignore those tabs. Can you see the deck now?' },
    statement: false,
  },
  {
    index: 2,
    caption: 'Minute 31. “Let’s circle back.” Nobody asks to what.',
    heads: ['yawning', 'listening', 'chatty', 'asleep'],
    line: { head: 2, text: 'Let’s circle back on that next sync.' },
    statement: false,
  },
  {
    index: 3,
    caption: 'Minute 47. The fourth status meeting this week.',
    heads: ['asleep', 'yawning', 'chatty', 'asleep'],
    line: { head: 2, text: 'So, quick status update on the status updates…' },
    statement: false,
  },
  {
    index: 4,
    caption: null,
    heads: ['asleep', 'asleep', 'chatty', 'asleep'],
    line: { head: 2, text: '…which brings us to slide 4 of 96.' },
    statement: true,
  },
];

/** Where each beat starts, as a fraction of the meeting track's scroll. */
export const MEETING_BEAT_STARTS = [0, 0.17, 0.34, 0.5, 0.68] as const;

export function meetingBeatAt(progress: number): MeetingBeat {
  let i = 0;
  for (let k = 0; k < MEETING_BEAT_STARTS.length; k++) if (progress >= MEETING_BEAT_STARTS[k]) i = k;
  return MEETING_BEATS[i];
}

/** Wall-clock minutes at each beat start, so the clock agrees with the captions. */
const CLOCK_KEYS: readonly (readonly [number, number])[] = [
  [0, 5],
  [0.17, 12],
  [0.34, 31],
  [0.5, 47],
  [0.68, 55],
  [0.9, 58],
];

/** Minutes on the wall clock: the "5 min quick sync" that runs to 58. */
export function clockMinutes(progress: number): number {
  const p = Math.min(0.9, Math.max(0, progress));
  for (let i = 1; i < CLOCK_KEYS.length; i++) {
    const [p1, m1] = CLOCK_KEYS[i];
    const [p0, m0] = CLOCK_KEYS[i - 1];
    if (p <= p1) return Math.round(m0 + ((p - p0) / (p1 - p0)) * (m1 - m0));
  }
  return 58;
}

/** Deadpan meeting clichés the heads say in the hero, in order: [head, line]. */
export const CHATTER: readonly (readonly [number, string])[] = [
  [1, 'Can everyone see my screen?'],
  [2, 'We can see your desktop. And your tabs.'],
  [0, 'Sorry, you were on mute.'],
  [3, 'Quick sync. Five minutes, tops.'],
  [1, 'Let’s take this offline.'],
  [2, 'Just to piggyback on that…'],
  [0, 'Can we circle back to the circle back?'],
  [3, 'I have a hard stop. In 50 minutes.'],
];

export type HowStep = 0 | 1 | 2;

export const HOW_STEP_STARTS = [0, 0.34, 0.67] as const;

export function howStepAt(progress: number): HowStep {
  return progress >= HOW_STEP_STARTS[2] ? 2 : progress >= HOW_STEP_STARTS[1] ? 1 : 0;
}

/** Transcript lines the Mac turns the call into (how-it-works step 2). */
export const DEMO_TRANSCRIPT = [
  { at: '0:04', speaker: 'You', text: 'Okay, pricing. Pro goes to $29.' },
  { at: '0:09', speaker: 'Speaker 1', text: 'From $24? Customers will riot.' },
  { at: '0:15', speaker: 'You', text: 'Annual stays at $240, so they won’t.' },
  { at: '0:22', speaker: 'Speaker 1', text: 'Fine. We launch November 3rd?' },
  { at: '0:27', speaker: 'You', text: 'November 3rd. Maya writes the email.' },
] as const;

/** The summary the server writes from it (step 3). */
export const DEMO_SUMMARY = {
  title: 'Pricing review: Pro to $29, launch Nov 3',
  description: 'Pro goes from $24 to $29 a month; annual stays at $240 so existing customers are covered.',
  actionItems: [
    { text: 'Write the launch email', owner: 'Maya', due: 'Oct 30' },
    { text: 'Update the pricing page', owner: 'You', due: 'Nov 2' },
  ],
  decisions: ['Pro is $29/month from Nov 3', 'Annual plan stays at $240'],
} as const;

import type { Segment } from '@boringtalks/shared';

/** Canned meeting every new account starts with, so the dashboard is never empty. No LLM involved. */
export const DEMO_MEETING = {
  title: 'Pricing review: Pro tier to $29, launch moved to Nov 3',
  description: 'Dana, Leo and you agreed to raise Pro to $29/month, keep a free tier, and push the launch a week for billing QA.',
  language: 'en',
  durationSec: 212,
  summary:
    'The team reviewed pricing ahead of the launch. Usage data shows Pro users run three times as many meetings as expected, so Pro goes from $19 to $29 a month while the free tier stays at five meetings. Existing subscribers keep $19 for twelve months. Billing migration needs another week of QA, so the public launch moves from October 27 to November 3. Leo will prepare the announcement email and Dana will update the pricing page.',
  topics: ['Pricing', 'Launch Planning', 'Billing'],
  keyTopics: ['Pro tier pricing', 'Free tier limits', 'Grandfathering existing subscribers', 'Billing migration QA', 'Launch date'],
  decisions: [
    'Pro tier price goes from $19 to $29 per month.',
    'The free tier stays at five meetings per month.',
    'Existing subscribers keep $19 for twelve months.',
    'Public launch moves from October 27 to November 3.',
  ],
  /** Due dates are days after the demo meeting, so a new account always sees upcoming tasks. */
  actionItems: [
    { id: 'demo-ai-1', text: 'Update the pricing page and the in-app paywall copy to $29', owner: 'Dana', dueInDays: 3, done: false },
    { id: 'demo-ai-2', text: 'Draft the announcement email for existing subscribers, including the 12-month price lock', owner: 'Leo', dueInDays: 2, done: false },
    { id: 'demo-ai-3', text: 'Run the billing migration against a copy of production and share the QA report', owner: 'You', dueInDays: 4, done: false },
    { id: 'demo-ai-4', text: 'Tell support about the new launch date', owner: 'You', dueInDays: null, done: true },
  ] satisfies { id: string; text: string; owner: string; dueInDays: number | null; done: boolean }[],
};

const lines: Array<[string, number, string]> = [
  ['You', 2, "Okay, let's start. The only topic today is pricing before the launch."],
  ['Dana', 9, 'I pulled the usage numbers from the beta. Pro users run about three times as many meetings as we modelled.'],
  ['Leo', 21, 'Which means at nineteen dollars we lose money on the heaviest accounts, right?'],
  ['Dana', 27, 'On the top ten percent, yes. Transcription is cheap, but storage and summaries add up.'],
  ['You', 38, 'What did the survey say about willingness to pay?'],
  ['Dana', 44, 'Most teams said twenty-nine is fine if the summaries stay this good. Thirty-nine started to hurt.'],
  ['Leo', 57, 'I would rather not go to thirty-nine. Twenty-nine is still below every competitor we looked at.'],
  ['You', 66, "Agreed. So Pro moves from nineteen to twenty-nine a month. Anyone against?"],
  ['Dana', 73, 'Not me.'],
  ['Leo', 75, "No, that's fine."],
  ['You', 79, 'Good. What about the free tier, do we cut it?'],
  ['Leo', 85, 'Please keep it. Half of our Pro signups started on free, it is our best funnel.'],
  ['Dana', 94, 'Five meetings a month costs us almost nothing. I would keep it exactly as it is.'],
  ['You', 103, 'Okay, free stays at five meetings. Now, existing subscribers.'],
  ['Leo', 110, 'If we just raise their price we will get angry emails. I suggest they keep nineteen for a year.'],
  ['Dana', 121, 'Twelve months is generous but it buys a lot of goodwill. I can live with that.'],
  ['You', 129, "Let's do it: existing subscribers keep nineteen dollars for twelve months."],
  ['Leo', 137, 'I will draft the announcement email with the price lock. I can have it by the twenty-ninth.'],
  ['You', 146, 'Now the uncomfortable part. The billing migration is not done.'],
  ['Dana', 152, 'The proration logic failed on annual plans yesterday. I need another week of QA, honestly.'],
  ['Leo', 163, 'So the twenty-seventh is not realistic?'],
  ['You', 167, 'No. I would rather move the launch to November third than ship broken invoices.'],
  ['Dana', 176, 'November third works. I will update the pricing page and the paywall copy by the thirtieth.'],
  ['You', 186, "I'll run the migration against a copy of production and share the QA report by the thirty-first. I already told support about the new date."],
  ['Leo', 199, 'Great, that is everything from my side.'],
  ['You', 203, 'Thanks both. Pro at twenty-nine, free stays, price lock for a year, launch on November third.'],
];

export const DEMO_SEGMENTS: Segment[] = lines.map(([speaker, sec, text], i) => {
  const next = lines[i + 1]?.[1] ?? sec + 6;
  return { speaker, startMs: sec * 1000, endMs: Math.max(sec * 1000 + 800, next * 1000 - 400), text };
});

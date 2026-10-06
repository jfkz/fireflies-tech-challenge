/** Questions people ask before trying BoringTalks. Rendered on the landing page and as FAQPage structured data. */
export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'How much does it cost?',
    a: 'Nothing. BoringTalks is free while it’s new: the Mac app, the dashboard and the summaries.',
  },
  {
    q: 'Which meeting apps does it work with?',
    a: 'All of them. Zoom, Google Meet, Microsoft Teams, Slack huddles, FaceTime, a phone call on speaker: if your Mac can hear it, BoringTalks can write it down.',
  },
  {
    q: 'Does a bot join my call?',
    a: 'No. Nobody gets a “Notetaker has joined” message. The app listens from your side of the call, the way you do.',
  },
  {
    q: 'How does it know who is speaking?',
    a: 'It tells voices apart and picks names up from the conversation: introductions, “thanks, Maya”, “Leo, can you…”. If it guesses wrong, rename a speaker once and the whole meeting updates.',
  },
  {
    q: 'I don’t have a Mac. Can I still use it?',
    a: 'Yes. Record a meeting right in the browser, or upload a recording you already have, and you get the same summary, speakers and tasks.',
  },
  {
    q: 'Which languages does it understand?',
    a: 'English and most European languages, including German, French, Spanish, Italian, Portuguese, Polish and Ukrainian.',
  },
  {
    q: 'Who can see my meetings?',
    a: 'Only you. Delete a meeting and its recording, transcript and notes go with it.',
  },
  {
    q: 'Do I have to tell people I’m recording?',
    a: 'Yes, please. Let everyone know, as you would with any recording. In many places it’s the law.',
  },
];

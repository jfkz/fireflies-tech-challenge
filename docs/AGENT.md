# An agent in the meeting: options

BoringTalks today listens from the user's side of the call (the Mac app taps system audio and the
microphone) and writes everything up after the meeting. An *agent in the meeting* means acting
**during** the call: answering questions ("what did we decide about pricing?"), keeping the agenda,
noting action items as they happen, and possibly speaking or writing in the call itself.

There are two independent questions:

1. **How does the agent hear the meeting?** Through the Mac app we already have, or by joining the
   call as a participant (a bot), or through a meeting platform's own media API.
2. **How does the agent answer?** On the user's screen only, in the call's chat, or out loud.

Prices below were checked in October 2026 and are list prices.

---

## Option A: a live copilot in the Mac app (no bot)

**How.** The Mac app already has the live transcript (Parakeet on the Neural Engine, speakers
separated). During the call it streams finished phrases to the API: a WebSocket, or batched `PUT`s
every few seconds. A side panel in the app, and the meeting page on the web, shows:
- a running summary, decisions and action items as they appear;
- an "Ask" box: "what did Leo promise?", "summarise the last 10 minutes", "draft the follow-up";
- nudges: "you have 5 minutes left and two agenda items", "nobody owns the migration yet".

Answers are short Claude Haiku calls through the AI Gateway, over the transcript so far. Long calls
use the map-reduce notes we already build.

- **Effort:** small to medium. A streaming endpoint, a `live` meeting status, a panel UI on the Mac
  and the web, and a rolling-summary worker job.
- **Cost:** transcription stays $0. A question over 30 minutes of transcript is about 8–10k input
  tokens, so cents. A rolling summary every 2 minutes is roughly $0.10–0.20 per meeting-hour.
- **Pros:** nobody sees a bot, so the "No bot joins your call" promise holds. Works with every
  meeting app, including phone calls on speaker. It's private and builds on code we have.
- **Cons:** only the person with the app benefits, and the agent can't act inside the call. macOS 26
  only; the browser recorder could do the same with server transcription (Whisper per chunk, about
  $0.006/min).

## Option B: the copilot also speaks, through a virtual microphone (no bot)

**How.** The Mac app installs a Core Audio virtual audio device (an AudioServerPlugIn, as BlackHole
and Loopback do). The user picks "BoringTalks Mic" in Zoom/Meet/Teams. The app mixes their real
microphone with the agent's voice, so when asked, the agent answers out loud, to everyone, "from"
the user.

- **Voice:** a speech-to-speech model (OpenAI `gpt-realtime`, about $0.06–0.11/min while active,
  or the mini model at about $0.02–0.05/min). Or a cheaper loop: our existing transcript, then
  Haiku, then a TTS voice; this adds a second or two of latency but costs only when it speaks.
- **Effort:** large. The audio driver needs signing and notarization, the user installs and selects
  a separate device, and we need echo handling and turn-taking ("BoringTalks, …" as a wake phrase,
  and a push-to-talk hotkey).
- **Pros:** still no bot, and it works in any app.
- **Cons:** everyone hears an AI speaking from one person's seat, so it must say so ("This is
  Mike's notes assistant"). Driver installs are a support burden. Mac only.

## Option C: a meeting bot as a participant, through a bot API (Recall.ai, Meeting BaaS)

**How.** The API joins Zoom, Google Meet, Teams (and Webex/Slack) from a meeting link or a
connected calendar as "BoringTalks Notetaker". It streams real-time audio and transcripts to our
webhook, posts in the chat, and with Recall's Output Media it can speak and show a web page (an
avatar, a live agenda) inside the call. Our worker pipeline stays the same: the bot's transcript
replaces the Mac upload.

- **Cost:** Recall.ai $0.50 per bot-hour, plus $0.15/h for its transcription (or send the audio
  through our own), plus storage after 7 days. Meeting BaaS sells hours at $0.35–0.50 plus optional
  plans. The voice model is on top if it talks.
- **Effort:** medium. Calendar connect (Google/Microsoft OAuth), "join automatically" settings,
  webhooks to meetings, a bot name and avatar, and consent messaging.
- **Pros:** works for people without a Mac and for meetings the user doesn't attend. The whole
  team sees it, it can chat and speak, and per-participant streams give exact speaker names.
- **Cons:** it's the bot experience our landing page says we avoid. Hosts can refuse it. It's an
  ongoing per-hour cost and adds a vendor dependency.

## Option D: run our own bots

**How.**
- **Google Meet:** headless Chrome (Playwright) with a signed-in bot account, capturing tab audio
  and playing generated audio as a fake microphone.
- **Zoom:** the Meeting SDK for Linux in a container. The app must pass Zoom Marketplace review to
  join meetings outside our own account.
- **Teams:** a Graph Communications media bot, which only runs as .NET on Windows Server.

Each would be a worker type on Railway (Windows for Teams), one container per live meeting.

- **Cost:** compute only, roughly one vCPU per concurrent meeting, so cents per hour at scale.
- **Effort:** very large, and it never ends. Meet's web UI changes break scrapers and Google
  challenges bot logins. Zoom review takes weeks. Teams needs a separate Windows/.NET stack.
- **When it makes sense:** only at a volume where $0.50/h is serious money. Start with C and replace
  per platform later.

## Option E: the platforms' own real-time APIs (no visible bot)

- **Zoom RTMS (Realtime Media Streams):** a Zoom app streams live audio, video and transcripts over
  WebSocket without a participant tile. It needs the Zoom admin to install our app and paid
  Developer Pack credits (pay-as-you-go or credit packs). A good fit for Zoom-heavy companies. It
  also has Zoom Apps for an in-meeting side panel.
- **Google Meet Media API:** still developer preview. The Cloud project, the OAuth user and
  **every participant** must be enrolled in the preview, so it's not usable for real users yet.
  Meet add-ons can show our side panel inside Meet, but don't get audio.
- **Microsoft Teams:** no participant-less audio API; real-time audio still means the Graph media
  bot (Option D). Teams meeting extensions can host our side panel.

---

## Recommendation

1. **Ship A first.** It's a live copilot in the Mac app and on the meeting page, using the live
   transcript we already have. It keeps "no bot", costs pennies, and turns the product from notes
   after the meeting into help during it. Natural features: a live summary, "ask the meeting",
   catching action items as they happen, and agenda and time nudges.
2. **Then C for reach.** Add "Send BoringTalks to this meeting" through Recall.ai, for users without a
   Mac, meetings they can't attend, and teams that want the agent to post in chat or speak. Make it
   opt-in per meeting so the no-bot default stays true.
3. **Keep B and E for later.** A virtual microphone if users want the agent to speak without a bot;
   Zoom RTMS if a customer is all-in on Zoom and wants no bot tile. Hold off on D until bot-hours
   cost real money.

What we'd build for A, roughly:
- Streaming endpoint plus a `live` status, and a `live_notes` job every ~2 minutes.
- Mac side panel and web live view.
- Ask box with an SSE answer stream.
- Tests:
  - unit tests on the rolling summary;
  - e2e: a fake live transcript produces live notes;
  - Mac UI tests for the panel.

## Sources

- Recall.ai pricing ($0.50/h, $0.15/h transcription): [Speak AI comparison](https://speakai.co/alternatives/the-best-recall-ai-alternative/), [apicostcalc](https://apicostcalc.com/recall-ai-vs-meetingbaas-vs-vexa-cost-calculator.html)
- Recall.ai Output Media (bots that speak and show video): [recall.ai](https://recall.ai/product/meeting-bot-api), [Sacra](https://sacra.com/c/recall-ai/)
- Meeting BaaS pricing: [apicostcalc](https://apicostcalc.com/recall-ai-vs-meetingbaas-vs-vexa-cost-calculator.html), [Meeting BaaS comparison](https://www.meetingbaas.com/en/blog/best-meeting-bot-apis)
- Zoom RTMS: [Zoom docs](https://developers.zoom.us/docs/rtms/meetings/), [self-service purchasing](https://devforum.zoom.us/t/rtms-self-service-purchasing-is-now-available/144524), [Recall.ai explainer](https://www.recall.ai/blog/what-is-zoom-rtms)
- Google Meet Media API (developer preview, all participants enrolled): [Google docs](https://developers.google.com/workspace/meet/media-api/guides/get-started), [Recall.ai explainer](https://www.recall.ai/blog/what-is-the-google-meet-media-api)
- Teams media bots (Windows Server, .NET): [Microsoft Learn](https://learn.microsoft.com/id-ID/microsoftteams/platform/bots/calls-and-meetings/calls-meetings-bots-overview)
- OpenAI realtime voice pricing: [Forasoft](https://www.forasoft.com/blog/article/openai-realtime-api-pricing), [Layer3 Labs](https://www.layer3labs.io/guides/openai-realtime-api-pricing)

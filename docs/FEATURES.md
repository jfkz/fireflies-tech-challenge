# Features

What BoringTalks does, by part. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Manual test flows: [QA.md](QA.md).

- [Web dashboard and landing page](#web-features-appsweb)
- [Mac app](#boringtalks-for-mac--features)
- [Backend](#backend-features-appsapi)

## Web features (apps/web)

Every feature of the website and dashboard: what it does, where it lives, and
its limits. Paths are relative to `apps/web/src`.

### Landing page `/`

**What.** A long, funny scroll story with the Talking Heads characters, then the
download and sign-up calls to action.

1. *The meeting* (hero): four heads in a meeting room trade deadpan clichés
   (“Can everyone see my screen?”, “You’re on mute”, “Quick sync. Five minutes,
   tops.”), typed out in comic speech bubbles; the talking head follows the
   cursor. Scrolling runs the wall clock from 5 to 58 minutes, dims the room and
   the sky outside, droops the plant, floats mugs past in the foreground, and
   pins sticky-note captions (“Minute 47. The fourth status meeting this week.”)
   while heads yawn and fall asleep. Punchline: “Meetings are boring. Notes about
   them shouldn’t be your job.”
2. *How it works*: three scroll-driven steps in customer terms (hit record, every
   voice gets a name, the boring part writes itself) beside a Mac window: You and
   Maya taking turns, the transcript arriving line by line, the summary card
   assembling itself with action items being ticked.
3. *Everybody wakes up*: the heads cheer one after another, confetti at several depths.
4. *What you get*: an itemised receipt of what one long meeting turns into (title,
   summary, names, tasks, decisions, “notes you took ×0”, 58 minutes back) and four
   points: every task in one list, see where your week went, find anything later,
   no bot joins your call. No prices or technical details on the landing page.
5. *Download* (`#download`): fed by `GET /downloads/latest`; version and build,
   “macOS 26 or later”, “Apple silicon & Intel”, DMG size, release date, a button
   linking straight to the DMG, and first-launch steps (drag to Applications,
   Microphone, System Audio Recording, sign in). If the build is not notarized it
   adds the right-click → Open step. A 404 shows “The Mac app is still in the
   oven” with a link to the browser recorder.
6. *FAQ* (`#faq`): price, which apps, no bot, how names are found, no Mac,
   languages, privacy, telling people you record. Native `<details>`, and the same
   entries go out as FAQPage structured data.
7. Final call to action and footer (“This website could have been an email.”).

**Voices.** Every head that talks also babbles out loud in a gibberish
“animalese” voice: each letter of its line becomes a short pitched blip (Web
Audio, no audio files), timed to the bubble's typing speed so the mouth, the
sound and the text move together; each head has its own pitch and timbre and a
question rises at the end. Sound is off until the visitor clicks the floating
**Sound off / Sound on** button (bottom right); the choice is remembered
(`localStorage bt.sound`) and comes back on at the first click of a later visit,
as browsers only allow audio after a gesture. At most two heads speak at once,
only heads on screen speak, and nothing plays with reduced motion.
`lib/landing/voice.ts`, `components/landing/Sound.tsx`, `TalkingHead`'s `line` prop.

**SEO.** Title, description, keywords, canonical URLs, Open Graph and Twitter
cards with a generated 1200×630 image (the four heads at the table and the
tagline; `app/_og/social-image.tsx`, heads drawn by `pnpm icon` into
`app/og-heads.svg`), `apple-icon`, `manifest.webmanifest`, `robots.txt` (signed-in
pages disallowed), `sitemap.xml`, and JSON-LD (`Organization`, `WebSite`,
`SoftwareApplication` with the stable DMG link, `FAQPage`) from `lib/landing/seo.ts`.

**Where.** `app/page.tsx`, `components/landing/*`, `components/avatar/*`,
`lib/avatar/*` (port of AvatarView.swift / Emotion.swift / OverlayViews.swift /
MarketingArt.swift), `lib/landing/story.ts`.

**Limits.** Respects `prefers-reduced-motion`: no sticky scenes or animation
loops, all story text shown as plain blocks. Works down to 375 px wide without
horizontal scrolling. Firebase and the API client (with the zod schemas) are not
part of the landing's initial JavaScript; heads animate only while visible.
Metadata: title/description, Open Graph and Twitter cards with a generated OG
image, canonical URL, `robots.txt`, `sitemap.xml`, SVG favicon, JSON-LD
`SoftwareApplication`.

### Accounts `/signup`, `/signin`, `/reset`

**What.** Email + password and Google (popup) sign-up/sign-in, password reset
email, sign-out (Settings). A sleepy receptionist head wakes up when you type,
looks away (“I’m not looking. Promise.”) while you type the password, looks sad
on errors and cheers on success. Firebase error codes become plain sentences.
`?next=` is honoured (same-site paths only) and carried between the sign-in and
sign-up forms.

**Where.** `app/(auth)/*`, `components/auth/AuthForm.tsx`, `components/auth/AuthMood.tsx`,
`components/providers/AuthProvider.tsx`, `lib/firebase.ts`, `lib/auth-errors.ts`.

**Limits.** Dashboard routes are guarded on the client (`RequireAuth`): a
signed-out visitor is sent to `/signin?next=<where they were>`; signing out on
purpose goes to `/`. The server never renders private data, so there is no
server-side session. The Auth emulator is used when
`NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR` is set.

### Meetings list `/meetings`

**What.** Every meeting with its AI-written title, description, date, duration,
speaker chips (each speaker gets a stable head and colour; “You” is always the
microphone head), a status chip (animated while recording / transcribing /
summarizing, red when failed) and the action-item count. Debounced search (300 ms)
over titles, summaries and transcripts via `q`, cursor pagination with “Load more”,
an empty state and a “nothing matches” state. Statuses refresh every 5 s while
anything is still processing.

*Filters.* Every row shows its speakers and topic tags as pills; clicking one filters
the list to that person or topic, clicking it again removes the filter. Above the
list, a filter bar offers the most frequent people and topics (`GET /meetings/facets`),
highlights the active ones, and has **Clear filters**. Filters and the search text
live in the URL (`/meetings?speaker=Maya&topic=Pricing&q=…`), so a filtered view can
be bookmarked or shared; typing replaces the URL, clicking a pill adds a history entry.
The empty result says what was filtered (“No meetings with Maya about Pricing.”).

**Where.** `components/app/MeetingsList.tsx` (`FilterBar`, `MeetingRow`), `lib/filters.ts`,
`components/ui/TopicPill.tsx`, `hooks/queries.ts` (`useMeetings`, `useMeetingFacets`).

**Limits.** 20 meetings per page. The list waits for `GET /me`, which creates the
account and its demo meeting on first visit.

### Meeting page `/meetings/[id]`

**What.**
- Header: title (rename inline: pencil, Enter saves, Escape cancels), date,
  duration, status, description, speakers by name and topic tags. Each chip opens
  the meeting list filtered by that person or topic. **Rename speakers** opens one
  field per speaker; only changed names are saved, and they stick through reprocessing.
  Giving two voices the same name makes them one person.
- While processing: a banner with a waiting head, a status-specific line and the
  pipeline steps; the page polls every 3 s and stops at ready or failed.
- Failed: the error from the server and a **Reprocess** button.
- Summary, key topics, action items (checkbox toggles are optimistic `PATCH`es;
  owner and due date shown), decisions, and which model wrote it.
- Transcript: consecutive phrases by the same speaker merged into turns
  (`mergeSegments`), speaker colour dot, timestamps (`formatTimestamp`).
- Audio player when the meeting has audio (presigned `audioUrl`): the segment
  being played is highlighted and kept in view (`segmentAt`); clicking a segment
  seeks there and plays.
- **Copy summary as Markdown**.
- **Delete** with an in-page confirmation dialog (`<dialog>`), never `window.confirm`.

**Where.** `components/app/MeetingView.tsx`, `hooks/useAudioSync.ts`, `lib/markdown.ts`,
`lib/status.ts`.

**Limits.** Unknown or foreign meeting ids show a friendly “This meeting isn’t
here”. Presigned audio URLs expire server-side; reloading the page fetches a new one.

### Browser recorder and upload `/record`

**What.** For people without the Mac app.
- *Record*: microphone via MediaRecorder (WebM/Opus, or MP4 on Safari), optionally
  **Also capture a tab** (getDisplayMedia with tab audio, mixed with the mic
  through Web Audio). Live timer and level meter; the head lip-syncs to your
  voice. After stopping: play back, optional title, **Save and summarize** or
  **Discard**. Saving creates the meeting (`source: browser`), gets a presigned
  URL, PUTs the audio straight to storage with a progress bar, calls `complete`,
  and opens the meeting page. A failed upload keeps the recording for “Try again”.
- *Microphone picker*: once the site may use the microphone, a **Microphone** menu
  lists the inputs (e.g. the MacBook mic next to a Bluetooth headset); the choice
  is remembered in this browser.
- *Upload*: drag and drop or choose a file; accepts the shared
  `AUDIO_CONTENT_TYPES` (M4A, MP4, MP3, WAV, WebM, OGG; type inferred from the
  extension when the browser gives none) up to `MAX_AUDIO_BYTES` (200 MB);
  same create → upload → complete flow with `source: upload`.

**Where.** `components/app/RecordView.tsx`, `hooks/useRecorder.ts`, `lib/recorder.ts`
(pure state machine), `lib/upload.ts`.

**Limits.** Browser recordings have no speaker separation on the device; the
server transcribes them. Tab capture exists only in desktop Chromium-based
browsers, and the visitor must tick “Share tab audio”. Permission errors are
explained in plain words.

### Connect the Mac app `/connect?challenge=…&device=…`

**What.** The Mac app opens this page with a PKCE S256 challenge and the Mac’s
name. Signed-out visitors sign in or sign up first and come back. The page asks
“Connect <device> to your BoringTalks account?”; **Connect this Mac** calls
`POST /devices/authorize` and sends the browser to the returned
`boringtalks://callback?code=…`, then shows “You can go back to the app.” with an
**Open BoringTalks** link and the one-time code (large, selectable, Copy button)
for the app’s paste-code fallback. **Not now** sends
`boringtalks://callback?error=access_denied`.

**Where.** `app/connect/*`, `components/app/ConnectView.tsx`, `lib/connect.ts`.

**Limits.** The challenge must be 43–128 base64url characters (the shared PKCE
rule); otherwise the page explains the link is missing or damaged and calls
nothing. The device name is cleaned of control characters and capped at 80
characters. Only `boringtalks://callback` URLs are ever navigated to.

### Settings `/settings`

**What.** Account email and sign-in method, **Sign out**; **Your name** (what
meetings call you instead of “You”; saving it renames you in past meetings too); “Email me when a meeting
is ready” switch (`PATCH /me/settings`); connected Macs with connected/last-seen
dates and **Disconnect** (confirmation dialog, `DELETE /devices/:id`); Mac app
version and download link.

**Where.** `components/app/SettingsView.tsx`.

### Errors and 404

Every dashboard route has `loading.tsx` and `error.tsx` (with a retry), plus
root `error.tsx`, `global-error.tsx`, and a 404 page with a confused head looking
around (“This page left the meeting early.”).

### API client

`lib/api.ts`: one typed function per endpoint; sends `Authorization: Bearer <Firebase
ID token>`; parses every response with the shared zod schema; non-2xx bodies become
`ApiRequestError` with the server’s `ApiError` message; network failures and
contract mismatches get readable messages; `GET /downloads/latest` is public and
returns `null` on 404.

## BoringTalks for Mac — features

Each feature: what it does, where it lives (`apps/macos/…`), and its limits.

### Menu-bar app

- **What:** a menu-bar icon (no Dock icon, `LSUIElement`) opening a window with the account,
  an optional meeting title, a big **Start meeting / Stop** button with an elapsed timer,
  level meters for **You** (mic) and **Others** (system audio), the live transcript toggle,
  the upload queue status, the last 5 meetings with their status, and Dashboard / Settings
  / Quit. While recording, the icon turns into a filled record dot.
- **Where:** `BoringTalks/App/BoringTalksApp.swift` (MenuBarExtra + Settings scenes),
  `BoringTalks/UI/MenuContent.swift`, `BoringTalks/App/AppModel.swift`.
- **Limits:** one meeting at a time. Quitting while recording stops the meeting, keeps the
  audio and queues it (the transcript gets up to 8 s to finish).

### Sign in with the browser (PKCE device link)

- **What:** opens `<web>/connect?challenge=<S256>&device=<Mac name>`; the dashboard
  redirects to `boringtalks://callback?code=…`; the app exchanges the code with
  `POST /devices/token {code, codeVerifier}` and keeps the `btd_…` token in the Keychain.
  **Paste code** accepts the bare code or the whole `boringtalks://` link. A 401 from any
  call signs the app out and pauses uploads.
- **Where:** `BoringTalksKit/PKCE.swift`, `BoringTalksKit/DeviceLink.swift`
  (`DeviceLink`, `DeviceAuthenticator`), `BoringTalksKit/Keychain.swift`; the URL arrives
  through an Apple Event handler in `AppDelegate`.
- **Limits:** the verifier is kept (Keychain) until the code is used, so a relaunch between
  opening the browser and the callback still works; starting a new sign-in replaces it.

### Recording a meeting

- **What:** microphone = "You", everything the Mac plays = the other people (Core Audio
  process tap, so Zoom/Meet/Teams/browser all work without a virtual driver). Both sides
  share one clock; dropouts and device switches are padded with silence; device changes
  restart that side's capture automatically. Both sides are mixed into a mono AAC file
  (16 kHz, 32 kbps, ~14 MB/hour).
- **Where:** `BoringTalks/Recording/MeetingRecorder.swift`, `RecordingChannel.swift`,
  `RecordingWriter.swift`, `BoringTalks/Speech/AudioCapture.swift`,
  `BoringTalksKit/ChannelTimeline.swift` (`ChannelTimeline`, `AudioMixer`).
- **Limits:** if one permission is refused the other side is still recorded (with a warning
  in the menu); with both refused, Start fails with the reason. Without headphones the mic
  also hears the call (handled by echo removal, below).

### On-device transcription

- **What:** Parakeet TDT 0.6B v3 (25 European languages, punctuation, language detected
  automatically or steered in Settings) on the Neural Engine via FluidAudio. Previews while
  a phrase is spoken, final text at each pause. Recording can start before the model has
  downloaded: audio waits (≤ 20 min per side) and is transcribed once the model is ready.
- **Where:** `BoringTalks/Speech/ParakeetEngine.swift`, `PhraseTranscriber.swift`,
  `SpeechModels.swift` (download progress in the menu and Settings).
- **Limits:** languages outside Parakeet's 25 come out wrong; if the model isn't ready by
  Stop, the meeting is uploaded with audio only and the server transcribes it.

### Telling the other people apart

- **What:** system-audio phrases are cut where the pitch jumps or the voice embedding
  changes, split into turns by SpeakerKit (pyannote), and matched to the meeting's voices
  with WeSpeaker embeddings → "Speaker 1…N" in order of first appearance, stable for the
  whole meeting. The mic is always "You".
- **Where:** `BoringTalks/Speech/VoiceAnalysis.swift` (`VoiceRegistry`, `VoiceIdentifier`,
  `VoiceEmbedder`), `BoringTalksKit/SegmentAssembler.swift` (`SpeakerLabeler`).
- **Limits:** up to 10 voices per meeting (more are folded into the nearest). Several people
  in one room on one far-end microphone are separated only as well as their voices differ.
  Error rates: see "Accuracy" in `apps/macos/README.md`. If the voice models can't load,
  everyone on the call is "Others".

### Transcript assembly and echo removal

- **What:** final phrases of both sides are merged by time into `{speaker, startMs, endMs,
  text}` segments (the shared `Segment` schema). A system phrase whose voice wasn't
  recognized (a laugh, "yeah") goes to the system speaker just before it. A mic phrase that
  overlaps a system phrase (±1.5 s) and repeats ≥ 60 % of its words is dropped as echo. Text
  is clipped to 10,000 characters, at most 20,000 segments. The language is the one set in
  Settings, else detected from the transcript text.
- **Where:** `BoringTalksKit/SegmentAssembler.swift`, `BoringTalksKit/RecordingJanitor.swift`
  (`LanguageGuess`).

### Live transcript window

- **What:** a small floating panel (stays above the meeting app, on every Space) with two
  cartoon heads — Others and You — whose mouths move with the audio while their words
  arrive, and the transcript with speaker labels and times; the phrase being spoken shows
  grey.
- **Where:** `BoringTalks/UI/LiveTranscriptWindow.swift`, `BoringTalks/Recording/LiveTranscript.swift`,
  `BoringTalks/Avatar/AvatarView.swift` (from Talking Heads, emotions removed).
- **Limits:** keeps the latest 300 lines on screen (the upload has all of them).

### Upload queue

- **What:** finished meetings go into a persisted queue:
  create → audio (optional, presigned PUT straight to R2) → transcript → complete. Resumes
  at the interrupted step after a relaunch; retries with exponential backoff (5 s … 15 min);
  retries at once when the network comes back; pauses on 401; drops meetings deleted on the
  server (404); treats 409 on complete as done; marks other refusals as failed with
  **Retry** / **Discard**. The menu shows e.g. "2 uploads waiting — offline".
- **Where:** `BoringTalksKit/UploadQueue.swift`, `BoringTalksKit/PendingMeeting.swift`,
  `BoringTalks/App/Reachability.swift`.
- **Limits:** one meeting uploads at a time; the audio file must be ≤ 200 MB (≈ 14 hours).
  `POST /meetings` sends `Idempotency-Key: <local id>`; if the API ignores it, a create
  whose response was lost can leave an empty duplicate meeting.

### Settings

- **What:** speech model status and download progress (with retry), language (automatic by
  default), **Upload meeting audio** (on by default), **Keep recordings on this Mac**
  (delete after upload / 1 / 7 / 30 days), show recordings in Finder, account and sign out,
  API and dashboard URLs, version, quit.
- **Where:** `BoringTalks/UI/SettingsView.swift`, `BoringTalks/App/Preferences.swift`.

### Recent meetings

- **What:** `GET /meetings?limit=5`, refreshed after each upload, every 20 s while any of
  them is still processing, and with the refresh button. Clicking one opens
  `<web>/meetings/<id>`.
- **Where:** `AppModel.refreshMeetings()`, `MenuContent.swift` (`RecentMeetings`).

### Environments

- **What:** production by default; `defaults write games.cutthecheese.boringtalks apiURL|webURL …`
  or `--api-url` / `--web-url` for dev or local. Non-production hosts show a badge.
- **Where:** `BoringTalksKit/AppConfig.swift`.

### Command line (QA and CI)

- `--transcribe <file> [--speakers] [--mic <file>] [--language xx] [--realtime]` prints the
  transcript JSON it would upload; `--icon <appiconset>` renders the icon; `--demo` and
  `--show-menu` show the live window and the menu for screenshots.
- **Where:** `BoringTalks/Recording/FileTranscriber.swift`, `BoringTalks/App/BoringTalksApp.swift`,
  `BoringTalks/Avatar/AppIconArt.swift`.

### Distribution

- **What:** universal build, DMG with an Applications link, notarization with an App Store
  Connect API key, upload of the DMG and `latest.json` to the public R2 bucket.
- **Where:** `apps/macos/scripts/` (`build.sh`, `make-dmg.sh`, `notarize.sh`, `publish.sh`, `test.sh`).
- **Limits:** without a Developer ID certificate the DMG is ad-hoc signed and not notarized;
  first launch then needs right-click → Open.

## Backend features (apps/api)

### Meetings API
Create, list (keyset pagination, full-text search over titles, descriptions and transcripts), read,
rename, toggle action items, delete (removes stored audio and transcripts too), reprocess. Every
route is per-user: someone else's meeting is a 404. Contract and examples: [API.md](API.md).

### Accounts
Firebase ID tokens are verified against Google's public keys; the first request creates the user,
seeds a ready demo meeting (no AI call) and queues a welcome email. Mac devices get revocable
`btd_…` tokens through the PKCE link; the dashboard lists and revokes them.

### Uploads
Audio goes from the client straight to R2 with a presigned PUT (15 min, 200 MB cap) and plays back
through a presigned GET. Transcripts are stored raw in R2 (`transcript.json`, source of truth) and
as rows for search. `POST /meetings` honours `Idempotency-Key`, so a client retry never creates a
duplicate.

### Processing pipeline (worker)
- **Transcribe** (browser recordings and uploads only): Whisper through the AI Gateway, with
  segment timestamps.
- **Summarize:** Claude Haiku 4.5 through the AI Gateway with structured output: a specific title,
  one-line description, summary, key topics, 1–4 reusable topic tags, action items (owner, due date),
  decisions, in the meeting's language, plus who each speaker label is. Long meetings are
  map-reduced. Generic titles are rejected. Each result is also snapshotted to R2.
- **Speaker names** (`processing/speaker-names.ts`): "You" becomes the account holder's first
  name; "Speaker N" gets the name the conversation reveals (introductions, being addressed by name
  and answering, sign-offs; never a person who is only talked about), else a clear role, else keeps
  its label. Guessed names are unique per meeting; names typed by a person are never overwritten.
  Segments keep their raw labels (`meetings.speaker_names` maps them), so renames lose nothing.
- **Topic tags** (`processing/topics.ts`): the prompt lists the user's 30 most used tags so
  meetings reuse them; tags are trimmed, capped at four and spelled like an existing tag when they
  match case-insensitively. They power the topic filter (`meetings.topics`, GIN index).
- **Email** (Resend): welcome, "your meeting is ready" (summary + action items, per-user toggle),
  "new Mac connected". Idempotent, allow-listed in dev, logged instead of sent without a key.
- Jobs retry 5 times with backoff, collapse duplicates, and a final failure marks the meeting
  `failed` with the reason; Reprocess starts over.

### Operations
`GET /health` (database + Redis, version, commit), `GET /downloads/latest` (current DMG),
per-user rate limits in Redis, structured JSON logs, graceful shutdown.

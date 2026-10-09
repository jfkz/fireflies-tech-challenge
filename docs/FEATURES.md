# Features

What BoringTalks does, by part. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Manual test flows: [QA.md](QA.md).

- [Web dashboard and landing page](#web-features-appsweb)
- [Mac app](#boringtalks-for-mac--features)
- [Backend](#backend-features-appsapi)

## Web features (apps/web)

Every feature of the website and dashboard: what it does, where it lives, and
its limits. Paths are relative to `apps/web/src`.

### Landing page `/`

**What.** A long, funny scroll story with a cast of cartoon heads, then the
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
sign-up forms. Google sign-in runs through the site's own domain (`/__/auth/*`, proxied to
Firebase by `next.config.ts`; `ownAuthDomain` in `lib/firebase.ts`), so Google's account picker
says “to continue to boringtalks.lol” instead of the Firebase project's address.

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
over titles, notes, action items, people, topics and transcripts via `q`, matching
words as you type them (“pric” finds “pricing”), with “quoted phrases” and -exclusions. Each
result shows where it matched with the words highlighted: the first matching transcript line with
who said it, when, and how many lines match (a click opens the meeting at that moment), or the
notes, title or people. Press **/** anywhere on the list to search. cursor pagination with “Load more”,
an empty state and a “nothing matches” state. Statuses refresh every 5 s while
anything is still processing.

*Filters.* Every row shows its speakers and topic tags as pills. A named person's chip opens their
person page (`/people/<name>`); a topic, a label like “Speaker 2” or “Others”, and you filter the
list to it, and clicking it again removes the filter. Above the
list, a filter bar offers the most frequent people and topics (`GET /meetings/facets`),
highlights the active ones, and has **Clear filters**; it is where you filter by a named person. Filters and the search text
live in the URL (`/meetings?speaker=Maya&topic=Pricing&q=…`), so a filtered view can
be bookmarked or shared; typing replaces the URL, clicking a pill adds a history entry.
The empty result says what was filtered (“No meetings with Maya about Pricing.”). Filtered by a
named person (not “Speaker 2”, “Others” or you), the bar also links **Time with Maya →** to their page.

**Where.** `components/app/MeetingsList.tsx` (`FilterBar`, `MeetingRow`), `lib/filters.ts`,
`components/ui/TopicPill.tsx`, `hooks/queries.ts` (`useMeetings`, `useMeetingFacets`).

**Limits.** 20 meetings per page. The list waits for `GET /me`, which creates the
account and its demo meeting on first visit.

### Meeting page `/meetings/[id]`

**What.**
- Navigation bar at the top (a `nav` landmark, “Meeting navigation”): **All meetings**, and when
  other meetings happened on the same day where you are, **← Previous that day** / **Next that
  day →** (“today” for today's meetings) with “2 of 3 that day”; the target's title is in the
  link's tooltip and accessible name, and the end of the day is greyed out. The day's meetings
  come from `GET /meetings?from=<local midnight>&to=<next midnight>&limit=100`, sorted by start.
- **Link to…** (always there, also on a meeting in no chain): an in-page dialog to put this meeting
  in a chain with another one the summarizer didn't connect. It lists your meetings within 45 days,
  nearest first (`GET /meetings?from&to&limit=100`); typing searches all of them (`?q=`, debounced).
  The meeting itself and its chain's meetings aren't offered. Picking one sends `PATCH {chain:
  {with: <id>}}` (kept through reprocessing) and shows the chain; a meeting already in a chain
  leaves it. Escape, **Cancel** or a click outside closes it; errors show in the dialog.
- Chains: a meeting the summarizer linked to earlier ones (or that was linked by hand) shows
  **Chain · 2 of 4**, why the meetings are connected (“Follows up on the admin page plan”, on every
  meeting of the chain, not only the one that was linked), **← Previous in
  chain** / **Next in chain →**, **Show all 4** (the whole chain in order, linked, this one
  highlighted), and **Remove from chain** with a confirmation dialog (`PATCH {chain: null}`; the
  meeting isn't linked again by itself).
- Keyboard: **[** / **]** previous / next meeting that day, **{** / **}** previous / next in the
  chain; ignored while typing in a field, with a modifier held, or with a dialog open.
- Header: title (rename inline: pencil, Enter saves, Escape cancels), date,
  duration, status, description, speakers by name and topic tags. A named speaker's
  chip opens their person page; “Speaker 2”, “Others”, you, and topic tags open the
  meeting list filtered by them. **Rename speakers** opens one
  field per speaker; only changed names are saved, and they stick through reprocessing.
  Giving two voices the same name makes them one person.
- While processing: a banner with a waiting head, a status-specific line and the
  pipeline steps; the page polls every 3 s and stops at ready or failed.
- Failed: the error from the server and a **Reprocess** button.
- Summary, key topics, action items (checkbox toggles are optimistic `PATCH`es;
  owner and due date shown), decisions, and which model wrote it.
- Transcript with **Find in transcript**: highlights every line containing the words, “2 of 7”
  with ↑/↓ (Enter / Shift+Enter). Opened from a search result (`?q=…&t=…`), it is filled in,
  scrolls to the matching line and cues the audio there without playing.
- Key topics under the transcript; “Written by AI” under the notes.
- Transcript: consecutive phrases by the same speaker merged into turns
  (`mergeSegments`), speaker colour dot, timestamps (`formatTimestamp`).
- Audio player when the meeting has audio (presigned `audioUrl`): the segment
  being played is highlighted and kept in view (`segmentAt`); clicking a segment
  seeks there and plays.
- **Copy summary as Markdown**.
- **Delete** with an in-page confirmation dialog (`<dialog>`), never `window.confirm`.

**Where.** `components/app/MeetingView.tsx`, `components/app/MeetingNav.tsx`, `lib/meeting-nav.ts`
(local day range, day and chain neighbours, link candidates), `hooks/useAudioSync.ts`, `lib/markdown.ts`,
`lib/status.ts`, `hooks/queries.ts` (`useSameDayMeetings`, `useLinkCandidates`).

**Limits.** Unknown or foreign meeting ids show a friendly “This meeting isn’t
here”. Presigned audio URLs expire server-side; reloading the page fetches a new one.

### Tasks `/tasks`

**What.** Every action item from every meeting in one list, in sections: Overdue, Today,
Tomorrow, This week, Later, No date. Each shows who owns it (speaker chip), when it is due
(“Due tomorrow”, “Due Fri, Oct 16”, or “2 days late” in red; the deadline as it was said on
hover), and “from *meeting title* · date”, linking to `/meetings/<id>#task-<id>`; the meeting
page scrolls to that action item and flashes it. Ticking a task off is an optimistic
`PATCH` through its meeting; it stays struck through in place until the list refreshes. Filter by
owner with chips (“Everyone” clears it); **Show done tasks** lists finished ones. Empty state:
“Nothing to do. Suspicious.”

**Where.** `components/app/TasksView.tsx`, `lib/tasks.ts` (sections, due labels, owners),
`lib/dates.ts`, `hooks/queries.ts` (`useTasks`, `useToggleTask`); API `GET /tasks`.

**Limits.** 100 tasks per page with **Load more**. Meetings summarized before due dates existed
show the deadline as said and sort under “No date” until reprocessed.

### People `/people`

**What.** Who you spend your meeting time with. **30 days** (default) / **90 days** / **All time**,
kept in the URL (`/people?days=90`, `?days=all`). A line sums up the period: “You spent 10 h in
meetings in the last 30 days, with 6 people who have names. Most of it with Maya: 4 h 10 min.”
Then everyone, most time together first; each row has their head, a bar as long as their time
together relative to the top person, “4 h 10 min together · 6 meetings · talks 38%” (their talk
time over the time together), when you last met (“3 days ago”), and their open tasks. A row opens
the person. With nobody yet: why (people appear once speakers have names, from the summary or
**Rename speakers**) and **Show all time**.

*Person `/people/<name>`.* Their name and head, cards for time together, meetings (since when),
their talk time (and its share) and when you last met. **Rename or merge** renames them in every
meeting; typing someone else's name merges the two, and the page moves to the new name. Topics of
your meetings with them (each opens the filtered list), their open tasks (tick them off like on
Tasks; links go to the action item in its meeting), and every meeting together with its date,
length and how long they talked. An unknown name shows “No one called …”.

**Where.** `components/app/PeopleView.tsx`, `components/app/PersonView.tsx`, `lib/people.ts`
(who counts as a person, periods, “last met”), `hooks/queries.ts` (`usePeople`, `usePerson`,
`useRenamePerson`); API `GET /people?days=`, `GET /people/:name`, `PATCH /people/:name`.

**Limits.** A person is a speaker name, matched in any case; unnamed voices, roles the summary gave
(“Recruiter”) and you aren't people. Time together isn't added up across people (two of them in
one meeting would count it twice), so the summary names the top person instead.

### Calendar `/calendar`

**What.** Where your meeting time went, counted in your browser's time zone:
- Cards: this week and this month (time and number of meetings), an average week since your first
  meeting in the last year, and the busiest day.
- A year heatmap (a column per week, Monday on top), shaded by minutes in meetings: none, under
  30 min, under 1½ h, under 3 h, 3 h or more. Hover or focus a day for its numbers; click it to open it.
- A month view with previous/next/today: each day shows its number of meetings and time, with a bar
  as tall as the time spent.
- The picked day's meetings, as list rows linking to each meeting.

**Where.** `components/app/CalendarView.tsx`, `lib/calendar.ts` (heatmap, month grid, totals),
`lib/dates.ts`; API `GET /meetings/stats` and `GET /meetings?from=&to=`.

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

### Version and updates

**What.** Every footer (the dashboard's and the landing page's) shows the build: `v0.4.0 · abc1234`
(the `apps/web` package version and the deployed commit; `dev` locally). The web app, the API and the Mac
app share major.minor (0.4.x); `pnpm check:versions` enforces it in CI. Each deployment serves its
own build at `GET /version.json` (uncached). An open tab checks it every 5 minutes while visible, and
when it comes back into view (at most once a minute). When a different deployment is live, a dialog
says “A new version is out” with **Reload now** / **Later**; **Later** leaves a “New version: reload”
link next to the version in the footer and doesn't ask again for that build. While the browser
recorder has a recording that hasn't reached the server yet (recording, recorded, uploading), or a
file upload is running, the dialog waits until it has.

**Where.** `lib/version.ts` (build info, hold-off), `app/version.json/route.ts`,
`components/app/UpdatePrompt.tsx` (`UpdatePrompt`, mounted in the root layout; `VersionTag`),
`next.config.ts` (`NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_BUILD_COMMIT` from `GITHUB_SHA`).

**Limits.** Local builds (`commit: dev`) never ask. A redeploy of the same commit doesn't count as new.

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
  BoringTalks Dev adds `&app=dev` and gets its code back on `boringtalks-dev://callback`.
  **Paste code** accepts the bare code or the whole `boringtalks://` link. A 401 from any
  call signs the app out and pauses uploads.
- **Where:** `BoringTalksKit/PKCE.swift`, `BoringTalksKit/DeviceLink.swift`
  (`DeviceLink`, `DeviceAuthenticator`), `BoringTalksKit/Keychain.swift`; the URL arrives
  through an Apple Event handler in `AppDelegate`.
- **Limits:** the verifier is kept (Keychain) until the code is used, so a relaunch between
  opening the browser and the callback still works; starting a new sign-in replaces it.

### Keychain without prompts

- **What:** release builds keep the sign-in in the **data protection Keychain**, under the app's
  access group (`YS48X6MG6D.<bundle id>`), so installing an update never asks "BoringTalks wants to
  use your confidential information stored in … in your keychain". (The login keychain ties an item
  to the exact signature that made it: a Developer ID build reading an item a development build made
  had to ask.) Builds without the entitlement (local, ad-hoc) still use the login keychain.
- **Where:** `BoringTalksKit/Keychain.swift` (`KeychainStore.usesDataProtection`, from the app's
  `com.apple.application-identifier` entitlement); `apps/macos/Signing/Distribution.entitlements` and
  the Developer ID provisioning profile, embedded and signed in by `scripts/release.sh`;
  `--keychain-check` prints which Keychain a build uses (release.sh refuses a build that says login).
- **Limits:** a sign-in made by 0.3.0 or older lives in the login keychain and isn't read any more:
  after updating to 0.3.1 you sign in once more.

### Recording a meeting

- **What:** microphone = "You", everything the Mac plays = the other people (Core Audio
  process tap, so Zoom/Meet/Teams/browser all work without a virtual driver). Both sides
  share one clock; dropouts and device switches are padded with silence; device changes
  restart that side's capture automatically. Both sides are mixed into a mono AAC file
  (16 kHz, 32 kbps, ~14 MB/hour) — or, with **Transcribe: Online**, kept apart in a stereo AAC
  file (microphone left, system audio right, 48 kbps, ~22 MB/hour) for the server to transcribe.
- **Where:** `BoringTalks/Recording/MeetingRecorder.swift`, `RecordingChannel.swift`,
  `RecordingWriter.swift`, `BoringTalks/Speech/AudioCapture.swift`,
  `BoringTalksKit/ChannelTimeline.swift` (`ChannelTimeline`, `AudioMixer`).
- **Limits:** if one permission is refused the other side is still recorded (with a warning
  in the menu); with both refused, Start fails with the reason. Without headphones the mic
  also hears the call (handled by echo removal, below).
- **Never on the main thread:** Core Audio start/stop calls run on one serial queue per side
  (`MeetingRecorder.micQueue` / `systemQueue`). Unplugging wired headphones mid-call once kept
  `AudioOutputUnitStart` waiting 7 minutes; now a side that hasn't started within 10 s shows
  "The microphone isn't responding…" while the meeting carries on (the gap is silence), and joins if
  Core Audio ever comes back. Stopping never waits for Core Audio.

### Stop after silence

- **What:** a meeting left recording after everyone has gone stops by itself. When nobody has
  spoken for the set time (**Stop after silence** in Settings: never / 1–60 minutes, default 5),
  the recording stops and uploads as usual, and a notification says so (“Nobody spoke for
  5 minutes, so BoringTalks stopped recording. “Weekly sync” is uploading as usual.”); the menu
  keeps the same note until dismissed. A minute before (half the time for limits under two
  minutes) a notification “Still in a meeting?” and a countdown in the menu offer **Keep
  recording**, which starts the count again. “Spoken” means the transcriber heard words on
  either side, so typing, a fan or background music don't keep a finished meeting going; until
  the speech model is loaded, any clear sound on the level meters counts instead.
- **Where:** `BoringTalksKit/SilenceWatch.swift` (the rule, unit-tested),
  `BoringTalks/Recording/MeetingRecorder.swift` (`checkSilence`, every half second),
  `BoringTalks/App/AppModel.swift` (`stopForSilence`), `BoringTalks/App/Notifier.swift`,
  `BoringTalks/UI/MenuContent.swift` (`SilenceWarning`).
- **Limits:** notification permission is asked when the first meeting starts; without it the
  stop is shown as an alert and the warning only in the menu. The trailing quiet stays in the
  recording (and its duration). Any value can be set with
  `defaults write games.cutthecheese.boringtalks silenceStopMinutes -int <minutes>`.

### Offer to record a call, stop when it ends

- **What:** when a call app has used the microphone for 5 s (a browser for 15 s, since browsers
  also open it for voice notes and dictation), a notification asks “Zoom is in a call. Record
  it?” with **Record** (clicking the notification does the same), **Not now** and **Never for
  this app**. The menu shows the same question and the menu-bar icon turns into a phone, so it
  works with notifications off. One question per call: **Not now** lasts until the app releases
  the mic, and an unanswered question disappears when it does. It never records without asking,
  unless **Start recording when a call starts** is on: then a call app's call (Zoom, Teams, Webex,
  Slack, FaceTime, Discord, Skype, WhatsApp, Telegram — not a browser, which still only gets the
  question) is recorded as soon as it counts as a call, with a “Recording the Zoom call” notification
  that has a **Stop** button. Apps under “Never asked” are left alone, and a recording stopped by hand
  isn't started again during the same call. Off by default.
  Recognized: Zoom, Teams, Webex, Slack, FaceTime (and iPhone calls), Discord, Skype, WhatsApp,
  Telegram, and Chrome, Brave, Arc, Edge, Firefox, Safari, Opera, Vivaldi.
  **Stop when the call ends:** the recording, started from the question or by hand (it adopts
  the call that holds the mic), stops once that app releases the microphone and the others have
  been quiet for 30 s (“The Zoom call ended. Stopping in 0:30.” with **Keep recording** in the
  menu; then the same “Recording stopped” notification as for silence). If the app takes the mic
  back (a reconnect), nothing stops; others still talking (a browser that drops the mic on mute)
  keep pushing the stop back. Stop after silence still applies when there is no call app (an
  in-person meeting).
- **How:** Core Audio's process objects (`kAudioHardwarePropertyProcessObjectList`,
  `kAudioProcessPropertyIsRunningInput`, `kAudioProcessPropertyBundleID`), with listeners plus a
  10 s re-read. It sees *which* app uses a microphone, never the audio, and needs no permission.
- **Where:** `BoringTalks/Speech/MicUsageMonitor.swift`, `BoringTalksKit/CallSignals.swift`
  (`CallApps`, `CallSignals`, `CallEndWatch`; unit-tested), `BoringTalks/App/AppModel.swift`
  (Calls), `BoringTalks/App/Notifier.swift`, `BoringTalks/UI/MenuContent.swift`
  (`CallOfferBanner`, `StopCountdown`). Settings › Calls: **Offer to record when a call starts**,
  **Stop when the call ends** (both on), and the apps set to “never” with **Ask again**.
- **Limits:** only while signed in. An app that isn't listed can be added with
  `defaults write games.cutthecheese.boringtalks extraCallApps -array <bundle id>` (find it with
  `--mic-users`). A browser holding the mic for something other than a call still gets asked
  (after 15 s); the tab isn't looked at. Calendar titles and automatic recording without asking
  are not built (see [MEETING-START.md](MEETING-START.md)).

### On-device transcription

- **What:** Parakeet TDT 0.6B v3 (25 European languages, punctuation, language detected
  automatically or steered in Settings) on the Neural Engine via FluidAudio. Previews while
  a phrase is spoken, final text at each pause. Recording can start before the model has
  downloaded: audio waits (≤ 20 min per side) and is transcribed once the model is ready.
- **Where:** `BoringTalks/Speech/ParakeetEngine.swift`, `PhraseTranscriber.swift`,
  `SpeechModels.swift` (download progress in the menu and Settings).
- **Limits:** languages outside Parakeet's 25 come out wrong; if the model isn't ready by
  Stop, the meeting is uploaded with audio only and the server transcribes it.

### Transcribe online instead

- **What:** Settings › Transcription › **Online, after the meeting** skips on-device
  transcription: no speech model is downloaded or loaded, there is no live transcript, and the
  meeting is recorded with the microphone and system audio on their own channels. The upload asks
  for its URL with `channels: "mic-system"`, and the worker transcribes each side by itself: the
  microphone as “You”, the others with their voices told apart, the microphone's echo of the call
  dropped like on the Mac. Stop after silence and the call-end stop work from the level meters.
- **Where:** `Preferences.transcribeOnMac`, `MeetingRecorder.start(…, transcribeLocally:)`,
  `AudioMixer` `.split` layout, `RecordingWriter(split:)`; server side under *Processing pipeline*.
- **Limits:** costs server transcription for both sides (see COSTS.md); the transcript arrives a
  minute or two after the meeting instead of at Stop.

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
  `BoringTalks/Avatar/AvatarView.swift` (emotions removed).
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

- **What:** four tabs, so the window stays short on a small screen; a tab that is still taller
  than the screen scrolls. **Transcription:** on this Mac or online, speech model status and
  download progress (with retry), language (automatic by default). **Recording:** Bluetooth
  headsets in high quality, **Upload meeting audio** (on by default; always on when the server
  transcribes), **Keep recordings on this Mac** (delete after upload / 1 / 7 / 30 days), show
  recordings in Finder, **Stop after silence** (never / 1–60 minutes, default 5). **Calls:** start
  recording when a call starts, offer to record other calls, stop when the call ends, apps never
  asked about. **Account:** sign in/out, API and dashboard URLs, version, quit. The last tab is
  remembered.
- **Where:** `BoringTalks/UI/SettingsView.swift`, `BoringTalks/App/Preferences.swift`.

### Recent meetings

- **What:** `GET /meetings?limit=5`, refreshed after each upload, every 20 s while any of
  them is still processing, and with the refresh button. Clicking one opens
  `<web>/meetings/<id>`.
- **Where:** `AppModel.refreshMeetings()`, `MenuContent.swift` (`RecentMeetings`).

### Environments

- **What:** two apps. **BoringTalks** connects to production; **BoringTalks Dev**
  (`games.cutthecheese.boringtalks.dev`, download `https://download.boringtalks.lol/dev/BoringTalks-Dev-latest.dmg`)
  connects to `api.dev` / `dev.boringtalks.lol` and installs next to it: its own sign-in scheme
  (`boringtalks-dev://`), Keychain items, settings and data folder (`Application Support/BoringTalks Dev`).
  Either can be pointed elsewhere with `defaults write <bundle id> apiURL|webURL …` or `--api-url` /
  `--web-url`. Non-production hosts show a badge.
- **Where:** `BoringTalksKit/AppFlavor.swift` (`BTFlavor` in Info.plist), `BoringTalksKit/AppConfig.swift`;
  the `BoringTalksDev` target in `project.yml` (same sources, `Dev/Info.plist`).

### Report a Problem and the hang watchdog

- **What:** **Report a Problem…** in the menu footer opens a window: "What happened?", an
  **Include the log** switch (on), and **What else is sent** listing the diagnostics. **Send** posts
  it to `POST /reports` (needs sign-in); **Save to File…** writes the same as text to Downloads.
  Sent: the message, app version/build/flavor, macOS and Mac model, short diagnostics (recorder
  phase and warnings, microphone, default input/output and inputs, model state, upload counts,
  preferences, uptime, memory) and this run's log (BoringTalks' own lines plus errors from system
  frameworks in the process, newest 1 MB). Never audio, transcripts or meeting titles.
- **Hang watchdog:** a background queue pings the main thread every second; 5 s without an answer
  is a hang. It is logged and saved to `last-hang.json` while it lasts, so a hang that ends in a
  force quit is still known on the next launch. The menu then shows "BoringTalks stopped
  responding for 7 min at 20:11." with **Report…** (the report is marked `hang`, with its start
  and length) and **Dismiss**.
- **Where:** `BoringTalks/App/ProblemReporter.swift`, `BoringTalks/UI/ReportWindow.swift`,
  `AppModel.diagnostics()`, `BoringTalksKit/ProblemReport.swift`, `HangWatch.swift`
  (`HangDetector`, `HangStore`), `Deadline.swift`.
- **Limits:** macOS only lets an app read its own log for the current run, so a report sent after
  a relaunch has the hang's time and length but not the log from before it.

### Command line (QA and CI)

- `--transcribe <file> [--speakers] [--mic <file>] [--language xx] [--realtime]` prints the
  transcript JSON it would upload; `--icon <appiconset>` renders the icon; `--demo` and
  `--show-menu` show the live window and the menu for screenshots; `--mic-users [seconds]` prints
  which apps use a microphone (and which call app each counts as) whenever that changes;
  `--keychain-check` prints the app, its API and which Keychain it keeps the sign-in in.
  `--report` opens Report a Problem. Debug builds only: `--simulate-hang <seconds>` blocks the main
  thread 3 s after launch; `--write-report <file>` writes what a report would send and quits;
  `--snapshot-windows <folder> <seconds>` saves the open windows as PNGs and quits.
- **Where:** `BoringTalks/Recording/FileTranscriber.swift`, `BoringTalks/App/BoringTalksApp.swift`,
  `BoringTalks/Avatar/AppIconArt.swift`.

### Distribution

- **What:** universal build, DMG with an Applications link, notarization with an App Store
  Connect API key, upload of the DMG and `latest.json` to the public R2 bucket.
- **Where:** `apps/macos/scripts/` (`release.sh prod|dev` runs `build.sh`, embeds the Developer ID
  provisioning profile and re-signs, `make-dmg.sh`, notarization and `publish.sh` on a developer's Mac;
  `dev` builds BoringTalks Dev into `/dev/`; CI runs `test.sh`).
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

### Chains of related meetings
After the summary, the summary model (`processing/chain-linker.ts`) sees the meeting and up to 20 of
the user's other finished meetings within 45 days (title, description, people, topics), and says
whether it is the same recurring meeting or a follow-up on the same work, with one sentence why.
If so it joins that meeting's chain (`meetings.chain_id`, `chain_reason`; migration 0005). A broad
topic or one shared person isn't enough. Linking or unlinking by hand (`PATCH /meetings/:id
{ chain }`) sets `chain_locked`, so the summarizer leaves it alone after that, also on reprocess.
A chain left with one meeting (unlinked or deleted) ends. The reason is stored on the meeting that
was linked; `GET /meetings/:id` shows it on every member (its own, else the nearest member's;
`chainReason` in `meetings.service.ts`), and `null` only when all were linked by hand. Best effort: a failed link never fails the
meeting. `node dist/link-chains.js [--user <uuid>]` links meetings summarized before chains existed.
Limits: one chain per meeting; demo meetings never chain.

### People across meetings
`GET /people`, `GET /people/:name`, `PATCH /people/:name` (`src/people/`): a person is a speaker name,
case-insensitive, across the user's finished meetings. Time together adds up their meetings' lengths;
talk time adds up their segments. Unnamed voices, roles (`speaker_names` entries marked `role`), the
account holder and the demo meeting are left out. A rename applies to every meeting (as a name typed
by hand) and to their action items; renaming to another person's name merges them. Limits: two
different people with the same name are one person until one is renamed; roles named before this
release aren't marked, so they count as people until the meeting is reprocessed.

### Uploads
Audio goes from the client straight to R2 with a presigned PUT (15 min, 200 MB cap) and plays back
through a presigned GET. Transcripts are stored raw in R2 (`transcript.json`, source of truth) and
as rows for search. `POST /meetings` honours `Idempotency-Key`, so a client retry never creates a
duplicate.

### Processing pipeline (worker)
- **Two-channel Mac recordings** (`audioChannels = 'mic-system'`, from **Transcribe: Online**):
  ffmpeg splits the file into the microphone side and the system side (mono 24 kbps MP3 each) plus a
  mono AAC mix, which becomes the meeting's playback audio (`audio-playback.m4a`, `playback_key`) so
  the user isn't in one ear only. The mix is saved before transcription starts (so a failed
  transcription still has it), and the dashboard is never handed the two-channel file: no player
  until the mix exists. Both sides go through the transcriber below in parallel; the
  system side gets its voices told apart, every microphone segment becomes “You”, and a microphone
  phrase that overlaps the others' and repeats ≥ 60% of their words is dropped as echo (the Mac's
  rule, `processing/channels.ts`). **Reprocess** starts again from the audio.
- **Transcribe and tell voices apart** (browser recordings and uploads): MAI-Transcribe 2
  (`TRANSCRIBE_MODEL`, `microsoft/mai-transcribe-2` through the AI Gateway, $0.10 an hour) with
  diarization: one phrase per speaker turn, each with its speaker (`processing/gateway-transcriber.ts`
  `transcribeDiarized`, `fromPhrases`, `joinDiarized`):
  - The audio is always re-encoded for speech with ffmpeg (mono, 16 kHz, 24 kbps MP3; Azure refuses
    AAC in M4A). Up to an hour goes in one request (~11 MB, ~20 s), so a meeting keeps one set of
    speakers; longer ones are cut into hour parts that overlap by 90 s, and each part's speakers are
    matched to the earlier part's by who speaks in the overlap.
  - Phrases become segments labelled Speaker 1, 2, 3 by first appearance; the language is the one
    spoken longest. The summarizer then names them as usual.
  - Chosen against the old Whisper + Gemini Flash line labelling on a 13-minute two-person upload:
    Whisper's 10-second lines often held both people (“Yeah. Cool. All right, anything else? No,
    that's fine.”), so a line's single label was wrong for half of it, and in the silent last two
    minutes Whisper wrote “Bye.” every 30 s. MAI split the turns, agreed with on-device voice
    separation 86% of the time (Whisper + Gemini: 78%), and was right in the disputed turns.
- **Whisper fallback:** with a model that doesn't diarize (`TRANSCRIBE_MODEL=openai/whisper-1`),
  audio over 24 MB is compressed, recordings over 20 minutes go in 20-minute parts that overlap by
  5 s with the previous text as context, and an audio model (`DIARIZE_MODEL`, Gemini 3 Flash)
  listens to the recording with the numbered transcript and says which voice speaks each line. If
  that fails, the meeting keeps one speaker rather than failing (`processing/diarizer.ts`).
  **Reprocess** on a browser or upload meeting starts again from its audio, so older ones get voices too.
- **Summarize:** Claude Haiku 4.5 through the AI Gateway with structured output: a specific title,
  one-line description, summary, key topics, 1–4 reusable topic tags, action items (owner, due date),
  decisions, in the meeting's language, plus who each speaker label is.
- **Due dates:** deadlines are turned into calendar dates counted from the meeting day:
  - Common phrases are placed by rule (`processing/due-date.ts`). A range or choice ends on its
    last day ("today or tomorrow" → tomorrow, "the weekend" → Sunday); "before Friday" is Thursday;
    "next Friday" is next week's.
  - For other phrases, the model's date is used. The prompt gives it a three-week calendar, since
    models miscount weekdays.
  - `node dist/backfill-due-dates.js [--dry-run]` re-dates existing action items the same way. Action items live in their own table (`action_items`), indexed for the tasks list. Long meetings are
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

### Problem reports
`POST /reports` keeps what the Mac app sends from **Report a Problem…** (or after it noticed a hang):
the user's message, app version and flavor, macOS and Mac model, up to 100 short diagnostics and the
app's own recent log (≤ 1,000,000 characters), with the user and the Mac that sent it, in
`problem_reports`. 10 reports an hour per user. When `REPORTS_NOTIFY_EMAIL` is set, each one is
emailed there (without the log) through the `email` queue. Operators read them with
`node dist/reports.js` (latest 20, `--user <id|email>`, or `<id>` for one in full).
**Where.** `src/reports/` (controller, service, repository), `src/reports.ts` (CLI),
`src/email/templates/problem-report.tsx`, migration `0006_problem_reports`.

### Operations
`GET /health` (database + Redis, version, commit), `GET /downloads/latest` (current DMG),
per-user rate limits in Redis, structured JSON logs, graceful shutdown.

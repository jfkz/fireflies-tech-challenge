# QA flows

Manual test flows with steps and expected results. Automated coverage: unit tests in every package, API e2e (`apps/api/test`), Playwright UI and smoke suites (`e2e/`), XCTest (`apps/macos/BoringTalksTests`).

- [Web](#manual-qa-web-appsweb)
- [Mac app](#boringtalks-for-mac--manual-qa)
- [Backend and end to end](#manual-qa-backend-and-end-to-end)

## Manual QA: web (apps/web)

Run against dev (`https://dev.boringtalks.lol`) or prod (`https://boringtalks.lol`).
Use a fresh email (e.g. `you+qa1@…`) unless a step says otherwise. Check desktop
(about 1440 px) and a phone (375 px, or browser device mode) where noted.

Automated coverage: `pnpm --filter @boringtalks/e2e test:e2e` (mocked API, Auth
emulator) and `test:smoke` (public checks against a deployment). The flows below
are what those can’t judge: looks, real Firebase, real API, real storage and email.

### 1. Landing page

| # | Steps | Expected |
|---|---|---|
| 1.1 | Open `/` on desktop. | Headline “Your meeting, minus the meeting.”, four heads behind a table. Bubbles type out one cliché at a time; heads blink, glance around; the talking head’s eyes follow the cursor. No console errors. |
| 1.2 | Scroll slowly through the first scene. | Wall clock runs 5 → 58 min. Sticky notes appear in order: Minute 12, 31, 47. Room and window sky darken, plant droops, mugs float past faster than the background. Heads yawn, then fall asleep with Zzz. Ends on “Meetings are boring. Notes about them shouldn’t be your job.” Scrolling back reverses everything. |
| 1.3 | Keep scrolling through “How it works”. | Step 1 (two heads recording, level meters), step 2 (transcript lines drop in), step 3 (summary card assembles, action items get ticked). The active step is highlighted on the left. |
| 1.4 | Continue to the yellow section, “What you get”, download, FAQ, final CTA. | Heads pop up cheering, confetti moves at different speeds; the receipt lists what a meeting turns into and drifts; no prices or technical terms anywhere; FAQ answers open and close; footer reads “This website could have been an email.” |
| 1.4a | Watch the wall clock while scrolling the first scene. | Both hands turn around the centre of the dial (5 min ≈ 10:05, 58 min ≈ 10:58); nothing sticks out of the clock face. |
| 1.4b | Hero at 1280×720, 1440×900, 1024×768 and phone width. | **Download for Mac**, then “or try it in the browser →” under it; neither covers a face. |
| 1.4c | Click **Sound off** (bottom right). | It turns into **Sound on**; the talking head babbles in a gibberish voice in time with its bubble and mouth; every head that talks (hero, How it works, the wake-up cheers, final CTA) has its own voice. Click again: silence. Reload: the button says Sound off until your first click, then the voices come back. |
| 1.5 | Click **Download for Mac** in the hero. | Page scrolls to the download card. |
| 1.6 | Download card, with a build published. | Version and build, “macOS 26 or later”, “Apple silicon & Intel”, size, date. The button downloads the `.dmg` from `download.boringtalks.lol`. If the build isn’t notarized, a step explains right-click → Open. |
| 1.7 | Download card, before any build exists. | “The Mac app is still in the oven.” and a **Record in the browser** button; no broken link. |
| 1.8 | Phone width (375 px): repeat 1.1–1.4. | No horizontal scrolling, nothing cut off; bubbles fit; headline readable above the heads. |
| 1.9 | Turn on Reduce Motion (macOS: Accessibility → Display) and reload. | Nothing animates or sticks; the story captions and “Meetings are boring.” are shown as plain text; “How it works” is a static list with finished pictures. |
| 1.10 | Paste the URL into Slack/iMessage or an OG debugger. | Card with title, description and the generated image (four heads at the table, the headline). Favicon is the two-heads app icon. |
| 1.11 | Open `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, and run the page through a rich-results test. | Signed-in pages disallowed; sitemap lists `/`, `/signup`, `/signin`; JSON-LD has SoftwareApplication (download link `BoringTalks-latest.dmg`) and FAQPage with every question. |

### 2. Sign up, sign in, reset

| # | Steps | Expected |
|---|---|---|
| 2.1 | Open `/signup`. | Receptionist head asleep with Zzz. |
| 2.2 | Type in Email. | Head wakes up: “Oh! Hi. Go on, I’m listening.” |
| 2.3 | Type in Password. | Head closes its eyes: “I’m not looking. Promise.” |
| 2.4 | Wait ~10 s without typing. | Head nods off again. |
| 2.5 | Submit a new email + 6+ char password. | Lands on `/meetings` with the demo meeting (“Demo” badge) already there. |
| 2.6 | Sign out (Settings), sign in at `/signin` with a wrong password. | “Wrong email or password.”, head looks sad. |
| 2.7 | Sign in with the right password. | Back on `/meetings`. |
| 2.8 | **Continue with Google**. | Google popup; on success lands on `/meetings`. Closing the popup shows a plain message. |
| 2.9 | `/signin` → **Forgot it?** → submit your email. | “a reset link is on its way”; the email arrives and its link leads to setting a new password, then back to `/signin`. |
| 2.10 | Signed out, open `/meetings/<any id>` or `/settings`. | Redirected to `/signin?next=…`; after signing in you land on the page you asked for. |

### 3. Meetings list

| # | Steps | Expected |
|---|---|---|
| 3.1 | Open `/meetings`. | Each row: date and duration, title, description, speaker chips with small heads, status chip, action-item count. |
| 3.2 | Type “pricing” in search. | One request after you stop typing; matching meetings only. Type nonsense: “No meetings matching …”. Clear: full list. |
| 3.2a | Type the start of a word (“pric”), a name, an action item's words, then `"launch email"` and `pricing -draft`. | Results appear for partial words; meetings match on notes, action items, people and topics too; phrases and exclusions work. Each result shows a highlighted snippet: a transcript line with who and when (and “N mentions”), or the notes/title/people. |
| 3.2b | Click a transcript snippet. | The meeting opens with “Find in transcript” filled in, the matching line in view and highlighted, the audio cued to that time (not playing). ↑/↓ step through the other matches. |
| 3.2c | Press **/** on the list. | The search box gets focus (not while typing in another field). |
| 3.3 | With more than 20 meetings, scroll to the bottom. | **Load more** appends the next page; disappears at the end. |
| 3.4 | Start a browser recording (section 5) and return to the list. | Its chip animates (Transcribing/Summarizing) and changes to Ready by itself. |
| 3.6 | Click a topic pill on a row, then a person in the filter bar, then the active pill again, then **Clear filters**. | The list narrows to that topic, then that topic and person; the URL shows `?topic=…&speaker=…`; clicking an active pill removes it; Clear brings everything back. Back button walks through the filters. |
| 3.7 | Filter to a combination with no meetings. | “No meetings with X about Y.” and a **Clear filters** button. |
| 3.5 | New account with the demo deleted. | Empty state with a head (“Your calendar must be suspiciously free.”) and links to record or get the Mac app. |

### 4. Meeting page

| # | Steps | Expected |
|---|---|---|
| 4.1 | Open the demo meeting. | Title, date, duration, Ready chip, speakers, description; Summary, Key topics, Action items with owners/due dates, Decisions; transcript with speaker dots and timestamps, consecutive lines by one speaker merged. |
| 4.2 | Tick an action item, reload. | Tick appears instantly and persists after reload; counter “1 of N done”. |
| 4.3 | Press play on the audio. | The segment being spoken is highlighted and scrolls into view. |
| 4.4 | Click a later transcript segment. | Audio jumps to that timestamp and plays; that segment is highlighted. |
| 4.5 | Click the pencil, change the title, press Enter; then again and press Escape. | Enter saves (persists after reload); Escape cancels. |
| 4.6 | **Copy summary as Markdown**, paste into a text editor. | Title, date line, summary, `- [ ]` action items, decisions. Button briefly says “Copied”. |
| 4.7 | **Delete** → Cancel, then Delete → **Delete meeting**. | An in-page dialog (not a browser popup). Cancel keeps it; confirming returns to the list without the meeting. |
| 4.8 | Open a meeting that is processing. | Yellow banner with a head and a line for the current stage, pipeline steps; updates every few seconds without reloading, then shows the summary. |
| 4.9 | A failed meeting (e.g. upload a file of silence or ask the API team to force a failure). | Red “Processing failed” with the server’s message; **Reprocess** starts it again and the processing banner returns. |
| 4.10 | Open `/meetings/00000000-0000-4000-8000-000000000000`. | “This meeting isn’t here” with a link back. |
| 4.12 | Record a call where people use each other's names (“Thanks, Priya”, “Tom, can you…”). | Speakers show as Priya and Tom, not Speaker 1/2; someone only mentioned (“ask Sam”) is not given to anyone; your side shows your first name (Settings → Your name). Action item owners use the names. |
| 4.13 | **Rename speakers** → change one name → **Save names**; then Reprocess. | Chips, transcript and action item owners update at once; the name you typed survives the reprocess. Clicking a speaker or topic chip opens the filtered list. |
| 4.11 | Phone width. | Sections stack; transcript below the summary; no overflow. |

### 4b. Tasks `/tasks`

| # | Steps | Expected |
|---|---|---|
| 4b.1 | Open **Tasks** from the top bar. | Sections Overdue / Today / Tomorrow / This week / Later / No date, only the non-empty ones. Each task: owner chip, a due label (late ones in red), and “from *meeting* · date”. A new account shows the demo meeting's tasks, due in the next few days. |
| 4b.2 | Tick a task. | It is ticked at once and, after a moment, leaves the open list; **Show done tasks** lists it. Untick it there: it comes back. The meeting page shows the same state. |
| 4b.3 | Click an owner chip, then **Everyone**. | Only that person's tasks, then all again. |
| 4b.4 | Click the meeting link of a task. | The meeting opens scrolled to that action item, which flashes yellow. |
| 4b.5 | Record a meeting where someone says “I'll send it by Friday”. | Its task shows “Due Fri, …” for the Friday after the meeting, and sorts by that date. |

### 4d. Meeting bots (Recall.ai, when configured)

| # | Steps | Expected |
|---|---|---|
| 4d.1 | **New recording** → **Send a notetaker to a call**, paste a non-meeting link. | “Paste a Zoom, Google Meet, Microsoft Teams or Webex link.”; the button stays disabled. |
| 4d.2 | Paste a Google Meet link of a call you're in, **Send the notetaker**. | The meeting page opens: “The notetaker is joining the call…”. “BoringTalks Notetaker” asks to join the call; let it in. The banner goes through waiting room → recording. |
| 4d.3 | Talk for a minute with a second person, then **Make it leave** (or end the call). | The bot leaves; “The transcript arrives in a few minutes”. Within ~10 minutes the meeting is summarized; speakers carry the names shown in the call; audio plays. |
| 4d.4 | Send a bot to a meeting nobody admits it to. | After the waiting-room timeout the meeting fails with “Nobody let the bot in from the waiting room.” |
| 4d.5 | Schedule a bot (Join at, 15 minutes from now), then **Cancel the notetaker**. | Banner shows the time; cancelling stops it from joining. |

### 4c. Calendar `/calendar`

| # | Steps | Expected |
|---|---|---|
| 4c.1 | Open **Calendar**. | Cards for this week, this month, an average week and the busiest day; a year heatmap with darker days for more meeting time; this month's grid; “Pick a day to see its meetings.” |
| 4c.2 | Hover a heatmap day; click one with meetings. | Tooltip “Tue, Oct 6: 2 meetings, 1 h 30 min”; the month view jumps to that month with the day selected, and its meetings are listed on the right (or below on a phone). |
| 4c.3 | ‹ and › in the month view, then **Today**. | Other months load with their numbers; Today returns to this month and is disabled there. |
| 4c.4 | Record a meeting late in the evening, check its day. | It counts for the day it happened where you are, not in UTC. |
| 4c.5 | Phone width. | Cards two per row; the heatmap scrolls sideways and starts at the latest weeks; month cells show counts. |

### 5. Browser recorder and upload `/record`

| # | Steps | Expected |
|---|---|---|
| 5.1 | **Start recording**, allow the microphone, talk for ~20 s. | Timer counts, level meter moves, the head’s mouth moves when you talk. |
| 5.2 | **Stop**. | Player with your take, size, optional title, **Save and summarize** / **Discard**. |
| 5.3 | **Save and summarize**. | Progress bar (creating, uploading with %, handing over), then the meeting page with the processing banner; minutes later a summary written from what you said. |
| 5.4 | Block the microphone in the browser and press Start. | Plain explanation of how to allow it; nothing uploaded. |
| 5.5 | Chrome: tick **Also capture a tab**, pick a tab playing a video, tick “Share tab audio”. | Both your voice and the tab are in the recording. Choosing a window without audio explains to share a tab with audio. Stopping the share from the browser bar stops the recording. |
| 5.6 | Upload an `.m4a`/`.mp3` from a phone recording. | Title left empty (the summarizer names the meeting); progress bar; meeting page; later a summary. |
| 5.10 | Play a call or video through the **speakers** (no headphones) and record with the built-in mic. | The other side is in the recording: echo cancellation is only on when a tab is captured separately. |
| 5.11 | Record 20 s of silence and save. | The meeting fails with “No speech was found” instead of a made-up “Thanks for watching” transcript. |
| 5.9 | With a Bluetooth headset connected, record once, then reload `/record`. | A **Microphone** menu lists the headset and the built-in mic; recording with the other one works and the choice survives a reload. |
| 5.7 | Choose a `.pdf` or a file over 200 MB. | Clear message, Upload button disabled, nothing sent. |
| 5.8 | Turn the network off during an upload (DevTools → Offline). | Error with **Try again**; the recording is not lost. |

### 6. Connect the Mac app `/connect`

| # | Steps | Expected |
|---|---|---|
| 6.1 | In the Mac app choose Sign in while signed out on the web. | Browser opens `/connect?challenge=…&device=<Mac name>`, redirects to sign in; after signing in you’re back on the connect page. |
| 6.2 | **Connect this Mac**. | Browser offers to open BoringTalks; the app shows it’s signed in. The page says “You can go back to the app.” with **Open BoringTalks** and the code. The new Mac appears in Settings → Connected Macs. |
| 6.3 | Repeat, but use the app’s paste-code field with the shown code. | Works once; the code expires after the shown number of minutes. |
| 6.4 | Click **Not now** instead. | The app receives `error=access_denied` and stays signed out; the page says “Okay, not connected.” |
| 6.5 | Open `/connect` without `challenge`, or with `challenge=abc`. | “This connect link doesn’t work” with what to do; no API call. |

### 7. Settings `/settings`

| # | Steps | Expected |
|---|---|---|
| 7.1 | Open Settings. | Email and sign-in method; email switch reflects the account; connected Macs list; Mac app version with **Download**. |
| 7.2 | Toggle “Email me when a meeting is ready” off and record a meeting; toggle on and record another. | No email for the first, a “Your meeting is ready” email for the second. Switch state persists after reload. |
| 7.3 | **Disconnect** a Mac → confirm. | Dialog names the Mac; after confirming it disappears from the list and the Mac app can no longer upload (it asks to sign in again). |
| 7.5 | Type a name in **Your name** and Save. | Button says Saved; in the demo and other past meetings “You” becomes your first name (unless you renamed that speaker by hand); new meetings use it too. |
| 7.4 | **Sign out**. | Lands on `/`; dashboard URLs now redirect to sign in. |

### 8. Errors

| # | Steps | Expected |
|---|---|---|
| 8.1 | Open `/no-such-page`. | 404 with a confused head looking around and links home / to meetings. |
| 8.2 | With the API down (or DevTools blocking `api.*`), open `/meetings`. | Inline error with **Try again**, no blank page. |
| 8.3 | Sign in as user A, copy a meeting URL, sign in as user B, open it. | “This meeting isn’t here”. Nothing from A is visible. |

### 9. Smoke after a deploy

`BASE_URL=https://dev.boringtalks.lol API_URL=https://api.dev.boringtalks.lol pnpm --filter @boringtalks/e2e test:smoke`:
landing renders with no console errors, `/signin` renders, `${API_URL}/health` is
OK, `/downloads/latest` is a DMG or 404.

## BoringTalks for Mac — manual QA

Run on a Mac with macOS 26. For a clean first launch, reset the permissions and state first:

```sh
tccutil reset Microphone games.cutthecheese.boringtalks
tccutil reset AudioCapture games.cutthecheese.boringtalks
defaults delete games.cutthecheese.boringtalks
rm -rf ~/Library/Application\ Support/BoringTalks   # keeps the shared Parakeet model in …/FluidAudio
```

Against dev: `defaults write games.cutthecheese.boringtalks apiURL https://api.dev.boringtalks.lol`
and `webURL https://dev.boringtalks.lol`. Watch the logs while testing:
`log stream --predicate 'subsystem == "games.cutthecheese.boringtalks"'`.

### 1. DMG install and Gatekeeper

| Step | Expected |
|---|---|
| Download https://download.boringtalks.lol/BoringTalks-latest.dmg (or the landing page button), open it | A window with BoringTalks.app and an Applications shortcut; volume name "BoringTalks" |
| Drag the app to Applications, eject, open it from Applications | **Notarized build:** opens after the usual "downloaded from the Internet" confirmation. **Ad-hoc build:** "cannot be opened" — right-click → Open → Open works |
| `spctl -a -vv /Applications/BoringTalks.app` | Notarized: `accepted, source=Notarized Developer ID` |
| Look at the menu bar | The BoringTalks icon (two speech bubbles); no Dock icon |

### 2. First launch and permissions

| Step | Expected |
|---|---|
| Click the menu-bar icon | Window: "Sign in to send your meetings…", **Sign in with browser**, **Paste code** |
| Open Settings… | "Speech model": a progress bar "Downloading the speech model… n %", then "Preparing…", then "Ready · Parakeet v3 + voice separation" (first time: a few minutes) |
| Sign in (section 3), press **Start meeting** | macOS asks for **Microphone**, then **System Audio Recording**. Allow both |
| Speak, and play any video | Both meters move: **You** with your voice, **Others** with the video |
| Repeat with System Audio Recording denied | Recording still starts; an orange warning explains how to allow it in Privacy & Security; only "You" is transcribed |
| Deny both | Start fails with "Couldn't record: …" |

### 3. Sign in with the browser

| Step | Expected |
|---|---|
| **Sign in with browser** | The browser opens `…/connect?challenge=…&device=<your Mac's name>`; the menu shows "Finish signing in in your browser…" |
| Sign in on the page and approve the Mac | The browser offers to open BoringTalks; accept. The menu now shows your email, **Start meeting** and "Recent meetings" |
| Dashboard → Settings → Devices | This Mac is listed |
| Quit and relaunch the app | Still signed in (token in the Keychain: Keychain Access → "BoringTalks device sign-in") |
| **Paste code** fallback: start a sign-in, copy the code (or the `boringtalks://` link) shown by the dashboard, paste, **Connect** | Signed in the same way |
| Paste garbage (`two words`) | "That doesn't look like a sign-in code." |

### 4. Record a two-voice meeting (YouTube + you)

| Step | Expected |
|---|---|
| Type a title (optional), **Start meeting** | The button turns red "Stop" with a running timer; the menu-bar icon becomes a record dot |
| **Show live transcript** | A floating window with two heads (Others, You) stays above other apps |
| Play a YouTube interview/podcast with two people for ~2 minutes, and say a few sentences into the mic in between (headphones recommended) | Lines appear with labels **Speaker 1**, **Speaker 2** for the video's voices and **You** for yours; grey text while a phrase is spoken; the heads' mouths move with the audio |
| With a Bluetooth headset connected (music sounding normal), **Start meeting** | The headset keeps its normal sound: “You” is recorded with the Mac's microphone (the menu shows “You · MacBook … Microphone”), so macOS doesn't switch the headset to call quality. Turning off Settings › **Keep Bluetooth headsets in high quality** records with the headset mic instead (and the sound drops to call quality) |
| With a Bluetooth headset as output (hands-free mode, 16 kHz), play the video | Words come out as clearly as through speakers. `BoringTalks --listen-test 6` prints the tap and device rates and the frames received per second (≈ the device rate) |
| Without headphones, let the video play through the speakers | The video's words are not duplicated as "You" in the uploaded transcript (echo removal); the live window may briefly show them |
| **Stop** | "Finishing transcript…", then the queue shows "Uploading…" and the meeting appears in Recent meetings as **Summarizing**, then **Ready** |
| Click the meeting | The dashboard opens `…/meetings/<id>`: a meaningful title, summary, action items, the transcript with You / Speaker 1 / Speaker 2 and timestamps that match the audio player |
| Settings → turn **Upload meeting audio** off, record another short meeting | The dashboard has the transcript but no audio player |
| Record while Settings shows the model still downloading (fresh install), Stop after 1 minute | If the model became ready in time: normal transcript. If not: the meeting still uploads (with audio) and the server transcribes it |

### 5. Offline upload, then reconnect

| Step | Expected |
|---|---|
| Record a short meeting, turn Wi-Fi off, press **Stop** | The menu shows "1 upload waiting — offline" |
| Record and stop a second meeting while offline | "2 uploads waiting — offline" |
| Turn Wi-Fi back on | Within a few seconds both upload (no need to click Retry); both appear in Recent meetings |
| Block the API host (e.g. `--api-url https://127.0.0.1:9`) and stop a meeting | "1 upload waiting — will retry"; the log shows retries after 5 s, 10 s, 20 s…; **Retry** tries at once |

### 6. Relaunch in the middle of an upload

| Step | Expected |
|---|---|
| Record a long meeting (10+ min, audio upload on) on a slow connection (Network Link Conditioner "3G"), **Stop**, and quit the app while it says "Uploading…" | `~/Library/Application Support/BoringTalks/uploads.json` lists the meeting with its `step` and `remoteID` |
| Relaunch | The upload continues from that step (the log shows no second "created meeting"); the dashboard has a single meeting, not two |
| Quit while **recording** | The meeting is stopped and queued; after relaunch it uploads |

### 7. Sign out

| Step | Expected |
|---|---|
| Settings → **Sign out** | The menu returns to "Sign in with browser"; Recent meetings disappear; the Keychain item is gone |
| Sign in again, revoke this Mac on the dashboard's Devices page, then press refresh (↻) in Recent meetings, or stop a meeting | The app signs itself out with "This Mac was signed out…"; waiting uploads pause ("sign in again") and resume after signing in |

### 8. Recordings on disk

| Step | Expected |
|---|---|
| Settings → **Show recordings in Finder** | `Recordings/<uuid>.m4a`, about 14 MB per hour, playable in QuickTime with both sides audible |
| Set **Keep recordings** to "Delete after upload", record and stop | The file disappears once the upload finishes |
| With "7 days", files older than a week are removed at launch | Files still waiting to upload are kept |

### 9. Command line (also used by CI)

```sh
say -v Samantha -o /tmp/a.wav --data-format=LEI16@16000 "Can you send the draft to legal by Thursday?"
say -v Daniel   -o /tmp/b.wav --data-format=LEI16@16000 "Yes, I will send it on Wednesday afternoon."
# join with a short pause (see apps/macos/README.md), then:
BoringTalks.app/Contents/MacOS/BoringTalks --transcribe /tmp/meeting.wav --speakers
```

Expected: JSON with `segments` alternating `Speaker 1` / `Speaker 2`, times in ms that match
the audio, `language: "en"`, exit code 0.

## Manual QA: backend and end-to-end

Run against dev (`https://dev.boringtalks.lol`, `https://api.dev.boringtalks.lol`) after each
deploy, and against production after a merge.

### 1. Health
1. Open `https://api.dev.boringtalks.lol/health`.
   **Expected:** `{"status":"ok", …}` with the commit SHA of the deployed PR head.

### 2. First sign-in creates the account
1. Sign up with a new email on the dashboard.
   **Expected:** the meetings list shows one ready demo meeting with a specific title. A welcome
   email arrives (dev: only for allow-listed addresses; others appear in the worker log).

### 3. Mac recording end to end
1. Record a 2–3 minute call with the Mac app (see the Mac section) and stop.
   **Expected:** within a minute the meeting moves recording → summarizing → ready; the title
   names what was discussed; action items have owners; the speakers are "You" and "Speaker 1…";
   the audio plays and highlights the transcript; a "meeting ready" email arrives.

### 4. Browser recording end to end (server transcription)
1. On `/record`, record 30 seconds of speech and save.
   **Expected:** transcribing → summarizing → ready; segments are labelled "Speaker 1".

### 5. Isolation
1. Copy a meeting URL, sign in as another user, open it.
   **Expected:** "not found", never the other user's data.

### 6. Failure and reprocess
1. Upload a silent audio file.
   **Expected:** the meeting ends `failed` with a readable reason; Reprocess is offered.

### 7. Delete
1. Delete a meeting with audio.
   **Expected:** it disappears from the list; its audio URL stops working.

### 8. Download
1. On the landing page, click Download for Mac.
   **Expected:** `BoringTalks-<version>.dmg` from `download.boringtalks.lol` (dev: `/dev/`), version
   and size match `GET /downloads/latest`.

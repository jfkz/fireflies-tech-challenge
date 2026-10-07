# Ideas: notice when a meeting starts (Mac app)

Not built. This is the other half of [Stop after silence](FEATURES.md#stop-after-silence): the Mac app
notices that a call has begun and offers to record it, so nobody has to remember to press Start.

## What tells us a call has started

Ordered by how much they're worth against what they cost (permissions, battery, false alarms).

1. **Another app opens the microphone.** Core Audio lists every process that uses audio
   (`kAudioHardwarePropertyProcessObjectList`), and for each one its bundle ID
   (`kAudioProcessPropertyBundleID`) and whether it is capturing input right now
   (`kAudioProcessPropertyIsRunningInput`, macOS 14+). It's the same API family the system-audio tap
   already uses, needs no extra permission, and property listeners make it event-driven rather than
   polled. "zoom.us started using the mic" is by far the strongest single signal.
   - Known meeting apps by bundle ID: Zoom (`us.zoom.xos`), Teams (`com.microsoft.teams2`), Webex,
     Slack (huddles), FaceTime, Discord, Around, Tuple…
   - Browsers (Chrome, Safari, Arc, Edge, Firefox) also open the mic for Meet / Teams / Zoom on the web.
     On their own they're ambiguous (a voice note, a dictation site), so they need a second signal.
2. **The calendar.** EventKit (one Calendar permission) gives events starting about now that carry a
   video link (`meet.google.com`, `zoom.us/j`, `teams.microsoft.com`…). On its own it only says a meeting
   *should* start; combined with (1) it is near-certain, and it also brings a **title** and the
   **attendees**, which can pre-fill the meeting title and help name speakers.
3. **The browser tab.** The front tab's URL or title (via Apple Events, one Automation prompt per
   browser) turns "Chrome opened the mic" into "Chrome is on meet.google.com/abc-defg-hij". Optional:
   only used to settle the browser case from (1).
4. **Both sides talking.** Voices on the system audio and the mic for a while look like a call. It
   would mean keeping the mic open all day (orange indicator, battery, and it feels like spying), so
   **don't**: the signals above are enough.

## What to do when one fires

- **Ask, don't record silently.** Many places require everyone's consent to record; starting on our
  own is a legal and trust problem. A notification: "Zoom call started — Record it?" with **Record** /
  **Not now**, and the calendar title when there is one ("Weekly sync is starting — Record it?"). The
  menu-bar icon can pulse at the same time for people who have notifications off.
- **Settings › When a call starts:** Ask (default) / Record automatically / Do nothing, with per-app
  exceptions ("always record Zoom", "never ask for Slack huddles"). "Record automatically" still shows a
  notification with **Stop** so it's never invisible.
- **Debounce.** Wait ~5–10 s of continuous mic use before asking, so a Slack voice clip, dictation or
  Siri doesn't trigger it. Ignore our own process and Apple's speech/dictation services.
- **Ask once per call.** "Not now" stays quiet until that app releases the mic again.
- **Already recording?** Do nothing.

## The same signals make Stop better

When the app that started the call releases the mic (Zoom closes the meeting window), the call is over
for certain. Then the recording can stop after ~30 s instead of waiting out the 5 minutes of silence,
with silence as the fallback for calls we couldn't attribute (an in-person meeting has no app at all).

## Shape of the code

- `BoringTalksKit/MeetingSignals.swift`: pure logic. Input is a timeline of events (`micStarted(app)`,
  `micStopped(app)`, `calendarEvent(title, start, end, link)`, `tab(url)`); output is
  `.offerToRecord(app:, title:)` / `.callEnded(app:)` / nothing. Debounce, allow-list and "asked once"
  live here, so they're unit-tested with synthetic timelines the way `SilenceWatch` is.
- `BoringTalks/Recording/MeetingDetector.swift`: Core Audio property listeners on the process list
  (and on each meeting app's `IsRunningInput`), plus EventKit queries for the next hour. Feeds
  `MeetingSignals`.
- `AppModel` turns the verdicts into the notification (the `Notifier` from Stop after silence gets a
  "call-started" category with Record / Not now) or an automatic start.

## Server-side alternative

For calls on a calendar, the Recall.ai notetaker (draft PR #10) could join on its own at the event's
start time: no Mac needed, but a visible bot in the call. The Mac detection above covers the
"no bot, nobody wants a bot" case the product is built around.

## Open questions

- Calendar access: EventKit on the Mac (local, one prompt) or Google/Microsoft calendar on the server
  (works for the bot too, but OAuth and more data on our side)?
- Is "Record automatically" worth offering at all, given the consent question?
- Should a call that was offered and declined still be listed somewhere ("Zoom call at 14:00, not
  recorded")?

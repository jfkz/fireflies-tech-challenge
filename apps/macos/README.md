# BoringTalks for Mac

A menu-bar app that records a meeting, transcribes it **on the Mac, for free**, tells the
voices apart and sends the transcript (plus, optionally, the compressed audio) to the
BoringTalks API, which writes the title, summary and action items.

- **Microphone = "You"**, **what the Mac plays = everyone else** (Zoom, Meet, Teams, a
  YouTube video…), captured with a Core Audio process tap — no virtual audio driver.
- Speech → text with **Parakeet TDT 0.6B v3** on the Neural Engine (FluidAudio). The other
  people are split into **Speaker 1…N** with WeSpeaker voice embeddings and SpeakerKit
  (pyannote) turn detection. No audio is sent to any speech service.
- Uploads go through a persistent queue that survives going offline and relaunching.

The speech and voice code comes from the author's earlier live-transcription app,
trimmed to what a meeting recorder needs.

## Requirements

- macOS 26 (Tahoe), Apple silicon or Intel (universal build). The speech model runs on
  the Neural Engine; on Intel it falls back to the CPU/GPU and is slower.
- To build: Xcode 26, [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).
- First launch downloads the speech model (~630 MB, into
  `~/Library/Application Support/FluidAudio`) and the voice models (~45 MB, into
  `~/Library/Application Support/BoringTalks/models`).

## Build and run

```sh
cd apps/macos
xcodegen generate                    # BoringTalks.xcodeproj is generated, not committed
xcodebuild -project BoringTalks.xcodeproj -scheme BoringTalks -configuration Debug \
  -derivedDataPath build/DerivedData build
open build/DerivedData/Build/Products/Debug/BoringTalks.app
```

`project.yml` signs with the **Apple Development** certificate
(`BT_SIGN_IDENTITY`, default "Apple Development: Mikhail Pershin (56V7M7YU28)") so the
microphone and system-audio permissions survive rebuilds — an ad-hoc signature changes
with every build and macOS asks again. Without that certificate add `BT_SIGN_IDENTITY=-`.

| Script | What it does |
|---|---|
| `scripts/test.sh` | builds the app (Debug) and runs the unit tests; `SIGN_IDENTITY=-` for ad-hoc (CI) |
| `scripts/build.sh` | universal Release build (`ARCHS="arm64 x86_64"`); `FLAVOR=dev` for BoringTalks Dev; `SIGN_IDENTITY=-` for ad-hoc, `SIGN_IDENTITY="Developer ID Application: …"` for a release (adds `--timestamp`); `MARKETING_VERSION`, `BUILD_NUMBER` (→ `CURRENT_PROJECT_VERSION`), `KEYCHAIN` optional. Leaves the app in `build/Release/<name>.app`. |
| `scripts/make-dmg.sh <app> <out.dmg>` | UDZO DMG named after the app, app + `/Applications` link; signs the DMG when `SIGN_IDENTITY` is a Developer ID |
| `scripts/notarize.sh <dmg>` | `notarytool submit --wait` with an App Store Connect API key (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` or `ASC_KEY_P8`), then `stapler staple`. Exit 0 = notarized, 1 = rejected (prints the log), 2 = skipped because the key isn't set. |
| `scripts/publish.sh <dmg> <version> <build> <true\|false> [dev/]` | uploads `<DMG_NAME>-<version>.dmg`, `<DMG_NAME>-latest.dmg` (`DMG_NAME` default `BoringTalks`) and `latest.json` (shared `LatestDownload` shape) to R2 with `aws s3 cp --endpoint-url $R2_ENDPOINT`; env `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_DOWNLOADS_BUCKET` (`boringtalks`), `DOWNLOADS_BASE_URL`, optional `R2_DOWNLOADS_KEY_PREFIX` (default `downloads/`) |

A release, from your Mac (CI only builds and tests):

```sh
scripts/release.sh prod          # Developer ID build + DMG, notarization submitted, published to R2
scripts/release.sh staple prod   # once `notarytool info <id>` says Accepted: staple and republish as notarized
WAIT=1 scripts/release.sh prod   # or wait for Apple in one go
WAIT=1 scripts/release.sh dev    # BoringTalks Dev → download.boringtalks.lol/dev/BoringTalks-Dev-latest.dmg
NO_PUBLISH=1 scripts/release.sh dev   # signed build and DMG only, to try locally
```

After building, `release.sh` embeds the app's **Developer ID provisioning profile**
(`.local/secrets/apple/BoringTalks.provisionprofile` / `BoringTalksDev.provisionprofile`, profile type
`MAC_APP_DIRECT`, made with the App Store Connect API for bundle IDs `games.cutthecheese.boringtalks`
and `….dev`) and re-signs the app with `Signing/Distribution.entitlements`: the application identifier
and Keychain access group the profile grants. That is what lets the app use the data protection
Keychain (see Signing in). It then runs the app with `--keychain-check` and stops if the build would
still use the login keychain. The profiles expire with the certificate (2031); to make new ones, POST
`/v1/profiles` with the bundle ID's and the certificate's IDs.

**Version:** `MARKETING_VERSION` in `project.yml` keeps the same major.minor as the API and the web
app (`pnpm check:versions`, run in CI): a release that needs new server features bumps all three
minors together; a Mac-only fix bumps the patch.

`release.sh` imports the Developer ID certificate into a throwaway keychain for the build and
restores the keychain search list afterwards. Defaults read the certificate, its password and the
R2 keys from the repo's gitignored `.local/secrets/`, and the App Store Connect key from
`~/.appstoreconnect/private_keys/`; each can be overridden with env (see the script's header).

## Permissions

| Prompt | When | Why |
|---|---|---|
| **Microphone** | first **Start meeting** | your side of the call ("You") |
| **System Audio Recording** (Privacy & Security › Screen & System Audio Recording) | first **Start meeting** | the other people (what the Mac plays) |

Either can be refused: the meeting is then recorded from the other side only, and the
menu shows why. The app is **not sandboxed** (it ships as a Developer ID DMG, not through
the App Store); it runs with the **hardened runtime** for notarization, with the
`com.apple.security.device.audio-input` entitlement. Release builds also carry the application
identifier and Keychain access group from their provisioning profile.

## Signing in

**Sign in with browser** opens `https://boringtalks.lol/connect?challenge=…&device=<Mac name>`
(PKCE, S256: the app keeps a 32-byte random verifier, the browser only sees its SHA-256).
After you approve the Mac, the dashboard redirects to `boringtalks://callback?code=…`
(BoringTalks Dev adds `&app=dev` to the connect page and gets `boringtalks-dev://callback?code=…`); the
app sends `POST /devices/token {code, codeVerifier}` and stores the `btd_…` device token in
the Keychain (service = the app's bundle ID, one item per API host). Release builds use the
**data protection Keychain**: the item belongs to the app's access group, not to one code signature,
so updates never ask for Keychain access. Local and ad-hoc builds have no access group and fall back
to the login keychain, which does ask when a differently signed build made the item.
If the redirect doesn't reach the app, copy the code (or the whole `boringtalks://` link)
into **Paste code**. Every API call sends `Authorization: Bearer btd_…`; a 401 signs the app
out and pauses uploads until you sign in again. Devices can be revoked from the dashboard.

## Dev vs prod

Two apps from the same sources (`AppFlavor`, set by `BTFlavor` in Info.plist):

| | BoringTalks | BoringTalks Dev |
|---|---|---|
| Target / scheme | `BoringTalks` | `BoringTalksDev` |
| Bundle ID | `games.cutthecheese.boringtalks` | `games.cutthecheese.boringtalks.dev` |
| API / dashboard | `api.boringtalks.lol` / `boringtalks.lol` | `api.dev.boringtalks.lol` / `dev.boringtalks.lol` |
| Sign-in callback | `boringtalks://` | `boringtalks-dev://` |
| Data folder | `Application Support/BoringTalks` | `Application Support/BoringTalks Dev` |
| Download | `download.boringtalks.lol/BoringTalks-latest.dmg` | `download.boringtalks.lol/dev/BoringTalks-Dev-latest.dmg` |

They can run side by side. Either can be pointed at another API:

```sh
defaults write games.cutthecheese.boringtalks apiURL http://localhost:3001
defaults write games.cutthecheese.boringtalks webURL http://localhost:3000
# or per launch (wins over defaults):
open BoringTalks.app --args --api-url http://localhost:3001 --web-url http://localhost:3000
defaults delete games.cutthecheese.boringtalks apiURL   # back to the app's own environment
```

A non-production API shows its host as a yellow badge in the menu. Tokens are stored per
API host, so dev and prod sign-ins don't overwrite each other.

## Command-line flags

```sh
BIN=BoringTalks.app/Contents/MacOS/BoringTalks
$BIN --transcribe meeting.wav --speakers               # transcript JSON as it would be uploaded
$BIN --transcribe call.wav --speakers --mic me.wav     # two channels: "You" + Speaker 1…N
$BIN --transcribe talk.m4a --language de --realtime    # steer the alphabet; feed at real speed
$BIN --icon BoringTalks/Assets.xcassets/AppIcon.appiconset   # re-render the app icon
open BoringTalks.app --args --demo                     # live transcript window with sample lines
open BoringTalks.app --args --show-menu                # the menu-bar window as a normal panel (QA, screenshots)
open BoringTalks.app --args --report                   # opens Report a Problem
BT_TRACE=1 $BIN --transcribe meeting.wav --speakers    # how voices were told apart (stderr)
log stream --predicate 'subsystem == "games.cutthecheese.boringtalks"'
```

`--transcribe` prints `{"segments": [...], "durationSec": …, "language": …}` (the
`PUT /meetings/:id/transcript` body) to stdout and progress to stderr, and exits 1 when the
model can't load or the file can't be read. Debug builds also accept
`--debug-sign-in --debug-print-connect-url` (start a sign-in and print the connect URL
instead of opening a browser) and `--debug-sign-out`, for QA against a mock API, plus
`--simulate-hang <seconds>` (blocks the main thread, for the hang watchdog), `--write-report <file>`
(what Report a Problem would send, then quit) and `--snapshot-windows <folder> <seconds>` (the open
windows as PNGs, then quit; no screen-recording permission needed).

## How it works

```
mic ──► MicCapture ─┐                                  ┌─► PhraseTranscriber (no voices) ─► "You"
                    ├─► RecordingChannel (16 kHz, one ─┤
tap ──► SystemAudio ┘   clock, gaps → silence)         └─► PhraseTranscriber + VoiceRegistry ─► "Speaker n"
                              │
                              └─► RecordingWriter: both mixed → AAC 32 kbps mono .m4a
Stop ─► finish transcribers ─► SegmentAssembler ─► PendingMeeting ─► UploadQueue ─► API / R2
```

- **One clock.** Both channels count 16 kHz samples from the moment you press Start. A
  capture that starts late, drops out on a device change, or stalls is padded with silence
  (`ChannelTimeline`), so sample *n* is the same instant on both sides and in the mixed
  recording. Segment times are milliseconds from the start.
- **Phrases.** Parakeet isn't a streaming model, so each channel keeps the phrase being
  spoken, re-transcribes it as it grows (the grey preview in the live window) and
  finalizes it after a pause (0.6 s on system audio, 0.8 s on the mic) or 15 s of
  continuous speech. Only final phrases become segments.
- **Voices** (system audio only). While a phrase is spoken: a pitch jump of 6+ semitones,
  or a WeSpeaker embedding of the last 1.5 s that drifts away from the start of the phrase,
  cuts it where another person took over. When it ends, SpeakerKit splits it into turns,
  and each turn's embedding is matched against the voices heard so far (cosine distance
  < 0.61 = same person and the voice learns from it, > 0.74 = a new person). For a meeting
  voices are never forgotten, so "Speaker 2" stays Speaker 2 for the whole meeting (up to
  10 voices). Speaker numbers follow the order people first spoke.
- **Echo.** Without headphones the mic hears the call too. A mic phrase that overlaps a
  system phrase (±1.5 s) and repeats ≥ 60 % of its words is dropped as echo.
- **Recording before the model is ready.** You can press Start while the speech model is
  still downloading: audio is recorded and waits in memory (up to 20 minutes per side) and
  is transcribed as soon as the model is ready. If the model still isn't ready when you
  press Stop (or the backlog overflowed), the meeting is uploaded **without** a transcript
  and **with** its audio, whatever the audio setting, and the server's fallback
  transcription takes over.
- **Upload queue** (`~/Library/Application Support/BoringTalks/uploads.json`):
  `POST /meetings` (with `Idempotency-Key`) → `POST /meetings/:id/upload-url` + `PUT` to
  the presigned R2 URL (no bearer token on that request) → `PUT /meetings/:id/transcript`
  → `POST /meetings/:id/complete`. Progress is saved after every step, so a relaunch
  resumes at the step that was interrupted. Network/5xx/429 errors retry with backoff
  (5 s, 10 s, 20 s… up to 15 min); coming back online (NWPathMonitor) retries at once; 401
  pauses until you sign in again; 404 (deleted on the server) drops the meeting; 409 on
  complete counts as done; other 4xx mark it failed with Retry / Discard in the menu.
- **Local files.** Recordings live in `~/Library/Application Support/BoringTalks/Recordings/<uuid>.m4a`
  (~14 MB per hour) and are kept for 7 days after uploading (setting: delete at once, 1, 7
  or 30 days); a recording still waiting to upload is never deleted.

### Accuracy

From the app this code comes from (a benchmark on 40
LibriSpeech speakers): a single 1–5 s phrase is attributed to the wrong person **3.2 %**
of the time (22 % with the pyannote embeddings used before WeSpeaker); in simulated
conversations of 2–4 people **3.4 %** of phrases went to the wrong speaker; with 3 people
talking back to back (30 turns, 0.15 s apart) every finished phrase landed on the right
speaker. Parakeet transcribed 120 s of a podcast in 3.9 s on an M1.

Measured here, on an M1 with the models cached: a 29.6 s two-voice clip (macOS voices
Samantha and Daniel, six turns 0.7 s apart) came out as 6 segments, each turn on its own
and attributed to the right speaker, with times within 0.3 s of the real turns, in about
3 s. Adding a third voice as the microphone file gave a 7th segment, "You", in the right
place. Fed at real-time speed (`--realtime`, the live path with previews and pitch/voice
cuts) the result was the same.

## Code map

| | |
|---|---|
| `BoringTalksKit/` | pure logic, unit-tested: `APIClient` + Codable mirrors of `packages/shared`, `PKCE`, `DeviceLink`/`DeviceAuthenticator`, `KeychainStore`, `UploadQueue`/`PendingMeeting`, `SegmentAssembler`/`SpeakerLabeler`, `ChannelTimeline`/`AudioMixer`, `RecordingJanitor`, `AppConfig`, `ProblemReport`, `HangWatch`, `Deadline`/`BlockingQueue` |
| `BoringTalks/Speech/` | shared speech code: `AudioCapture` (process tap, mic), `ParakeetEngine`, `PhraseTranscriber` (now with phrase times), `VoiceAnalysis` (`VoiceRegistry`, `VoiceIdentifier`, `VoiceEmbedder`), `VoiceTraits`, `LevelMeter`; plus `SpeechModels` (download/progress) |
| `BoringTalks/Recording/` | `MeetingRecorder`, `RecordingChannel`, `RecordingWriter` (AAC), `LiveTranscript`, `FileTranscriber` (`--transcribe`) |
| `BoringTalks/UI/`, `Avatar/`, `App/` | menu-bar window, settings, live transcript panel, Report a Problem window, the cartoon head and the icon, `AppModel`, `ProblemReporter` |
| `BoringTalksTests/` | XCTest: PKCE (RFC 7636 vector), callback parsing, sign-in, Keychain, API encoding/decoding against JSON fixtures, upload queue state machine with a `URLProtocol` stub, segment assembly, timeline, mixer, janitor |

See also [docs/FEATURES.md](../../docs/FEATURES.md) and
[docs/QA.md](../../docs/QA.md).

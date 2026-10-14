# BoringTalks for Windows

A system-tray app that records a meeting, transcribes it **on the PC, for free**, tells the
voices apart and sends the transcript (plus, optionally, the compressed audio) to the
BoringTalks API, which writes the title, summary and action items. It does what
[the Mac app](../macos/README.md) does, the Windows way.

- **Microphone = "You"**, **what the PC plays = everyone else** (Zoom, Meet, Teams, a
  YouTube video…), captured with Windows' process loopback: everything the PC plays except
  BoringTalks itself, whichever speakers or headset the call uses. No virtual audio driver.
- Speech → text with **Parakeet TDT 0.6B v3** (int8) through
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) on the CPU. The other people are split
  into **Speaker 1…N** with **TitaNet-small** voice embeddings and pyannote segmentation.
  No audio is sent to any speech service.
- Uploads go through a persistent queue that survives going offline and relaunching.
- It offers to record when a call app starts using the microphone, stops after silence or
  when the call ends, and shows a live transcript with two talking heads.

## Requirements

- Windows 10 version 2004 (build 19041) or later, or Windows 11; x64 (ARM64 PCs run it
  under emulation).
- To build: the .NET 10 SDK (`global.json`). Nothing else: the installer tool (Velopack's
  `vpk`) is a local dotnet tool.
- First launch downloads the models into `%LOCALAPPDATA%\BoringTalks-Models` (~717 MB:
  Parakeet 670 MB, pyannote 6 MB, TitaNet 40 MB), from `download.boringtalks.lol/models/` or
  else Hugging Face / the sherpa-onnx releases, each file checked against its size and SHA-256
  (`ModelCatalog`).

## Build and run

```powershell
cd apps/windows
dotnet build                                            # BoringTalks.sln
dotnet run --project src/BoringTalks.App                # the tray app
dotnet test --project tests/BoringTalks.Core.Tests      # unit tests
```

| Script | What it does |
|---|---|
| `scripts/test.ps1` | unit tests with the coverage gate (BoringTalks.Core ≥ 80 % of lines; `-Threshold`), then a Release build of the app. What CI runs. |
| `scripts/build.ps1 [-Version 0.5.0] [-Build 42] [-Flavor release\|dev] [-SkipInstaller]` | self-contained Release build in `build\publish`, then Velopack's `vpk pack`: `build\BoringTalks-Setup.exe` (Dev: `BoringTalks-Dev-Setup.exe`; per-user installer, no admin rights) and `build\Releases\<flavor>\` (the update feed). `SIGN_PARAMS` (signtool arguments) signs both. |
| `scripts/publish.ps1 <exe> <version> <build> [-Signed $true] [-Prefix dev/] [-Name BoringTalks-Dev-Setup]` | uploads `<name>-<version>.exe`, `<name>-latest.exe` and `latest-windows.json` (shared `LatestDownload` shape, `platform: "windows"`) to R2 with `aws s3 cp --endpoint-url $R2_ENDPOINT`; same env as the Mac's `publish.sh` |
| `scripts/mirror-models.ps1` | copies the speech models (from a PC where the app has downloaded and checked them) to `download.boringtalks.lol/models/`, the first place the app downloads them from. Until then the app falls back to Hugging Face and the sherpa-onnx releases. |
| `scripts/release.ps1 prod\|dev` | `build.ps1` + `publish.ps1` with the version from `Directory.Build.props`, build number = minutes since 2026-01-01, R2 keys from the repo's gitignored `.local/secrets/r2` |

A release, from a PC (CI only builds and tests, and keeps each PR's unsigned installer as an
artifact for a week):

```powershell
winget install Amazon.AWSCLI    # once
scripts/release.ps1 dev         # BoringTalks Dev → download.boringtalks.lol/dev/BoringTalks-Dev-Setup-latest.exe
scripts/release.ps1 prod        # → download.boringtalks.lol/BoringTalks-Setup-latest.exe
```

The build is **not code-signed** yet: browsers say the file "isn't commonly downloaded" and
SmartScreen says "Windows protected your PC" (**More info → Run anyway**); the landing page
explains both while `latest-windows.json` says `"notarized": false`. Signing later (e.g. Azure
Trusted Signing) only needs `SIGN_PARAMS` (or Velopack's `--azureTrustedSignFile`).

## Installing, updating, uninstalling

`BoringTalks-Setup.exe` installs into `%LOCALAPPDATA%\BoringTalks` for the current user (no
admin prompt), adds Start menu and desktop shortcuts and starts the app. On every launch the app
registers, for this user only:

- the `boringtalks://` link (`HKCU\Software\Classes\boringtalks`), which the dashboard sends back after sign-in;
- **Open at sign-in** (`HKCU\...\Run\BoringTalks`, `--background`), on by default and switchable in Settings: call detection only works while the app runs.

Uninstalling (Settings › Apps) removes both, the notifications, and the models folder.
Meetings, recordings and settings stay in `%APPDATA%\BoringTalks`.

**Updates.** The installed app checks `https://download.boringtalks.lol/updates/windows/releases.win.json`
(BoringTalks Dev: `/dev/updates/windows/`) 30 s after launch and every 4 hours, downloads a newer
full package in the background (Velopack's `UpdateManager`), and installs it after the app exits:
**Restart to update** in the menu or Settings › Account (not offered while recording), or simply
the next quit. `publish.ps1 -Feed build\Releases\<flavor>` uploads the package first and then
`releases.win.json`. Velopack only moves to a higher version, so every `release.ps1` run
moves the patch up (`scripts/next-version.mjs`: one above what's live for that target) and writes
it to `Directory.Build.props`, which you then commit. The logic is
`BoringTalks.Core/Updates/AppUpdater.cs` (tested with a fake feed); the Velopack side is
`BoringTalks.App/Platform/VelopackFeed.cs`. A build run from `bin\` isn't installed and doesn't update.

## Permissions

Windows asks nothing up front. Recording "You" needs **Settings › Privacy & security ›
Microphone › Let desktop apps access your microphone** (on by default); when it's off the
menu says so and the meeting records the other side only. The call's sound needs no
permission. The app sees **which** app uses the microphone (for "Record this call?"), never
what it hears.

## Signing in

**Sign in with browser** opens `https://boringtalks.lol/connect?challenge=…&device=<PC name>`
(PKCE, S256: the app keeps a 32-byte random verifier, the browser only sees its SHA-256).
After you approve the PC, the dashboard redirects to `boringtalks://callback?code=…`; Windows
starts BoringTalks with that link, the new process hands it to the running one over a named
pipe and exits, and the app sends `POST /devices/token {code, codeVerifier}` and stores the
`btd_…` device token in **Windows Credential Manager** (`BoringTalks:device-token.<api host>`,
one per API host). If the link doesn't reach the app, copy the code (or the whole
`boringtalks://` link) into **Paste code**. Every API call sends `Authorization: Bearer btd_…`
and `User-Agent: BoringTalks-Windows/<version>`; a 401 signs the app out and pauses uploads
until you sign in again. Computers can be disconnected from the dashboard's Settings.

## Dev vs prod

BoringTalks talks to production (API `https://api.boringtalks.lol`, dashboard `https://boringtalks.lol`);
**BoringTalks Dev** (`build.ps1 -Flavor dev`, `release.ps1 dev`) to the dev environment, with its own
name, `boringtalks-dev://` sign-in link (`&app=dev` on the connect page), `%APPDATA%\BoringTalksDev`
data folder and Velopack package id `BoringTalksDev` (installed in `%LOCALAPPDATA%\BoringTalksDev`),
so the two install side by side and share `%LOCALAPPDATA%\BoringTalks-Models` (see
`BoringTalks.Core/AppFlavor.cs`). Either can be pointed elsewhere in its `settings.json`:

```json
{ "apiUrl": "https://api.dev.boringtalks.lol", "webUrl": "https://dev.boringtalks.lol" }
```

or per launch (wins over the file): `BoringTalks.exe --api-url http://localhost:3001 --web-url http://localhost:3000`.
A non-production API shows its host as a yellow badge in the menu. Tokens are stored per API
host, so dev and prod sign-ins don't overwrite each other.

## Command-line flags

```powershell
$bt = "$env:LOCALAPPDATA\BoringTalks\current\BoringTalks.exe"   # or build\publish\BoringTalks.exe
& $bt --transcribe meeting.wav --speakers               # transcript JSON as it would be uploaded
& $bt --transcribe call.wav --speakers --mic me.wav     # two channels: "You" + Speaker 1…N
& $bt --transcribe talk.m4a --language de --realtime    # language as metadata; feed at real speed
& $bt --listen-test 6                                   # what system audio arrives, from where, how loud
& $bt --mic-users 30                                    # which apps use a microphone (call detection's view)
& $bt --demo                                            # live transcript window with sample lines
& $bt --show-menu                                       # the tray menu as a normal window (QA, screenshots)
& $bt --report                                          # opens Report a Problem in the running app
& $bt --write-report C:\Temp\report.txt                 # what a report would send, written instead of sent
$env:BT_TRACE = 1; & $bt --transcribe meeting.wav --speakers   # how voices were told apart (stderr)
```

A two-voice test clip from Windows' own voices:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $p = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($l in @(@('Microsoft David Desktop', 'Can you all see my screen?'), @('Microsoft Zira Desktop', 'Yes, go ahead.'))) {
  $p.StartVoice($l[0]); $p.AppendText($l[1]); $p.AppendBreak([TimeSpan]::FromMilliseconds(700)); $p.EndVoice() }
$s.SetOutputToWaveFile("$PWD\two-voices.wav"); $s.Speak($p); $s.Dispose()
```

The tools print to the console they were started from (`> out.json` works). `--transcribe`
prints the `PUT /meetings/:id/transcript` body to stdout and progress to stderr, and exits 1
when the model can't load or the file can't be read. Debug builds also accept
`--debug-sign-in --debug-print-connect-url` (start a sign-in and log the connect URL instead of
opening a browser), `--debug-sign-out` and `--debug-record <seconds>`, for QA against a mock API;
sent to a running app (a second launch) they act on that one. Logs: `%APPDATA%\BoringTalks\logs`.

## How it works

```
mic ──────► MicCapture ──────┐                                     ┌─► PhraseTranscriber ─────────────► "You"
                             ├─► RecordingChannel (16 kHz, one ────┤
process  ─► SystemAudio ─────┘   clock, gaps → silence)            └─► PhraseTranscriber + VoiceRegistry ─► "Speaker n"
loopback      Capture                   │
                                        └─► RecordingWriter: both mixed → AAC 96 kbps mono .m4a (Media Foundation)
Stop ─► finish transcribers ─► SegmentAssembler ─► PendingMeeting ─► UploadQueue ─► API / R2
```

The logic is the Mac's, ported to `BoringTalks.Core` and unit-tested there; see the Mac
README for the details of phrases, voices, echo, the backlog before the model is ready, the
upload queue and auto-stop. What differs on Windows:

- **System audio.** `ProcessLoopback` activates `VAD\Process_Loopback` with
  `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE` for BoringTalks' own process and calls
  `IAudioClient`/`IAudioCaptureClient` through their vtables (.NET's COM wrappers can't hold
  that client). It delivers 48 kHz float and nothing while nothing plays, which the timeline
  fills with silence. Without process loopback (older Windows), it falls back to loopback on
  the default output device, reopened when the default changes.
- **Microphone.** The Communications default (what call apps use), opened by NAudio's WASAPI
  capture on its own thread. When it's a Bluetooth headset (`BTHENUM`/`BTHHFENUM` bus, or
  "Hands-Free" in the name) and **Keep Bluetooth headsets in high quality** is on, the PC's
  own microphone records "You" instead.
- **Voices.** TitaNet-small, recalibrated: same person < 0.55 cosine distance, a new person
  > 0.70 (the Mac's WeSpeaker model needs 0.61 / 0.74). On 367 clips of 1.2–5 s from 21
  LibriSpeech speakers, simulated meetings of 2–4 people put **0.9 %** of phrases on the wrong
  speaker (WeSpeaker ResNet34 through sherpa-onnx: 12 %; the Mac app: 3.4 %).
- **Speed.** Parakeet on 4 CPU threads transcribes at about 0.08× real time on a Ryzen 9
  5900HX; telling voices apart adds 1.5–4 s per finished phrase on the system channel, in the
  background.
- **Audio file.** Windows' AAC encoder takes 44.1/48 kHz and 96 kbps and up, so recordings are
  ~43 MB an hour (the Mac's are 14). Over the API's 200 MB (about 4.5 h) the audio is skipped
  and the transcript still uploads. Windows "N" editions without the Media Feature Pack can't
  encode AAC: those meetings upload their transcript only.
- **Call detection.** `MicUsageMonitor` reads Windows' microphone privacy records
  (`HKCU\...\CapabilityAccessManager\ConsentStore\microphone`: Store apps by package family,
  desktop apps under `NonPackaged` by path), woken by registry change notifications and re-read
  every 2 s. A record counts only when it started since boot and, for a desktop app, that
  executable is running: apps that crash mid-call leave records saying "in use" for good.
  `CallApps` knows Zoom, Teams (classic and new), Webex, Slack, Discord, WhatsApp, Telegram,
  Skype and the browsers (Chrome, Edge, Firefox, Brave, Opera, Vivaldi, Arc); more via
  `extraCallApps` (executable names) in `settings.json`.
- **Notifications.** Toasts with buttons (Record / Not now / Never for this app, Keep
  recording); the tray icon also shows a red dot while recording and a blue one while a call
  waits for an answer, so nothing depends on notifications being on.

Measured on this PC (Ryzen 9 5900HX, Windows 11): a 25.5 s two-voice clip (Windows voices David
and Zira, four turns) came out as the right text with the voices told apart in 9 s, cold start
included; recorded live from the speakers, it uploaded as six segments and a 37 s, 449 KB `.m4a`.

## Code map

| | |
|---|---|
| `src/BoringTalks.Core/` | pure logic, no Windows APIs, unit-tested: `ApiClient` + C# mirrors of `packages/shared`, `Pkce`, `DeviceLink`/`DeviceAuthenticator`, `UploadQueue`/`PendingMeeting`, `SegmentAssembler`, `ChannelTimeline`/`AudioMixer`/`Resampler`/`LevelMeter`, `SilenceWatch`, `CallSignals`/`CallEndWatch`/`CallApps`/`MicrophoneConsentStore`, `MicChoice`, `RecordingJanitor`, `AppConfig`/`AppFolders`/`Settings`, and the speech logic moved out of the Mac app target: `PhraseTranscriber`, `VoiceRegistry`, `VoiceTraits`, `Pitch`, `VoiceTurns`, `TextCleaner`, `LanguageGuess`, `LiveTranscript`, `ModelCatalog` |
| `src/BoringTalks.Speech/` | sherpa-onnx: `ParakeetEngine`, `VoiceAnalyzer` (pyannote + TitaNet), `ModelStore` (downloads), `SpeechModels` |
| `src/BoringTalks.App/` | the WPF tray app: `Audio/` (process loopback, mic, devices), `Recording/` (`MeetingRecorder`, `RecordingChannel`, `RecordingWriter`, `FileTranscriber`), `Platform/` (Credential Manager, registry, single instance, toasts, mic usage, logs), `ViewModels/`, `Views/` (menu, settings, live transcript, the cartoon head, tray icon), `CommandLineTools` |
| `tests/BoringTalks.Core.Tests/` | xUnit: the Mac's test suites ported (PKCE vector, callback parsing, sign-in, API encoding against the shared fixtures, upload queue state machine with a stub `HttpMessageHandler`, call signals, silence, segment assembly, timeline, mixer, janitor) plus resampler, voices, phrase transcriber, settings, models |

The API examples the tests decode are the shared contract fixtures in
[`packages/shared/fixtures`](../../packages/shared/fixtures), which `packages/shared` checks
against the zod schemas. See also [docs/FEATURES.md](../../docs/FEATURES.md) and
[docs/QA.md](../../docs/QA.md).

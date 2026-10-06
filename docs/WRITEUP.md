# BoringTalks: what I built and why

Submission for the "Clone the Fireflies.ai app" technical challenge.

- **Repository:** this repo
- **Working app:** https://boringtalks.lol (sign up; a demo meeting is waiting) · Mac app from the
  Download button
- **Brief requirements → where they are:**
  - Meeting recording → Mac menu-bar app (real capture of both sides of any call) and a browser
    recorder / file upload as a fallback
  - Transcription → on the Mac (Parakeet, speaker-labelled); Whisper on the server for browser audio
  - Summary & action items → server worker with Claude Haiku 4.5: title, description, summary, key
    topics, action items with owners and due dates, decisions
  - User interface → Next.js dashboard + Mac app; landing page with cartoon heads

## The idea

Fireflies sends a bot into your call and transcribes on its servers. That is the expensive part of
the product: every minute of audio costs money. I already had a Mac app of my own
that captures system audio and the microphone, transcribes live on the Neural Engine and tells
voices apart. So BoringTalks moves transcription to the user's Mac, where it is free, and keeps
the server for what really needs a server: describing the meeting, storing it, and showing it
everywhere.

Result: a meeting-hour costs about **$0.02** (one small LLM call) instead of $0.20–0.40 for
server-side speech-to-text. Numbers in [COSTS.md](COSTS.md).

## Key decisions

1. **Transcribe on the client, describe on the server.** The Mac uploads a transcript of a few KB
   plus optional 32 kbps audio for playback. The worker turns it into a title that says something
   ("Pricing review: Pro to $29, launch Nov 3"), never "Meeting".
2. **Speaker labels from the capture itself.** The microphone is "You"; voices in the system audio
   are separated with WeSpeaker embeddings (3 % confusion on 1–5 s phrases, measured in Talking
   Heads). Echo of the speakers in the mic is dropped.
3. **A queue between the API and the AI.** The API never waits for a model. BullMQ workers scale
   separately, retry with backoff, collapse duplicate jobs, and cap concurrency to the gateway's
   limits. With a crowded site a spike becomes a longer queue, not errors.
4. **Bytes skip the API.** Audio goes client ↔ R2 through presigned URLs; R2 has no egress fees.
5. **Firebase only where it helps.** The dashboard uses Firebase Auth; the API verifies tokens
   against Google's public keys (no service account). The Mac signs in through a PKCE browser link
   and gets its own revocable device token, so it needs no Firebase SDK and never sees a password.
6. **One contract.** `packages/shared` holds zod schemas used by the API (validation), the web app
   (response parsing) and the Mac app's test fixtures.
7. **Fallbacks for reviewers.** Without a Mac: record in the browser or upload a file, and the
   server transcribes with Whisper. Every new account gets a ready demo meeting.

## What's in the box

- **Mac app:** menu bar, Start/Stop, live transcript window with cartoon heads, offline-safe upload
  queue that resumes after relaunch, browser sign-in, model download progress, settings.
- **Backend:** NestJS API + worker, Postgres, Redis, R2, AI Gateway (Haiku 4.5, Whisper), Resend
  emails ("your meeting is ready" with the summary and action items), per-user rate limits,
  idempotent creates, full-text search, health checks.
- **Web:** funny parallax landing page with cartoon heads drawn in SVG, DMG
  download, sign-up/sign-in, meeting list with search, meeting page (summary, topics, action items,
  decisions, transcript synced to audio), browser recorder, Mac connect page, settings.
- **Engineering:** monorepo (pnpm + Turborepo), CI with coverage gates and e2e suites, deploys on
  every ready PR (dev) and on `main` (production), DMG built and published by CI.
- **Docs:** [ARCHITECTURE](ARCHITECTURE.md), [FEATURES](FEATURES.md), [QA flows](QA.md),
  [API](API.md), [DEPLOYMENT](DEPLOYMENT.md), [COSTS](COSTS.md).

## Testing

- Unit tests in every package with coverage gates in CI (API ≈ 99 %, web ≈ 95 %, shared ≈ 94 %
  lines); XCTest for the Mac app's logic (PKCE, upload queue state machine, transcript assembly).
- API e2e: the real API and worker against Postgres, Redis and MinIO: Mac flow, browser flow,
  device link, isolation between users, idempotency, deletion.
- Playwright: sign-up through the Firebase Auth emulator, meeting page, Mac connect, upload, settings,
  landing page at phone width with reduced motion; a smoke suite runs after every deploy.
- Manual flows in [QA.md](QA.md).

## Trade-offs and what I'd do next

- **macOS 26 only** (Core Audio process taps and the current speech stack). A Chrome extension could cover web meetings.
- **No live streaming to the server:** the transcript uploads when the meeting ends. Next: stream
  segments during long meetings so the summary is ready seconds after hanging up.
- **Server transcription has no diarization** (single "Speaker 1"); fine for the fallback.
- **Speaker names:** labels are "Speaker N". Next: let the user name a voice once and remember it.
- **Search** is Postgres full-text; semantic search over transcripts (embeddings) would be the next
  step, along with "ask your meetings" chat.
- **Teams and sharing** are out of scope.

## Tools

Built with Claude Code as a pair programmer, alongside the libraries listed in the
[README](../README.md#third-party-tools).

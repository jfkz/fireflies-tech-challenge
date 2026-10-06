# BoringTalks

**Your meeting, minus the meeting.** A simplified Fireflies.ai: a Mac app records your calls and
turns them into text on your Mac; the server writes a title that says what the meeting was about,
a summary, key topics, action items with owners, and decisions; a web dashboard shows it all.

- Web app: https://boringtalks.lol (dev: https://dev.boringtalks.lol)
- API: https://api.boringtalks.lol/health
- Mac app: https://download.boringtalks.lol/BoringTalks-latest.dmg (always the newest build; also the Download button on the landing page)
- Write-up for reviewers: [docs/WRITEUP.md](docs/WRITEUP.md)

New accounts get a ready demo meeting, so the dashboard shows the full result before you record
anything. Without a Mac, use **Record in the browser** (or upload an audio file) on `/record`.

## What's inside

| Path | What |
|---|---|
| [`apps/macos`](apps/macos) | Swift/SwiftUI menu-bar recorder. Captures the microphone ("You") and system audio (everyone else), transcribes on the Neural Engine with Parakeet, tells voices apart with WeSpeaker embeddings, uploads the transcript. Built on my own app Talking Heads. |
| [`apps/api`](apps/api) | NestJS 11 API + BullMQ worker: auth, meetings, presigned R2 uploads, summarization with Claude Haiku 4.5 via the Vercel AI Gateway, Whisper fallback transcription, Resend emails. |
| [`apps/web`](apps/web) | Next.js 16: a parallax landing page with the talking heads, and the dashboard (meetings, transcript synced to audio, action items, browser recorder, Mac sign-in). |
| [`packages/shared`](packages/shared) | zod schemas = the API contract, shared by API and web, mirrored by the Mac app. |
| [`e2e`](e2e) | Playwright: UI suite against the Firebase Auth emulator, smoke suite for deployed environments. |
| [`docs`](docs) | [Architecture](docs/ARCHITECTURE.md) · [Features](docs/FEATURES.md) · [QA flows](docs/QA.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [Costs](docs/COSTS.md) · [Agent options](docs/AGENT.md) |

## Run it locally

Requirements: Node 24 (22.12+), pnpm 10, Docker. For the Mac app: macOS 26, Xcode 26, XcodeGen.

```sh
pnpm install
docker compose up -d                          # Postgres :55433, Redis :6480, MinIO (R2 stand-in) :9100

# API + worker (http://localhost:4000)
cp apps/api/.env.example apps/api/.env        # works as is against docker-compose
pnpm --filter @boringtalks/shared build
pnpm --filter @boringtalks/api db:migrate:dev
pnpm --filter @boringtalks/api dev            # terminal 1
pnpm --filter @boringtalks/api dev:worker     # terminal 2

# Web (http://localhost:3000)
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @boringtalks/e2e emulators      # Firebase Auth emulator, terminal 3 (or use a real Firebase project)
pnpm --filter @boringtalks/web dev            # terminal 4

# Mac app (pointed at the local API)
cd apps/macos && xcodegen generate && open BoringTalks.xcodeproj
#   launch arguments: --api-url http://localhost:4000 --web-url http://localhost:3000
```

Summaries need `AI_GATEWAY_API_KEY` in `apps/api/.env` (a Vercel AI Gateway key); without it
meetings end as `failed` after retries. Emails are logged instead of sent without `RESEND_API_KEY`.

## Tests

```sh
pnpm turbo run lint typecheck test:cov build  # unit tests with coverage gates, all packages
pnpm --filter @boringtalks/api test:e2e       # API + worker against docker-compose
pnpm --filter @boringtalks/e2e test:e2e       # Playwright UI suite
cd apps/macos && SIGN_IDENTITY=- scripts/test.sh   # XCTest
```

| Package | Unit tests | Coverage (lines) | e2e |
|---|---|---|---|
| shared | 29 | 94 % | — |
| api | 148 | 99.7 % | 14 flows against real Postgres/Redis/MinIO |
| web | 165 | 94.8 % | 16 Playwright flows + 4 smoke checks |
| macos | 66 | — | `--transcribe` CLI on recorded audio |

## Deploys

A ready pull request deploys to **dev**, a push to `main` to **production** (GitHub Actions →
Railway for API/worker, Vercel for web, R2 for the DMG). One open PR at a time. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Third-party tools

| Tool | Used for |
|---|---|
| NestJS, Drizzle ORM, BullMQ, ioredis, pino | API and worker |
| Next.js, React, Tailwind CSS, Motion, TanStack Query | Web |
| Firebase Authentication | Sign-up / sign-in (email + Google) |
| Vercel AI SDK + AI Gateway (Claude Haiku 4.5, Whisper) | Summaries, fallback transcription |
| FluidAudio (Parakeet TDT v3, WeSpeaker), SpeakerKit | On-device transcription and voice separation on the Mac |
| Cloudflare R2 (+ AWS SDK v3) | Audio, transcripts, summaries, DMGs |
| Resend + React Email | Emails |
| Railway, Vercel, Cloudflare DNS | Hosting |
| zod | Validation and the shared contract |
| Vitest, Testing Library, Playwright, PGlite, XCTest | Tests |
| Claude Code | Pair-programming the whole project |

## Assumptions

- "Meeting recording" means a real recording on the Mac (any call app, no bot joins the call);
  the browser recorder covers reviewers without a Mac.
- Speaker names aren't known: the Mac labels "You" and "Speaker 1…N"; server-side transcriptions
  are a single "Speaker 1".
- The Mac app needs macOS 26 (Core Audio process taps, current speech models).
- One user per account; no sharing or teams.

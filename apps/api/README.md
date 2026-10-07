# @boringtalks/api

NestJS 11 backend for BoringTalks: the HTTP API and the background worker, built from one codebase
into one Docker image. Endpoint reference: [`docs/API.md`](../../docs/API.md).

## Run locally

Needs Node 22.12+ (24 recommended, see `.nvmrc`), pnpm 10 and Docker.

```sh
docker compose up -d                       # repo root: Postgres :55433, Redis :6480, MinIO :9100 (console :9101)
pnpm install
pnpm --filter @boringtalks/shared build
cd apps/api
cp .env.example .env                       # works as is against docker-compose
pnpm db:migrate:dev
pnpm dev                                   # API on http://localhost:4000 (watch mode)
pnpm dev:worker                            # worker, in a second terminal
curl localhost:4000/health
```

With `FIREBASE_AUTH_EMULATOR_HOST` set (the default `.env` does), the API accepts unsigned emulator
tokens, so you can call it without a Firebase project:

```sh
TOKEN=$(node -e 'const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url"),n=Date.now()/1e3|0;
console.log(b({alg:"none"})+"."+b({iss:"https://securetoken.google.com/boringtalks",aud:"boringtalks",sub:"me",email:"me@example.com",iat:n,exp:n+3600})+".")')
curl -H "Authorization: Bearer $TOKEN" localhost:4000/meetings
```

Without `AI_GATEWAY_API_KEY` the worker cannot summarize (jobs retry, then the meeting shows
`failed`); without `RESEND_API_KEY` emails are written to the log instead of being sent.

MinIO stands in for R2. The Docker Hub `minio/minio` image is no longer published, so compose uses
Chainguard's build of the same server; a one-shot `minio-setup` container creates the
`boringtalks` (keys under `R2_KEY_PREFIX`, `dev/` locally) and `boringtalks-test` buckets.

## Scripts

| Script | What it does |
|---|---|
| `dev` / `dev:worker` | API / worker from TypeScript sources with `node --watch` (SWC, keeps decorator metadata) |
| `build` | `tsc` → `dist/` |
| `start` / `start:worker` | `node dist/main.js` / `node dist/worker.js` |
| `db:migrate` | apply SQL migrations from `drizzle/` (`node dist/migrate.js`; Railway pre-deploy) |
| `db:migrate:dev` | the same from sources |
| `db:generate` | `drizzle-kit generate`: new migration after editing `src/db/schema.ts` |
| `test` | unit tests (Vitest); repository tests run on in-memory Postgres (PGlite), no Docker needed |
| `test:cov` | unit tests with coverage; fails under 80 % lines/statements/branches/functions |
| `test:e2e` | API + worker end to end against docker-compose Postgres/Redis/MinIO, env from `.env.test` |
| `lint` | ESLint (flat config) + `tsc --noEmit` |
| `typecheck` | `tsc --noEmit` |

## Environment

Validated with zod at boot (`src/config/env.ts`); the process exits with a list of every problem.
`.env.example` documents each variable.

| Variable | Required | Default / notes |
|---|---|---|
| `NODE_ENV` | | `development`; the image sets `production` |
| `PORT` | | `4000`; Railway sets it |
| `LOG_LEVEL` | | `info` |
| `APP_VERSION`, `GIT_SHA` | | shown by `/health` |
| `DATABASE_URL` | yes | Postgres |
| `REDIS_URL` | yes | BullMQ queues + rate-limit counters |
| `QUEUE_PREFIX` | | `bt`; BullMQ key prefix |
| `WEB_URL` | | `http://localhost:3000`; links in emails |
| `WEB_ORIGINS` | | comma list for CORS; empty = no browser origins |
| `FIREBASE_PROJECT_ID` | yes | audience/issuer of ID tokens |
| `FIREBASE_AUTH_EMULATOR_HOST` | | dev/test only: accept unsigned emulator tokens; ignored in production |
| `R2_ENDPOINT` | yes | `https://<accountid>.r2.cloudflarestorage.com`, or MinIO |
| `R2_PUBLIC_ENDPOINT` | | host used inside presigned URLs when clients reach storage elsewhere |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | yes | the shared `boringtalks` bucket |
| `R2_KEY_PREFIX` | | `prod/`, `dev/`; every object key lives under it (empty by default) |
| `R2_REGION` | | `auto` |
| `DOWNLOADS_BASE_URL` | | `https://download.boringtalks.lol` (the bucket's `downloads/` folder; dev: `…/dev`) with `latest.json` |
| `AI_GATEWAY_API_KEY` | worker | Vercel AI Gateway key (summaries and fallback transcription) |
| `SUMMARY_MODEL` | | `anthropic/claude-haiku-4.5` |
| `TRANSCRIBE_MODEL` | | `microsoft/mai-transcribe-2` (diarizes itself); `openai/whisper-1` also works, with `DIARIZE_MODEL` telling voices apart |
| `SUMMARIZE_CONCURRENCY` / `TRANSCRIBE_CONCURRENCY` | | `4` / `2` jobs per worker replica |
| `AI_FAKE` | | `1` = fake summarizer, transcriber and email sender; refused unless `NODE_ENV=test` |
| `RESEND_API_KEY` | | empty = log emails instead of sending |
| `EMAIL_FROM` | | `BoringTalks <hello@send.boringtalks.lol>` |
| `EMAIL_ALLOWLIST` | | comma list; when set, mail only these addresses (dev) |
| `DIARIZE_MODEL` | | `google/gemini-3-flash`: tells voices apart when `TRANSCRIBE_MODEL` can't (Whisper); empty = off |
| `THROTTLE_LIMIT` | | `120` requests/min per user |

## Architecture

```
                 ┌──────────────── api (N replicas) ────────────────┐
dashboard ──────►│ AuthGuard (Firebase JWT | btd_ device token)      │
Mac app  ───────►│ UserThrottlerGuard (Redis) → controllers          │──► Postgres
                 │ services → repositories (Drizzle)                 │
                 │ JobsService ── enqueue ──┐                        │
                 └──────────────────────────┼────────────────────────┘
client ── presigned PUT/GET ──► R2          ▼  Redis (BullMQ)
                                  ┌─────────────── worker ───────────────┐
                                  │ transcribe → summarize → email       │──► AI Gateway, Resend
                                  └──────────────────────────────────────┘
```

**Modules** (`src/`): `config` (typed env), `db` (pg pool + Drizzle), `redis`, `storage` (R2/S3,
presigning), `queues` (queue registration + `JobsService` producer), `auth` (guard, decorators,
Firebase verifier), `users` (`/me`), `devices` (PKCE link, device tokens), `meetings` (CRUD,
transcript storage, demo seed), `processing` (worker pipeline, summarizer, transcriber), `email`
(Resend sender, React Email templates, `email` processor), `downloads`, `health`. Controllers only
validate and delegate; services hold the rules; repositories hold the SQL.

**Two processes.** `main.ts` boots `AppModule` (HTTP, stateless). `worker.ts` boots `WorkerModule`
with `NestFactory.createApplicationContext`: the same services plus the BullMQ processors, no HTTP.
Both call `enableShutdownHooks()`: on SIGTERM the API stops accepting requests, the worker closes
its BullMQ workers (finishing active jobs) and both close Postgres and Redis.

**Queues.** `transcribe`, `summarize`, `email`. Jobs get `attempts: 5`, exponential backoff from 5 s
and are removed on completion. Job ids are deterministic so duplicates collapse:
`<meetingId>_<stage>_<run>` (BullMQ forbids `:` in custom ids) where `run` is the meeting's
`attempts` counter, bumped each time processing starts. A job whose run is no longer current, or
whose meeting is gone or in another status, does nothing. When the last retry fails (or the error
is unrecoverable, e.g. no speech in the audio) the meeting becomes `failed` with the error message.

**Pipeline.**
- `transcribe` (fallback only — Mac recordings arrive with their transcript): downloads the audio
  from R2 and sends it to Whisper through the AI Gateway with segment timestamps. Server audio is
  one mixed channel and there is no server-side diarization, so every segment is `Speaker 1`. The
  result is stored exactly like an uploaded transcript, then `summarize` is queued.
- `summarize`: merges segments into turns (`mergeSegments`), renders `[m:ss] Speaker: text`
  (`transcriptText`) and calls the model with AI SDK 7 structured output (`generateText` +
  `Output.object` with a zod schema): title, description, summary, key topics, action items with
  owner and due date, decisions — in the transcript's language. Transcripts over 60k characters
  are map-reduced: ~20-minute parts become notes, then the notes are summarized. Lengths and counts
  are enforced after the call, generic titles ("Meeting", "Weekly sync"…) are replaced with one
  built from the topics, action items get stable nanoid ids. The result goes to Postgres and to a
  `summary-<timestamp>.json` snapshot in R2, token usage is recorded, and the "meeting ready" email
  is queued if the user wants it.
- `email`: Resend with React Email templates (welcome, meeting ready, new Mac connected). The
  idempotency key is claimed in `email_log` before sending and passed to Resend as
  `Idempotency-Key`; a failed send releases the claim so the retry can send.

**Storage layout** (one private bucket `boringtalks` for all environments, every key under `R2_KEY_PREFIX` — `prod/`, `dev/`): `users/<userId>/meetings/<meetingId>/audio.<ext>`,
`transcript.json`, `summary-<timestamp>.json`. Audio goes from the client straight to R2 with a
presigned PUT (15 min) and is played back through a presigned GET (1 h).

**Data.** `users`, `devices`, `device_codes`, `meetings` (with a cached `speakers` array and a
generated `tsvector` over title + description), `segments` (GIN index on `to_tsvector('simple', text)`),
`summaries`, `email_log`. `meetings.client_key` holds the `Idempotency-Key` of `POST /meetings`
(unique per user). Migrations are plain SQL in `drizzle/`; never edit an applied one, add the next.

**Rate limiting** uses `@nestjs/throttler` with Redis storage, keyed by user id (IP when signed out).

**ESM-only dependencies.** The API compiles to CommonJS (`module: nodenext`) and loads ESM-only
packages (`ai`, `jose`, `nanoid`) with Node's `require(esm)`, which is stable from Node 22.12.

## Docker / Railway

`apps/api/Dockerfile`, build context = repo root (`.dockerignore` at the root keeps `apps/web`,
`apps/macos`, `.git` and local secrets out). The image's working directory is `apps/api`:

| Service | Start command | Notes |
|---|---|---|
| api | `node dist/main.js` | pre-deploy `node dist/migrate.js`, healthcheck `/health`, listens on `$PORT` at `0.0.0.0` |
| worker | `node dist/worker.js` | no port |

Redis connections use `family: 0` (Railway's private network is IPv6) and `maxRetriesPerRequest: null`.

## Costs

Prices from the AI Gateway model list at the time of writing.

| What | Model | Price | Per meeting-hour |
|---|---|---|---|
| Summary | `anthropic/claude-haiku-4.5` | $1 / M input, $5 / M output tokens | ≈ 12–15k in + ~1k out ≈ **$0.02** |
| Fallback transcription | `openai/whisper-1` | $0.006 / min | **$0.36** — only for browser recordings and uploads |
| Transcription on the Mac | Parakeet, on device | free | **$0** |
| Audio storage | R2, 32 kbps AAC ≈ 14 MB/h | $0.015 / GB-month, no egress fees | ≈ $0.0002 per month |

Map-reduce for long meetings adds one notes call per 20 minutes (still cents). Whisper accepts at
most 25 MB per request, about 1.7 hours of 32 kbps audio; longer server-side transcriptions would
need splitting (not implemented). `SUMMARIZE_CONCURRENCY` caps parallel LLM calls per worker replica
to stay inside gateway rate limits.

## Tests

- **Unit** (`src/**/*.spec.ts[x]`): summarizer with `MockLanguageModelV4` (prompt contents, schema
  parsing, map-reduce path, generic-title guard), transcriber mapping, status transitions, PKCE,
  Firebase JWT verification against a locally generated RS256 key and JWKS, emulator tokens, device
  tokens and revocation, cursors, R2 keys and presigning (mocked S3 client), email idempotency,
  allowlist and template rendering, demo seed, downloads cache, health. Repositories run against
  PGlite with the real migrations.
- **E2E** (`test/*.e2e-spec.ts`): boots the real API and worker in-process against docker-compose
  services with `AI_FAKE=1`: sign-in seeds the demo; Mac flow (presigned PUT of real bytes to MinIO
  → transcript → complete → worker → ready → email → rename/reprocess → delete removes objects);
  browser flow (audio → transcribe → summarize → ready); device link (authorize → token → API calls
  → 403 on Firebase-only → revoke → 401); isolation (another user's meeting → 404); validation
  `400` shape; pagination and search.

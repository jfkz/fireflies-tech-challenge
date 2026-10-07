# Costs

The brief asks for meetings to be described on the backend. The question is how to do that
without paying per minute of audio. Answer: transcribe on the user's Mac, send text, and spend
server money only on one small LLM call per meeting.

Prices are list prices from the Vercel AI Gateway model list, Cloudflare R2 and Resend pricing
pages, October 2026.

## Per meeting-hour

| Item | Mac recording | Browser recording / upload |
|---|---|---|
| Transcription | **$0** (Parakeet on the Neural Engine) | $0.10 (`microsoft/mai-transcribe-2`, with speakers) |
| Title + summary + action items | ~$0.02 (`anthropic/claude-haiku-4.5`: ~13k tokens in at $1/M, ~1k out at $5/M) | ~$0.02 |
| Upload to the server | a few KB of JSON (+14 MB audio if kept) | 14–60 MB audio |
| Audio storage | $0.0002/month (14 MB at $0.015/GB-month) | same |
| Playback | $0 (R2 has no egress fees) | $0 |
| **Total** | **≈ $0.02** | **≈ $0.38** |

## Per 1,000 meeting-hours

| | All on Mac | All server-side |
|---|---|---|
| AI | ~$20 | ~$380 |
| R2 storage (14 GB, kept a month) | ~$0.21 | ~$0.21 |
| Emails (one per meeting, 1,000) | free tier (3,000/month) | free tier |
| **Total variable cost** | **≈ $20** | **≈ $380** |

Fixed costs: Railway (API + worker + Postgres + Redis, usage-based, a few dollars a month idle),
Vercel Hobby (free), Cloudflare R2 (10 GB free), Firebase Auth (free up to 50k MAU), Resend free tier.

## Why not the obvious alternatives

- **Server-side transcription for everyone** (Whisper, Deepgram, AssemblyAI): $0.15–0.40 per
  hour, plus uploading full audio. For a busy product that is the whole bill. We keep it only as a
  fallback.
- **Self-hosted Whisper on GPU workers:** cheaper per hour at scale, but GPUs are paid while idle and
  need capacity planning. The users' Macs already have a Neural Engine.
- **A bigger model for summaries:** a transcript is easy input; Haiku 4.5 gives specific titles and
  usable action items at a fraction of the price. `SUMMARY_MODEL` switches models without code
  changes.

## Guard rails

- AI Gateway keys have monthly budgets: $25 for production, $5 for dev.
- Worker concurrency caps parallel LLM calls (`SUMMARIZE_CONCURRENCY`, `TRANSCRIBE_CONCURRENCY`).
- Upload size is capped (200 MB), upload URLs expire after 15 minutes, and per-user rate limits
  apply.
- Token usage is stored per summary (`summaries.input_tokens` / `output_tokens`) to watch spend.

# BoringTalks API

Base URL: `https://api.boringtalks.lol` (production), `https://api.dev.boringtalks.lol` (dev),
`http://localhost:4000` (local). There is no global path prefix.

All bodies are JSON. Request and response shapes are the zod schemas in
[`packages/shared`](../packages/shared/src) (`@boringtalks/shared`); type names below refer to them.
Timestamps are ISO 8601 UTC strings; durations are seconds; transcript times are milliseconds
from the start of the meeting.

## Authentication

Send `Authorization: Bearer <token>`. Two kinds of token are accepted:

| Token | Who uses it | How it is checked |
|---|---|---|
| Firebase ID token (a JWT) | the web dashboard | RS256 signature against Google's public keys (`securetoken@system.gserviceaccount.com` JWKS), `iss = https://securetoken.google.com/<FIREBASE_PROJECT_ID>`, `aud = <FIREBASE_PROJECT_ID>`, unexpired, non-empty `sub`. No service-account key is involved. |
| Device token `btd_…` | the Mac app | `btd_` + 32 random bytes (base64url). Only its SHA-256 is stored; revoked devices are rejected. |

The first request with a new Firebase identity creates the user, seeds a ready **demo meeting** and
queues a welcome email. Email and name are refreshed from the token when they change.

Outside production, when `FIREBASE_AUTH_EMULATOR_HOST` is set, unsigned Firebase Auth emulator
tokens (`alg: none`) are accepted too; audience, issuer and expiry are still checked.

Routes marked **Firebase only** refuse device tokens with `403`. Routes marked **public** need no token.

## Errors

Every error has the `ApiError` shape:

```json
{ "statusCode": 400, "message": "Validation failed", "issues": [{ "path": "segments.0.endMs", "message": "endMs must not be before startMs" }] }
```

`issues` is present only for validation errors. Status codes used:

| Code | Meaning |
|---|---|
| 400 | Body/query failed validation, invalid cursor, or an invalid/used/expired device code |
| 401 | Missing, invalid or revoked token |
| 403 | A device token on a Firebase-only route |
| 404 | Not found — also for another user's meeting or a malformed meeting id |
| 409 | The meeting's status does not allow this action (already completed, or being processed) |
| 422 | `complete`/`reprocess` on a meeting with neither a transcript nor uploaded audio |
| 429 | Rate limit exceeded |

## Rate limits

Per signed-in user (per IP for public routes), counted in Redis so all API replicas share them:

- default: 120 requests/minute (`THROTTLE_LIMIT`)
- `POST /meetings/:id/upload-url`: 20/minute
- `POST /devices/token`: 10/minute

Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`.

## Meeting lifecycle

```
recording ──► summarizing ──► ready ──(reprocess)──► summarizing
    │              ▲   │
    └► uploaded ─► transcribing        any of them ──► failed ──(reprocess)──► transcribing | summarizing
```

- A Mac recording uploads its transcript and goes straight to `summarizing`.
- A browser recording or file upload has only audio, so it goes through `transcribing` first.
- `failed` meetings carry `error`; `POST /reprocess` restarts them.

---

## Public

### `GET /health`
`200 { "status": "ok", "version": "0.1.0", "commit": "abc123", "checks": { "db": true, "redis": true } }`,
or `503` with `status: "error"` when Postgres or Redis does not answer.

### `GET /downloads/latest`
Latest Mac build (`LatestDownload`), read from `<DOWNLOADS_BASE_URL>/latest.json` and cached for 5 minutes.
`404` until a build has been published.

```json
{ "version": "1.0.0", "build": "42", "url": "https://download.boringtalks.lol/BoringTalks-1.0.0.dmg",
  "sizeBytes": 14200000, "minimumOs": "26.0", "notarized": true, "publishedAt": "2026-10-06T10:00:00Z" }
```

## Account

### `GET /me` → `Me`
```json
{ "id": "3cf2…", "email": "ann@example.com", "name": "Ann", "emailOnReady": true, "createdAt": "2026-10-06T11:05:10.373Z" }
```

### `PATCH /me/settings` (`UpdateSettingsRequest`) → `Me`
At least one of:
```json
{ "emailOnReady": false, "name": "Maya Chen" }
```
`name` is how transcripts call the person recording (speaker "You", by first name). Setting it
also renames "You" in all past meetings, except where the user named that speaker by hand, and
stops sign-ins from overwriting it with the provider's name.

### `GET /meetings/stats?from=&to=&tz=` → `MeetingStats`
Meetings and minutes per calendar day, for the calendar. `from` and `to` are dates (`to`
exclusive, at most 400 days apart); `tz` is an IANA time zone (default `UTC`) that decides which
day a meeting belongs to. Only days with meetings are listed:
```json
{ "tz": "Europe/Berlin", "days": [{ "date": "2026-10-06", "count": 2, "totalSec": 5400 }] }
```
`400` for an unknown time zone.

### `GET /meetings/facets` → `MeetingFacets`
The speakers and topics of the user's meetings, most frequent first (24 of each), for the filter bar:
```json
{ "speakers": [{ "value": "Dana", "count": 7 }], "topics": [{ "value": "Pricing", "count": 4 }] }
```

## Meetings

### `GET /meetings?cursor=&limit=&q=&speaker=&topic=&from=&to=` → `MeetingPage`
Newest first (`started_at desc, id desc`), keyset pagination. `limit` 1–100 (default 20). Pass the
returned `nextCursor` (opaque) to get the next page; it is `null` on the last page.

`q` is a full-text search (Postgres `websearch_to_tsquery('simple', q)`) over titles, descriptions
and transcript text: `pricing launch`, `"exact phrase"`, `pricing -draft`, `budget or pricing`.

Filters (all optional, combined with AND): `speaker` (a display name, exact), `topic` (a tag,
exact), `from` / `to` (ISO date-times with offset; `from` inclusive, `to` exclusive).

```json
{
  "items": [{
    "id": "41fc…", "title": "Pricing review: Pro tier to $29, launch moved to Nov 3",
    "description": "Dana, Leo and you agreed to raise Pro to $29/month…",
    "status": "ready", "source": "demo", "startedAt": "2026-10-05T11:00:00.000Z",
    "durationSec": 212, "speakers": ["Ann", "Dana", "Leo"], "topics": ["Pricing", "Launch Planning"],
    "actionItemCount": 4, "hasAudio": false
  }],
  "nextCursor": null
}
```

### `POST /meetings` (`CreateMeetingRequest`) → `201 MeetingDetail` (or `200`, see below)
```json
{ "source": "macos", "startedAt": "2026-10-06T14:05:00Z", "language": "en", "title": "optional" }
```
Optional header **`Idempotency-Key`**: 1–200 printable ASCII characters (no leading/trailing space),
for example a UUID generated once per recording. If the same user sends the same key again, no new
meeting is created: the response is `200` with the meeting the first request created, in its current
state. Use it to retry a create whose response was lost. Keys are scoped per user and do not expire.
An invalid key is a `400` with `issues: [{ "path": "Idempotency-Key", … }]`. Without the header every
call creates a new meeting.

```sh
curl -XPOST $API/meetings -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -H 'Idempotency-Key: 7b0e4c1e-3f7a-4d0b-9a59-1f6c2f0a9d11' -d '{"source":"macos"}'
```
`source` is `macos`, `browser` or `upload`. The meeting starts in `recording` with a placeholder
title such as `Meeting on Oct 6, 14:05` (UTC) that the summarizer replaces. A title given here (or
later through `PATCH`) is kept: the summarizer never overwrites a title the user chose.

### `GET /meetings/:id` → `MeetingDetail`
The list item plus `language`, `error`, `summary` (summary, keyTopics, actionItems, decisions, model),
the full `segments` and `audioUrl` — a presigned GET valid for 1 hour, or `null` when there is no audio.

```json
{
  "id": "3c50…", "title": "Beta ship Friday with release notes due Thursday", "status": "ready", "…": "…",
  "summary": {
    "summary": "The team decided to ship the beta on Friday. …",
    "keyTopics": ["Beta release", "Release notes"],
    "actionItems": [{ "id": "zmRnapn6Bn", "text": "Write release notes", "owner": "Speaker 1", "due": "Thursday", "done": false }],
    "decisions": ["Ship beta on Friday"],
    "model": "anthropic/claude-haiku-4.5"
  },
  "segments": [{ "speaker": "You", "startMs": 0, "endMs": 1000, "text": "Let's ship the beta Friday" }],
  "audioUrl": null
}
```

### `PATCH /meetings/:id` (`UpdateMeetingRequest`) → `MeetingDetail`
Rename, tick an action item and/or rename speakers (at least one of them):
```json
{ "title": "Beta go/no-go", "actionItem": { "id": "zmRnapn6Bn", "done": true }, "speakers": { "Speaker 2": "Leo" } }
```
`speakers` maps a current display name to a new one (1–20 at a time). The new names are marked as
typed by hand, so reprocessing never overwrites them; action item owners follow. Giving two speakers
the same name merges them into one person in lists and filters. `404` if the action item or a
speaker does not exist.

**Speaker names.** Segments are stored with the recorder's labels ("You", "Speaker 1"); responses
show display names. After each summary the worker names the labels: "You" becomes the account
holder's first name, the others get a name only when the conversation shows it (an introduction,
being addressed by name and answering, a sign-off), else a clear role ("Recruiter"), else they keep
their label. `speakers` in list and detail, segments and action item owners all use display names.

### `DELETE /meetings/:id` → `204`
Deletes the meeting, its transcript and summary, and every stored object (audio, transcript JSON,
summary snapshots).

### `POST /meetings/:id/upload-url` (`UploadUrlRequest`) → `UploadUrlResponse`
```json
{ "contentType": "audio/mp4", "sizeBytes": 14000000 }
```
```json
{ "url": "https://<account>.r2.cloudflarestorage.com/boringtalks/prod/users/…/audio.m4a?X-Amz-…",
  "key": "users/<userId>/meetings/<id>/audio.m4a", "headers": { "Content-Type": "audio/mp4" }, "expiresInSec": 900 }
```
Then `PUT` the bytes to `url` with exactly those `headers`. The audio never passes through the API.
Allowed types: `audio/mp4`, `audio/m4a`, `audio/x-m4a`, `audio/webm`, `audio/ogg`, `audio/mpeg`,
`audio/wav`; max 200 MB. `409` while the meeting is being processed.

### `PUT /meetings/:id/transcript` (`TranscriptUpload`) → `204` (replaces)
```json
{ "language": "en", "durationSec": 1830,
  "segments": [{ "speaker": "You", "startMs": 0, "endMs": 2400, "text": "Okay, let's start." },
               { "speaker": "Speaker 1", "startMs": 2600, "endMs": 5100, "text": "Pricing first?" }] }
```
1–20,000 segments. Replaces the whole transcript. The raw JSON is stored in R2 as
`transcript.json` (source of truth) and copied into Postgres for search. `409` while processing.

### `POST /meetings/:id/complete` (`CompleteMeetingRequest`) → `MeetingDetail`
```json
{ "durationSec": 1830 }
```
Ends the recording and starts processing. Allowed only from `recording`, `uploaded` or `failed`:
- transcript present → `summarizing`;
- else uploaded audio present (checked in storage) → `transcribing`, then `summarizing`;
- else `422`.

A meeting that was already completed (`transcribing`, `summarizing` or `ready`) answers `409`, so a
retried `complete` is harmless; use `reprocess` to run a ready meeting again.

Poll `GET /meetings/:id` until `status` is `ready` or `failed`.

### `POST /meetings/:id/reprocess` → `MeetingDetail`
Runs the pipeline again: from transcription when there is no transcript, else from the summary.
Allowed from `ready` and `failed`.

## Tasks

### `GET /tasks?status=&owner=&cursor=&limit=` → `TaskPage`
Action items from every meeting as one to-do list. `status` is `open` (default), `done` or `all`;
`owner` keeps one person's (display name, exact); `limit` 1–200 (default 100), keyset-paginated
with `nextCursor`. Order: open before done, soonest `dueDate` first, undated last, then newest
meeting first, then summary order.
```json
{
  "items": [{
    "id": "zmRnapn6Bn", "text": "Send the CSV samples to Tom", "owner": "Priya",
    "due": "today", "dueDate": "2026-10-06", "done": false,
    "meeting": { "id": "41fc…", "title": "Acme onboarding: import before the 20th", "startedAt": "2026-10-06T09:00:00.000Z" }
  }],
  "nextCursor": null
}
```
Tick a task off with `PATCH /meetings/:meetingId { "actionItem": { "id", "done" } }`.

**Due dates.** `due` is the deadline as said; `dueDate` is the same deadline as a date, worked out by
the summarizer from the meeting's date ("Friday" → the Friday after the meeting), or `null`.

## Devices (Mac app sign-in, PKCE)

1. The app makes a `code_verifier` (43–128 chars) and `code_challenge = base64url(sha256(verifier))`,
   then opens `https://boringtalks.lol/connect?challenge=<challenge>&device=<device name>`.
2. The signed-in dashboard calls `POST /devices/authorize` and redirects the browser to `redirectUrl`.
3. The app receives `boringtalks://callback?code=…` and calls `POST /devices/token` with the verifier.

### `POST /devices/authorize` (`AuthorizeDeviceRequest`, **Firebase only**) → `201 AuthorizeDeviceResponse`
```json
{ "codeChallenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "deviceName": "Ann's MacBook Air" }
```
```json
{ "code": "q1…", "expiresInSec": 600, "redirectUrl": "boringtalks://callback?code=q1…" }
```
The code is single-use and expires in 10 minutes.

### `POST /devices/token` (`DeviceTokenRequest`, **public**) → `DeviceTokenResponse`
```json
{ "code": "q1…", "codeVerifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" }
```
```json
{ "token": "btd_…", "deviceId": "8a1c…", "user": { "email": "ann@example.com", "name": "Ann" } }
```
The code is consumed atomically whatever the outcome, so a wrong verifier burns it (`400`). The
account owner gets a "New Mac connected" email. Store the token in the Keychain; it does not expire
and is revoked from the dashboard.

### `GET /devices` → `Device[]`
Active (not revoked) devices. `lastSeenAt` is updated at most once a minute.

### `DELETE /devices/:id` → `204`
Revokes the device; its token stops working immediately. `404` if unknown or already revoked.

---

## Example: Mac recording end to end

```sh
API=http://localhost:4000 T="btd_…"
ID=$(curl -s -XPOST $API/meetings -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{"source":"macos"}' | jq -r .id)
UP=$(curl -s -XPOST $API/meetings/$ID/upload-url -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d "{\"contentType\":\"audio/mp4\",\"sizeBytes\":$(stat -f%z meeting.m4a)}")
curl -s -XPUT "$(jq -r .url <<<"$UP")" -H 'Content-Type: audio/mp4' --data-binary @meeting.m4a
curl -s -XPUT $API/meetings/$ID/transcript -H "Authorization: Bearer $T" -H 'content-type: application/json' -d @transcript.json
curl -s -XPOST $API/meetings/$ID/complete -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"durationSec":1830}'
curl -s $API/meetings/$ID -H "Authorization: Bearer $T" | jq '{status, title, summary}'
```

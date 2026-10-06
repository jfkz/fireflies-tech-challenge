# @boringtalks/web

The BoringTalks website: the landing page at `/` and the dashboard behind sign-in.
Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, Motion for React,
TanStack Query, Firebase Auth (modular SDK v12). It talks to the NestJS API in
`apps/api` using the contract in `@boringtalks/shared`.

## Running it

```bash
pnpm install                                # from the repo root
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @boringtalks/shared build     # the web app consumes its built output
pnpm --filter @boringtalks/web dev          # http://localhost:3000
```

Without a local API the landing page still works (the download card shows
“coming soon”). To try the dashboard without Firebase credentials, run the Auth
emulator from the e2e package and point the app at it:

```bash
pnpm --filter @boringtalks/e2e emulators    # Auth emulator on 127.0.0.1:9099
# .env.local
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR=http://127.0.0.1:9099
NEXT_PUBLIC_FIREBASE_API_KEY=demo-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-boringtalks
```

## Environment

| Variable | Required | What |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | API base URL, no trailing slash. Prod `https://api.boringtalks.lol`, dev `https://api.dev.boringtalks.lol`, local `http://localhost:4000` (default). |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | yes* | Firebase web app config. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | yes* | e.g. `boringtalks.firebaseapp.com`. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes* | The API verifies ID tokens against this project. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | yes* | |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR` | no | e.g. `http://127.0.0.1:9099`; when set the app calls `connectAuthEmulator` (*then the others may be demo values). |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical URL for metadata, OG image, sitemap. Default `https://boringtalks.lol`. |

All of them are public (inlined into the client bundle) and read in one place,
`src/lib/env.ts`, which validates the URLs at startup.

## Scripts

| Script | What |
|---|---|
| `dev` | `next dev` on port 3000 |
| `build` / `start` | production build / server |
| `lint` | ESLint flat config (`eslint-config-next` core-web-vitals + typescript) |
| `typecheck` | `next typegen` (route types for `PageProps`/`LayoutProps`) then `tsc --noEmit` |
| `test` / `test:cov` | Vitest + React Testing Library in jsdom; `test:cov` enforces the coverage gate |
| `icon` | regenerates `src/app/icon.svg` (favicon, also used in the OG image) from the `AppIcon` component |

The Playwright suites live in `e2e/` (`pnpm --filter @boringtalks/e2e test:e2e`).

## Deploying

Vercel project with root directory `apps/web`. `vercel.json` only pins
`framework: nextjs`, because a project created from the CLI has no preset.
Everything runs on the Node.js runtime; there are no rewrites. Set the
environment variables above per environment (they are build-time values, so a
change needs a redeploy).

## Structure

```
src/
  app/
    page.tsx                 landing (server component composing client islands)
    layout.tsx               fonts (next/font: Bagel Fat One + Nunito), metadata, providers
    (auth)/signin|signup|reset   sign-in pages with the sleepy receptionist
    (app)/meetings, meetings/[id], record, settings
                             dashboard, client-guarded by <RequireAuth>
    connect/                 Mac app device approval (PKCE)
    not-found.tsx, error.tsx, global-error.tsx, loading.tsx/error.tsx per dashboard route
    opengraph-image.tsx, icon.svg, robots.ts, sitemap.ts
  components/
    avatar/                  Avatar (SVG head), TalkingHead (animated), SpeechBubble, TypeLine
    landing/                 the scroll story sections
    app/                     dashboard views
    auth/                    forms + the receptionist's mood
    ui/                      StatusChip, SpeakerChip, ConfirmDialog (<dialog>), Switch, …
    providers/               QueryClient, AuthProvider (Firebase, lazily loaded), LazyMotion
  hooks/
    queries.ts               every API call as a TanStack Query hook (polling, cursor pages, optimistic updates)
    useRecorder.ts           MediaRecorder + Web Audio mixing + level meter
    useAudioSync.ts          <audio> ↔ transcript sync
    useDebouncedValue.ts, usePrefersReducedMotion.ts
  lib/
    api.ts                   typed client; every response parsed with the shared zod schemas
    lazy-api.ts, api-instance.ts, api-error.ts   see “Bundle” below
    upload.ts                content-type mapping, XHR PUT with progress, create → upload → complete
    recorder.ts              the recorder as a pure state machine
    connect.ts               /connect query validation, allowed redirects
    avatar/                  port of the Talking Heads pose/face/style code
    landing/story.ts         the landing's scroll beats as data
```

## Data flow

- **Auth**: `AuthProvider` loads `firebase/auth` with a dynamic import the
  first time a component calls `useAuth()`, so the landing never downloads it.
  ID tokens come from `currentUser.getIdToken()` per request; the cache is
  cleared when the signed-in user changes.
- **API**: hooks in `hooks/queries.ts` wrap the typed client. Query keys include
  the user id. `GET /me` runs first in the dashboard shell (it creates the
  account and its demo meeting server-side) and the meeting list waits for it.
  A meeting polls every 3 s while it is `recording/uploaded/transcribing/summarizing`
  and stops at `ready`/`failed`; the list refreshes every 5 s while anything in
  it is processing. Action-item toggles and renames are optimistic and roll back
  on error.
- **Uploads** go straight from the browser to R2 with the presigned URL from
  `POST /meetings/:id/upload-url` (XHR, for progress), then
  `POST /meetings/:id/complete`.

## Bundle

`@boringtalks/shared` is CommonJS, so the bundler can't tree-shake it: importing
any value from it pulls in every schema and zod. The app therefore keeps runtime
imports of it out of anything every page loads. The API client is a lazy proxy
(`lib/lazy-api.ts`) whose real module loads on the first call, `ApiRequestError`
lives in its own module, and `env.ts` doesn't use zod. The web app has no direct
`zod` dependency (it would be a second, ESM copy). The landing's below-the-fold
sections are `next/dynamic` chunks (still server-rendered).

## How the landing animation is built

**The heads.** `components/avatar/Avatar.tsx` is a line-by-line SVG port of
Talking Heads' `AvatarPainter` (AvatarView.swift): the same 200×200 design
space, shapes, the four hair cuts, beards, lashes, headphones and headset,
the shirt badge, and the emotion faces from `Emotion.swift` (`FaceShape.blend`
in `lib/avatar/face.ts`). It is a pure function of a `Pose`. `lib/avatar/pose.ts`
ports `AvatarAnimator`: blinks on a seeded random schedule (with the occasional
double blink), head bob and tilt while talking, eased emotion changes, and a
mouth that opens per syllable. The web has no microphone level to follow, so
syllables are synthesized from layered sines with gaps between words. Additions
for the web: `sleep` (eyes droop then close, head lolls, Zzz float up), `yawn`,
and `joy` (closed happy eyes, bouncing, used for cheering).
`TalkingHead` runs that animator in `requestAnimationFrame` at ~30 fps only
while the head is on screen (IntersectionObserver), can follow the cursor through
one shared passive pointer listener (`lib/pointer.ts`), and renders a still pose
when reduced motion is requested. The speech bubble is `BubbleShape` from
OverlayViews.swift: CSS for the body (so text wraps and it server-renders) plus a
small SVG tail, with a hard `drop-shadow` over both. The logo and favicon are the
app icon from MarketingArt.swift's `IconView`.

**The scroll story.** Each act is a tall track (`.scrolly`, e.g. 460vh) with a
sticky full-screen stage (`.scrolly-stage`). Motion's `useScroll({ target })`
gives the act's progress, and `useTransform` maps it to layers that move at
different rates: the back wall (window, whiteboard, clock, plant) drifts slowest,
heads and table slightly, mugs in the foreground fastest. The window's sky goes
from noon to night, the plant droops, and the clock's minute hand runs from the
“5 min quick sync” to 58 minutes. Discrete changes (which caption is up, who is
asleep, what the presenter says) come from `lib/landing/story.ts`, which maps
progress to beats; `useMotionValueEvent` updates React state only when the beat
changes, so scrolling doesn't re-render the scene every frame. In the hero the
heads trade clichés on a timer, each bubble typing out like live captions.
“How it works” uses the same pattern: three steps beside a Mac window whose
transcript lines drop in as bubbles and whose summary card assembles itself.
Further down, confetti pieces and the receipt use scroll-linked parallax only.

**Reduced motion.** CSS makes the tracks normal height and the stages
non-sticky before any JavaScript runs (`@media (prefers-reduced-motion: reduce)`),
hides decorative layers (`.motion-only`) and shows a plain-text version of the
story (`.still-only`). In React, `usePrefersReducedMotion` (a hydration-safe
`useSyncExternalStore`) switches “How it works” to a static list, stops head
animation loops and shows bubble text at once. `MotionConfig reducedMotion="user"`
covers the remaining transitions.

## Tests

- **Unit** (`pnpm test:cov`): 165 tests; coverage gate in `vitest.config.ts`
  (lines and statements ≥ 70 %, functions ≥ 65 %, branches ≥ 60 %) over `lib/`,
  `hooks/` and the components with logic (avatar, app, auth, ui, download card).
  The scroll scenes and route files are covered by Playwright instead.
- **e2e**: see `e2e/` at the repo root. The `ui` project runs this app against
  the Firebase Auth emulator with the API mocked from the shared schemas; `smoke`
  checks a deployed environment.

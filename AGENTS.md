# AGENTS.md

Guide for coding agents working in this repository.

## Layout

- `packages/shared` — zod schemas that define the API contract, plus transcript helpers. Change the
  contract here first; the API, the web app and the Mac app's Codable fixtures all follow it.
- `apps/api` — NestJS 11 API (`src/main.ts`) and BullMQ worker (`src/worker.ts`), Drizzle + Postgres.
- `apps/web` — Next.js 16 App Router: landing page and dashboard.
- `apps/macos` — Swift/SwiftUI menu-bar recorder, XcodeGen (`project.yml`); pure logic in `BoringTalksKit/`.
- `e2e` — Playwright (`test:e2e` UI suite with the Firebase Auth emulator, `test:smoke` for deployed envs).
- `docs` — architecture, features, QA flows, API, deployment, costs.

## Commands

```sh
pnpm install
docker compose up -d                 # Postgres :55433, Redis :6480, MinIO :9100
pnpm turbo run lint typecheck test:cov build
pnpm --filter @boringtalks/api test:e2e
pnpm --filter @boringtalks/e2e test:e2e
cd apps/macos && SIGN_IDENTITY=- scripts/test.sh
```

## Rules

- Follow each framework's conventions: Nest modules/DI/guards/pipes; Next.js Server Components by
  default and `"use client"` only where needed; Swift concurrency with `@MainActor` UI state.
- Coverage gates are enforced in CI (`test:cov`); new logic needs unit tests, critical flows need e2e.
- Never commit secrets. Local secrets live in the gitignored `.local/` directory.
- One open pull request at a time: every ready PR deploys to the shared dev environment.
- Keep `docs/FEATURES.md` and `docs/QA.md` in step with user-facing changes.
- The Mac app, the API and the web app share major.minor (`apps/macos/project.yml` `MARKETING_VERSION`,
  `apps/api/package.json`, `apps/web/package.json`): bump the minor on all three together; patch releases
  can differ. `pnpm check:versions` (run in CI) fails otherwise.

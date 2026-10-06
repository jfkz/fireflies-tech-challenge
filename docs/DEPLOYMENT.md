# Deployment

## Flow

| Event | Deploys to | Workflow |
|---|---|---|
| Ready (non-draft) pull request opened, pushed, reopened or marked ready | **dev** | `deploy.yml`, `macos.yml` |
| Push to `main` (merge) | **production** | `deploy.yml`, `macos.yml` |
| Any pull request or push | — (checks only) | `ci.yml` |

Only one pull request may be open at a time (Dependabot excluded): all PRs share the dev
environment, so the "One open PR" job fails a second one and nothing deploys. Pushing to an open,
ready PR is shipping to dev.

Each deploy run:

1. **API + worker → Railway.** `railway up --service api`, then `--service worker`, for the matching
   Railway environment. The API's pre-deploy command runs migrations. The job waits until `/health`
   reports the deployed commit.
2. **Web → Vercel.** Production: `vercel deploy --prod`. Dev: a preview deployment aliased to
   `dev.boringtalks.lol`.
3. **Smoke tests.** Playwright `smoke` suite against the deployed web + API.
4. **DMG** (`macos.yml`, only when `apps/macos/**` changed): build on a `macos-26` runner, sign
   (Developer ID when the secrets exist, ad-hoc otherwise), notarize, publish to R2 with
   `latest.json`. The landing page's Download button reads it via `GET /downloads/latest`.

## Infrastructure

| Piece | Where | Production | Dev |
|---|---|---|---|
| Web | Vercel project `boringtalks` (team `jfkz0`), root `apps/web` | `boringtalks.lol` (`www` redirects) | `dev.boringtalks.lol` |
| API | Railway project `boringtalks`, service `api` | `api.boringtalks.lol`, environment `production` | `api.dev.boringtalks.lol`, environment `dev` |
| Worker | Railway service `worker` | same image, `node dist/worker.js` | same |
| Postgres, Redis | Railway services, one per environment | | |
| Object storage | Cloudflare R2 bucket `boringtalks` | `prod/` | `dev/` |
| DMGs | same bucket, `downloads/`, served at `download.boringtalks.lol` | `downloads/` → `/` | `downloads/dev/` → `/dev/` |
| Auth | Firebase project `boringtalks-fe45f` (Email/Password, Google) | shared | shared |
| AI | Vercel AI Gateway (team `jfkz0`) | key `boringtalks-worker-prod` | key `boringtalks-worker-dev` |
| Email | Resend, domain `send.boringtalks.lol` | | allow-listed recipients only |
| DNS | Cloudflare zone `boringtalks.lol`, all records DNS-only | | |

One R2 bucket holds every environment under its own prefix. An R2 custom domain exposes the whole
bucket, so a URL-rewrite rule on `download.boringtalks.lol` prepends `/downloads` to every path:
the public domain can only ever reach the `downloads/` folder, never meeting audio or transcripts.

## Configuration

**Railway** (per environment, shared variables referenced by both services): `DATABASE_URL`,
`REDIS_URL` (references to the Postgres/Redis services), `NODE_ENV`, `WEB_URL`, `WEB_ORIGINS`,
`FIREBASE_PROJECT_ID`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_KEY_PREFIX` (`prod/` / `dev/`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`DOWNLOADS_BASE_URL`, `AI_GATEWAY_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_ALLOWLIST` (dev),
`SUMMARIZE_CONCURRENCY`. CI sets `GIT_SHA` / `APP_VERSION` before each deploy. Full list:
[apps/api/README.md](../apps/api/README.md#environment).

**Vercel**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` (per environment), `NEXT_PUBLIC_FIREBASE_*`.

**GitHub** environments `production` and `dev`:

| Secret | Scope | Used by |
|---|---|---|
| `RAILWAY_TOKEN` | per environment (Railway project token for that environment) | deploy |
| `VERCEL_TOKEN` | repository (team-scoped token; dev needs `vercel alias`) | deploy |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | repository (Object R/W on the `boringtalks` bucket) | DMG publish |
| `DEVELOPER_ID_P12`, `DEVELOPER_ID_P12_PASSWORD` | repository, optional | DMG signing |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | repository, optional | notarization |

## Manual deploys

```sh
# API / worker (needs a Railway login or RAILWAY_TOKEN)
railway up --service api --environment dev
railway up --service worker --environment dev

# Web
vercel deploy --scope jfkz0                     # preview
vercel deploy --prod --scope jfkz0              # production

# DMG
cd apps/macos && scripts/build.sh && scripts/make-dmg.sh build/Release/BoringTalks.app build/BoringTalks.dmg
```

## Rollback

- Web: `vercel rollback` (or promote the previous deployment in the dashboard).
- API/worker: redeploy the previous deployment from the Railway dashboard; migrations are additive.
- DMG: re-run `scripts/publish.sh` with the previous DMG (versioned files stay in the bucket).

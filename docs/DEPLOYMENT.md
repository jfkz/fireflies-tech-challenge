# Deployment

## Flow

| Event | Deploys to | Workflow |
|---|---|---|
| Ready (non-draft) pull request opened, pushed, reopened or marked ready | **dev** | `deploy.yml` |
| Push to `main` (merge) | **production** | `deploy.yml` |
| Any pull request or push | — (checks only) | `ci.yml` |

Only one ready pull request may be open at a time (drafts and Dependabot excluded): all PRs share the dev
environment, so the "One open PR" job fails a second one and nothing deploys. Pushing to an open,
ready PR is shipping to dev.

Each deploy run:

1. **API + worker → Railway.** `railway up --service api`, then `--service worker`, for the matching
   Railway environment. The API's pre-deploy command runs migrations. The job waits until `/health`
   reports the deployed commit.
2. **Web → Vercel.** Production: `vercel deploy --prod`. Dev: a preview deployment aliased to
   `dev.boringtalks.lol`.
3. **Smoke tests.** Playwright `smoke` suite against the deployed web + API.
4. **Mac app.** `macos.yml` builds and tests it on a `macos-26` runner when `apps/macos/**` changes.
   Releases run on a developer's Mac, so the signing key stays off CI: `apps/macos/scripts/release.sh
   prod` (or `dev`, which builds the separate BoringTalks Dev app) signs with Developer ID and the app's
   provisioning profile, builds the DMG, submits it for notarization and publishes it to R2 with `latest.json`; once Apple accepts it, `release.sh staple prod` staples the ticket and
   republishes it as notarized (`WAIT=1` does both in one go).
5. **Windows app.** `windows.yml` runs the unit tests (with the Core coverage gate), builds the app
   and the installer on `windows-latest` when `apps/windows/**` (or the shared contract fixtures)
   changes, and keeps each run's unsigned `BoringTalks-Setup.exe` as an artifact for a week.
   Releases run on a developer's PC: `apps/windows/scripts/release.ps1 prod` (or `dev`, which builds
   the separate BoringTalks Dev app) builds the
   self-contained app, packs the per-user installer with Velopack and publishes it to R2 with
   `latest-windows.json` (needs the AWS CLI and `.local/secrets/r2`). It isn't code-signed yet
   (`notarized: false`); setting `SIGN_PARAMS` signs it. The same run publishes the update feed
   the installed apps check (`downloads/[dev/]updates/windows/`: the full package, then
   `releases.win.json`).

Desktop versions: every `release.sh` / `release.ps1` run (prod or dev) moves the patch up,
because installers and the Windows updater only take a newer version. `scripts/next-version.mjs`
picks one patch above the build that's live for that target (`latest.json` / `latest-windows.json`,
prod or `dev/`), or the repo's version when that's higher already (a new minor), and the script
writes it back to `project.yml` / `Directory.Build.props`. Commit that change.

The landing page's download card reads both manifests via `GET /downloads`; links elsewhere
(README, docs, structured data) use the stable https://download.boringtalks.lol/BoringTalks-latest.dmg
and https://download.boringtalks.lol/BoringTalks-Setup-latest.exe.

## Infrastructure

| Piece | Where | Production | Dev |
|---|---|---|---|
| Web | Vercel project `boringtalks` (team `jfkz0`), root `apps/web` | `boringtalks.lol` (`www` redirects) | `dev.boringtalks.lol` |
| API | Railway project `boringtalks`, service `api` | `api.boringtalks.lol`, environment `production` | `api.dev.boringtalks.lol`, environment `dev` |
| Worker | Railway service `worker` | same image, `node dist/worker.js` | same |
| Postgres, Redis | Railway services, one per environment | | |
| Object storage | Cloudflare R2 bucket `boringtalks` | `prod/` | `dev/` |
| Installers (DMG, Setup.exe), speech-model mirror (`models/`) | same bucket, `downloads/`, served at `download.boringtalks.lol` | `downloads/` → `/` | `downloads/dev/` → `/dev/` |
| Auth | Firebase project `boringtalks-fe45f` (Email/Password, Google) | shared | shared |
| AI | Vercel AI Gateway (team `jfkz0`) | key `boringtalks-worker-prod` | key `boringtalks-worker-dev` |
| Email | Resend, domain `send.boringtalks.lol` | | allow-listed recipients only |
| DNS | Cloudflare zone `boringtalks.lol`, all records DNS-only | | |

Google sign-in uses the site's own domain as Firebase's auth domain: `next.config.ts` proxies
`/__/auth/*` to `boringtalks-fe45f.firebaseapp.com`, and the OAuth client
"Web client (auto created by Google Service)" in Google Cloud lists
`https://boringtalks.lol/__/auth/handler` and `https://dev.boringtalks.lol/__/auth/handler` as
authorized redirect URIs. A new domain needs its handler added there first, or Google answers
`redirect_uri_mismatch`.

Firebase's emails (password reset) link to our own page: Firebase console › Authentication ›
Templates › Password reset › edit › **Customize action URL** = `https://boringtalks.lol/auth/action`.
It is one setting for the shared project, so dev resets open on boringtalks.lol too and the page
sends them back to dev to sign in. Without it the links point at `boringtalks-fe45f.firebaseapp.com`.
Set it only once production serves `/auth/action` (it ships with the Windows-app PR), or every
reset link 404s.

**Email deliverability** (what keeps `hello@send.boringtalks.lol` out of spam):

- Resend domain `send.boringtalks.lol` (eu-west-1): DKIM at `resend._domainkey.send`, the bounce
  domain `send.send.boringtalks.lol` (MX + SPF), open/click tracking **off** (rewritten links hurt
  deliverability), TLS opportunistic.
- DMARC on the zone (subdomains inherit it): `v=DMARC1; p=quarantine; sp=quarantine; adkim=r;
  aspf=r; pct=100; rua=mailto:…@dmarc-reports.cloudflare.net`. Resend's mail passes it (DKIM and
  SPF align with the From domain); nothing else sends as `boringtalks.lol`. Reports arrive in
  Cloudflare › Email › DMARC Management; check them before tightening to `p=reject`.
- Replies: `EMAIL_REPLY_TO` (default `hello@boringtalks.lol`). The sending subdomain receives no
  mail; Cloudflare Email Routing's catch-all forwards `@boringtalks.lol` to the owner's inbox.
- Not done: BIMI (needs a VMC certificate for Gmail), a dedicated IP (Resend's shared pool is
  fine at this volume), Google Postmaster Tools / Microsoft SNDS sign-ups (owner's accounts).
  Firebase's own emails (password reset) still come from `noreply@boringtalks-fe45f.firebaseapp.com`;
  Firebase console › Authentication › Templates › **Customize domain** moves them to
  `boringtalks.lol` (it asks for DNS records to add in Cloudflare).

One R2 bucket holds every environment under its own prefix. An R2 custom domain exposes the whole
bucket, so a URL-rewrite rule on `download.boringtalks.lol` prepends `/downloads` to every path:
the public domain can only ever reach the `downloads/` folder, never meeting audio or transcripts.

## Configuration

**Railway** (per environment, shared variables referenced by both services): `DATABASE_URL`,
`REDIS_URL` (references to the Postgres/Redis services), `NODE_ENV`, `WEB_URL`, `WEB_ORIGINS`,
`FIREBASE_PROJECT_ID`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_KEY_PREFIX` (`prod/` / `dev/`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`DOWNLOADS_BASE_URL`, `AI_GATEWAY_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO`, `EMAIL_ALLOWLIST` (dev),
`SUMMARIZE_CONCURRENCY`, optional `REPORTS_NOTIFY_EMAIL` (where Mac problem reports are announced; unset today), `ADMIN_EMAILS` (owners: dashboard accounts that are always admins; more admins are added on the dashboard),
optional `POSTHOG_KEY` (product analytics from the API and worker; none = off), `POSTHOG_HOST` (EU cloud by default) and `POSTHOG_PROJECT_URL` (the admin overview links to it). CI sets `GIT_SHA` / `APP_VERSION` before each deploy. Full list:
[apps/api/README.md](../apps/api/README.md#environment).

**Vercel**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` (per environment), `NEXT_PUBLIC_FIREBASE_*`,
optional `NEXT_PUBLIC_POSTHOG_KEY` (product analytics in the browser; the same project key as `POSTHOG_KEY`),
`NEXT_PUBLIC_POSTHOG_UI_HOST` and `POSTHOG_INGEST_HOST` (only for a PostHog other than the EU cloud).
`NEXT_PUBLIC_*` values are built in, so changing one needs a redeploy.

**GitHub** environments `production` and `dev`:

| Secret | Scope | Used by |
|---|---|---|
| `RAILWAY_TOKEN` | per environment (Railway project token for that environment) | deploy |
| `VERCEL_TOKEN` | repository (team-scoped token; dev needs `vercel alias`) | deploy |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | repository (Object R/W on the `boringtalks` bucket) | installer publish (releases are local; kept for CI) |
| `DEVELOPER_ID_P12`, `DEVELOPER_ID_P12_PASSWORD`, `ASC_*` | repository, unused | kept from when CI signed the DMG; releases are local now |

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

# Windows installer (PowerShell)
cd apps/windows; scripts/build.ps1          # → build\BoringTalks-Setup.exe
```

## Versions

The Mac app (`MARKETING_VERSION` in `apps/macos/project.yml`), the API (`apps/api/package.json`, shown by
`/health` through `APP_VERSION`) and the web app (`apps/web/package.json`, shown in the footer and at
`/version.json`) share **major.minor**: a release that adds a feature bumps the minor on all three together,
even if one of them didn't change. Patch numbers may differ (a Mac-only fix ships as 0.4.1 while the API stays
0.4.0). `pnpm check:versions` prints the three and fails when the minors differ; CI runs it on every PR.

## Problem reports

The Mac and Windows apps' "Report a Problem…" posts to `POST /reports`; reports live in the `problem_reports` table.
Admins read them on the dashboard at `/admin/reports`. `ADMIN_EMAILS` on the `api` service lists the
owners (comma-separated; they see **Admin** in the nav and can make other accounts admins there). Without
the dashboard, use the API image's CLI (Railway shell on the `api` service, or locally with `DATABASE_URL`):

```sh
node dist/reports.js                       # the latest 20
node dist/reports.js --user ann@example.com
node dist/reports.js <id>                  # one report with its diagnostics and log
```

Set `REPORTS_NOTIFY_EMAIL` to also get an email for each report (the log is not mailed).

## Rollback

- Web: `vercel rollback` (or promote the previous deployment in the dashboard).
- API/worker: redeploy the previous deployment from the Railway dashboard; migrations are additive.
- DMG: re-run `scripts/publish.sh` with the previous DMG (versioned files stay in the bucket).
- Windows installer: re-run `apps/windows/scripts/publish.ps1` with the previous `BoringTalks-Setup-<version>.exe`.

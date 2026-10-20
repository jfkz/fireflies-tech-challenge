import type { NextConfig } from 'next';
import pkg from './package.json' with { type: 'json' };

const firebaseProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
/** PostHog's ingestion host (EU cloud unless set); its static assets live next to it. */
const posthogHost = (process.env.POSTHOG_INGEST_HOST || 'https://eu.i.posthog.com').replace(/\/+$/, '');
const posthogAssets = posthogHost.replace('://eu.i.', '://eu-assets.i.').replace('://us.i.', '://us-assets.i.');

const nextConfig: NextConfig = {
  // @boringtalks/shared is a CommonJS workspace package; let Next compile it with the app.
  transpilePackages: ['@boringtalks/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  // PostHog's API paths end in a slash; don't redirect them away from it.
  skipTrailingSlashRedirect: true,
  // Shown in the footers and served at /version.json, so an open tab can tell a newer deploy is live.
  // CI passes GITHUB_SHA as a build env (deploy.yml); a local build is "dev".
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_COMMIT: (process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7),
  },
  async rewrites() {
    // Product analytics through our own domain (lib/analytics.ts), so blockers of third-party hosts don't drop it.
    const analytics = [
      { source: '/ingest/static/:path*', destination: `${posthogAssets}/static/:path*` },
      { source: '/ingest/:path*', destination: `${posthogHost}/:path*` },
    ];
    // Firebase Auth's sign-in handler, served from our own domain (see ownAuthDomain in lib/firebase.ts).
    if (!firebaseProject || firebaseProject.startsWith('demo-')) return analytics;
    const origin = `https://${firebaseProject}.firebaseapp.com`;
    return [...analytics, { source: '/__/auth/:path*', destination: `${origin}/__/auth/:path*` }];
  },
};

export default nextConfig;

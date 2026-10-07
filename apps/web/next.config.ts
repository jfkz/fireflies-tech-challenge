import type { NextConfig } from 'next';
import pkg from './package.json' with { type: 'json' };

const firebaseProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const nextConfig: NextConfig = {
  // @boringtalks/shared is a CommonJS workspace package; let Next compile it with the app.
  transpilePackages: ['@boringtalks/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  // Shown in the footers and served at /version.json, so an open tab can tell a newer deploy is live.
  // CI passes GITHUB_SHA as a build env (deploy.yml); a local build is "dev".
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_COMMIT: (process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7),
  },
  // Firebase Auth's sign-in handler, served from our own domain (see ownAuthDomain in lib/firebase.ts).
  async rewrites() {
    if (!firebaseProject || firebaseProject.startsWith('demo-')) return [];
    const origin = `https://${firebaseProject}.firebaseapp.com`;
    return [{ source: '/__/auth/:path*', destination: `${origin}/__/auth/:path*` }];
  },
};

export default nextConfig;

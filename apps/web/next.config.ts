import type { NextConfig } from 'next';

const firebaseProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const nextConfig: NextConfig = {
  // @boringtalks/shared is a CommonJS workspace package; let Next compile it with the app.
  transpilePackages: ['@boringtalks/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  // Firebase Auth's sign-in handler, served from our own domain (see ownAuthDomain in lib/firebase.ts).
  async rewrites() {
    if (!firebaseProject || firebaseProject.startsWith('demo-')) return [];
    const origin = `https://${firebaseProject}.firebaseapp.com`;
    return [
      { source: '/__/auth/:path*', destination: `${origin}/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `${origin}/__/firebase/:path*` },
    ];
  },
};

export default nextConfig;

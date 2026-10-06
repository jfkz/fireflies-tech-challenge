import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @boringtalks/shared is a CommonJS workspace package; let Next compile it with the app.
  transpilePackages: ['@boringtalks/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;

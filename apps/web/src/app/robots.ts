import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

/** Signed-in pages are private; everything public is in the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/meetings', '/tasks', '/calendar', '/record', '/settings', '/connect', '/reset'] }],
    sitemap: `${env.siteUrl}/sitemap.xml`,
    host: env.siteUrl,
  };
}

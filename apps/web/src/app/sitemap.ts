import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/signup', '/signin'].map((path) => ({
    url: `${env.siteUrl}${path}`,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.5,
  }));
}

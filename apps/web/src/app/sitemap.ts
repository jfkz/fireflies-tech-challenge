import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

const PAGES: readonly { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' }[] = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/signup', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/signin', priority: 0.4, changeFrequency: 'monthly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PAGES.map(({ path, priority, changeFrequency }) => ({ url: `${env.siteUrl}${path}`, lastModified, changeFrequency, priority }));
}

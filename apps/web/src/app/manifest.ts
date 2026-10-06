import type { MetadataRoute } from 'next';
import { DESCRIPTION, SITE_NAME } from '@/lib/landing/seo';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: DESCRIPTION,
    start_url: '/meetings',
    display: 'standalone',
    background_color: '#5b67f5',
    theme_color: '#5b67f5',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' },
    ],
  };
}

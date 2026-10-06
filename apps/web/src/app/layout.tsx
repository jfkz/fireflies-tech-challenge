import type { Metadata, Viewport } from 'next';
import { Bagel_Fat_One, Nunito } from 'next/font/google';
import { Providers } from '@/components/providers/Providers';
import { env } from '@/lib/env';
import './globals.css';

const bagel = Bagel_Fat_One({ weight: '400', subsets: ['latin'], variable: '--font-bagel', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito', display: 'swap' });

const description =
  'BoringTalks records your meetings on your Mac, transcribes them on-device, and writes the title, summary, action items and decisions for you. You can keep nodding.';

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: 'BoringTalks: meeting notes nobody had to take', template: '%s · BoringTalks' },
  description,
  applicationName: 'BoringTalks',
  keywords: ['meeting notes', 'meeting transcription', 'AI meeting summary', 'macOS', 'action items', 'on-device transcription'],
  openGraph: {
    type: 'website',
    siteName: 'BoringTalks',
    title: 'BoringTalks: meeting notes nobody had to take',
    description,
    url: '/',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: 'BoringTalks: meeting notes nobody had to take', description },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: '#5b67f5',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bagel.variable} ${nunito.variable}`} data-scroll-behavior="smooth">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

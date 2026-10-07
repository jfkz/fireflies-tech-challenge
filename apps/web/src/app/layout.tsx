import type { Metadata, Viewport } from 'next';
import { Bagel_Fat_One, Nunito } from 'next/font/google';
import { UpdatePrompt } from '@/components/app/UpdatePrompt';
import { Providers } from '@/components/providers/Providers';
import { env } from '@/lib/env';
import { DESCRIPTION, SITE_NAME } from '@/lib/landing/seo';
import './globals.css';

const bagel = Bagel_Fat_One({ weight: '400', subsets: ['latin'], variable: '--font-bagel', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito', display: 'swap' });

const title = `${SITE_NAME}: meeting notes nobody had to take`;

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: title, template: `%s · ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  category: 'productivity',
  creator: SITE_NAME,
  keywords: [
    'meeting notes',
    'AI meeting notes',
    'meeting transcription',
    'meeting summary',
    'action items',
    'meeting recorder for Mac',
    'notetaker without a bot',
    'Zoom notes',
    'Google Meet notes',
    'Microsoft Teams notes',
  ],
  openGraph: { type: 'website', siteName: SITE_NAME, title, description: DESCRIPTION, url: '/', locale: 'en_US' },
  twitter: { card: 'summary_large_image', title, description: DESCRIPTION },
  alternates: { canonical: '/' },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: '#5b67f5',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bagel.variable} ${nunito.variable}`} data-scroll-behavior="smooth">
      <body>
        <Providers>
          {children}
          <UpdatePrompt />
        </Providers>
      </body>
    </html>
  );
}

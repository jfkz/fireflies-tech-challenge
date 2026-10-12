import { env } from '@/lib/env';
import { FAQ } from './faq';

export const SITE_NAME = 'BoringTalks';
export const TAGLINE = 'Your meeting, minus the meeting.';
export const DESCRIPTION =
  'BoringTalks records your calls on your Mac or PC and hands you a title that means something, a short summary, who said what by name, and every task with its owner and due date. No bot joins the call. Free.';
/** Always the newest builds: the publish scripts keep these files pointing at the latest DMG and installer. */
export const DMG_URL = 'https://download.boringtalks.lol/BoringTalks-latest.dmg';
export const EXE_URL = 'https://download.boringtalks.lol/BoringTalks-Setup-latest.exe';

/** schema.org data for the landing page: the app, who makes it, and the FAQ. */
export function landingJsonLd() {
  const site = env.siteUrl;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${site}/#org`,
        name: SITE_NAME,
        url: site,
        logo: `${site}/icon.svg`,
      },
      {
        '@type': 'WebSite',
        '@id': `${site}/#website`,
        name: SITE_NAME,
        url: site,
        publisher: { '@id': `${site}/#org` },
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        description: DESCRIPTION,
        url: site,
        operatingSystem: 'macOS 26, Windows 10, Windows 11',
        applicationCategory: 'BusinessApplication',
        downloadUrl: [DMG_URL, EXE_URL],
        image: `${site}/opengraph-image`,
        publisher: { '@id': `${site}/#org` },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: [
          'Records any meeting app from the Mac menu bar or the Windows tray, no bot joins',
          'Speaker names picked up from the conversation',
          'Meaningful titles, summaries, decisions',
          'Tasks with owners and due dates across all meetings',
          'Calendar of time spent in meetings',
          'Record or upload in the browser',
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  };
}

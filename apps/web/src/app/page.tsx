import dynamic from 'next/dynamic';
import { SiteFooter } from '@/components/brand/SiteFooter';
import { LandingNav } from '@/components/landing/LandingNav';
import { MeetingStory } from '@/components/landing/MeetingStory';

// Below the fold: split into their own chunks; still server-rendered for content and SEO.
const HowItWorks = dynamic(() => import('@/components/landing/HowItWorks').then((m) => m.HowItWorks));
const WakeUp = dynamic(() => import('@/components/landing/WakeUp').then((m) => m.WakeUp));
const Receipt = dynamic(() => import('@/components/landing/Receipt').then((m) => m.Receipt));
const DownloadSection = dynamic(() => import('@/components/landing/DownloadSection').then((m) => m.DownloadSection));
const FinalCta = dynamic(() => import('@/components/landing/FinalCta').then((m) => m.FinalCta));

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'BoringTalks',
  operatingSystem: 'macOS 26',
  applicationCategory: 'BusinessApplication',
  description: 'Records meetings on your Mac, transcribes them on-device and writes the summary, action items and decisions.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function Home() {
  return (
    <>
      <LandingNav />
      <main>
        <MeetingStory />
        <HowItWorks />
        <WakeUp />
        <Receipt />
        <DownloadSection />
        <FinalCta />
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}

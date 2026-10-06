import dynamic from 'next/dynamic';
import { SiteFooter } from '@/components/brand/SiteFooter';
import { LandingNav } from '@/components/landing/LandingNav';
import { MeetingStory } from '@/components/landing/MeetingStory';
import { SoundProvider, SoundToggle } from '@/components/landing/Sound';
import { landingJsonLd } from '@/lib/landing/seo';

// Below the fold: split into their own chunks; still server-rendered for content and SEO.
const HowItWorks = dynamic(() => import('@/components/landing/HowItWorks').then((m) => m.HowItWorks));
const WakeUp = dynamic(() => import('@/components/landing/WakeUp').then((m) => m.WakeUp));
const WhatYouGet = dynamic(() => import('@/components/landing/WhatYouGet').then((m) => m.WhatYouGet));
const DownloadSection = dynamic(() => import('@/components/landing/DownloadSection').then((m) => m.DownloadSection));
const Faq = dynamic(() => import('@/components/landing/Faq').then((m) => m.Faq));
const FinalCta = dynamic(() => import('@/components/landing/FinalCta').then((m) => m.FinalCta));

export default function Home() {
  return (
    <SoundProvider>
      <LandingNav />
      <main>
        <MeetingStory />
        <HowItWorks />
        <WakeUp />
        <WhatYouGet />
        <DownloadSection />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <SoundToggle />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(landingJsonLd()).replace(/</g, '\\u003c') }} />
    </SoundProvider>
  );
}

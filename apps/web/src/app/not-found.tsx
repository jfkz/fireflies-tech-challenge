import type { Metadata } from 'next';
import Link from 'next/link';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { Logo } from '@/components/brand/Logo';
import { MEN } from '@/lib/avatar/styles';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col bg-call px-5 py-5 text-white sm:px-8">
      <Logo tone="white" />
      <main className="mx-auto my-auto grid max-w-4xl items-center gap-10 py-12 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-display text-8xl leading-none text-sun sm:text-9xl">404</p>
          <h1 className="font-display mt-4 text-4xl leading-tight sm:text-5xl">This page left the meeting early.</h1>
          <p className="mt-4 max-w-[46ch] text-lg font-semibold text-white/90">
            The link is broken or the page moved. Nobody took notes, so we can’t tell you where it went.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/" className="btn btn-primary btn-lg">
              Back to the start
            </Link>
            <Link href="/meetings" className="btn btn-secondary btn-lg">
              My meetings
            </Link>
          </div>
        </div>
        <div className="relative mx-auto w-[min(70vw,280px)]">
          <div className="absolute right-[45%] bottom-[88%] z-10 w-max text-ink">
            <SpeechBubble side="right">Wait, which call is this?</SpeechBubble>
          </div>
          <TalkingHead style={MEN[2]} emotion="surprised" look="wander" seed={404} label="A confused head looking around" className="aspect-square w-full" />
        </div>
      </main>
    </div>
  );
}

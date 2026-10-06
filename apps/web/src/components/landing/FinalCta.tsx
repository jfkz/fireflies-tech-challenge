import Link from 'next/link';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { TALKER } from '@/lib/avatar/styles';

/** Last call: one head, one line, one button. */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden bg-paper px-5 pt-24 sm:pt-32">
      <div className="mx-auto grid max-w-[1050px] items-end gap-10 lg:grid-cols-[1fr_auto]">
        <div className="pb-16 lg:pb-24">
          <h2 id="cta-title" className="font-display max-w-[15ch] text-[2.7rem] leading-[1] text-ink sm:text-6xl lg:text-7xl">
            Skip the next meeting. Read it instead.
          </h2>
          <p className="mt-5 max-w-[48ch] text-lg leading-relaxed font-semibold text-ink-soft">
            Make an account, and there’s already a demo meeting waiting with its summary, so you can see what you’re getting before you record
            anything.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/signup" className="btn btn-primary btn-lg">
              Create your account
            </Link>
            <Link href="/signin" className="btn btn-secondary btn-lg">
              Sign in
            </Link>
          </div>
        </div>
        <div className="relative mx-auto w-[min(70vw,300px)] self-end">
          <div className="absolute right-[52%] bottom-[90%] z-10 w-max max-w-[46vw] sm:max-w-none">
            <SpeechBubble side="right">This meeting could have been a summary.</SpeechBubble>
          </div>
          <TalkingHead style={TALKER} talking look="cursor" seed={77} className="aspect-square w-full" />
        </div>
      </div>
    </section>
  );
}

import { FAQ } from '@/lib/landing/faq';

/** Questions people ask before trying it, as native disclosure widgets (no JS needed). */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-4 bg-sun-soft px-5 py-24 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[860px]">
        <h2 id="faq-title" className="font-display text-[2.5rem] leading-[1.02] text-ink sm:text-6xl">
          Questions, asked before the meeting
        </h2>
        <div className="mt-10 space-y-3">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group rounded-[20px] border-[2.5px] border-ink bg-white shadow-[4px_5px_0_0_var(--color-ink)] open:bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-lg font-extrabold text-ink sm:px-6 [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  className="font-display grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun text-lg leading-none transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="px-5 pb-5 leading-relaxed font-semibold text-ink-soft sm:px-6">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

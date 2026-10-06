import type { Part } from '@/lib/search';

/** Text with the parts that matched a search marked. */
export function Marked({ parts }: { parts: readonly Part[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[4px] bg-sun px-0.5 text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

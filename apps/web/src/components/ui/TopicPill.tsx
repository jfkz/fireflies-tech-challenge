/** A topic tag, the same look wherever it's shown; `active` when the list is filtered by it. */
export function TopicPill({ topic, active = false }: { topic: string; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-extrabold text-ink ${
        active ? 'bg-sun' : 'bg-call-light'
      }`}
    >
      <span aria-hidden className="opacity-60">
        #
      </span>
      {topic}
    </span>
  );
}

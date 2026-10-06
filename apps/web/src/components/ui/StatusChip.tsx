import type { MeetingStatus } from '@boringtalks/shared';
import { isProcessing, STATUS_LABEL } from '@/lib/status';

const TONE: Record<MeetingStatus, string> = {
  recording: 'bg-rose text-ink',
  uploaded: 'bg-call-light text-ink',
  transcribing: 'bg-call-light text-ink',
  summarizing: 'bg-sun text-ink',
  ready: 'bg-mint-soft text-ink',
  failed: 'bg-danger text-white',
};

export function StatusChip({ status, className = '' }: { status: MeetingStatus; className?: string }) {
  const busy = isProcessing(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-extrabold whitespace-nowrap ${TONE[status]} ${className}`}
      data-status={status}
    >
      {busy ? (
        <span className="flex gap-0.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-ink" style={{ animationDelay: `${i * 0.18}s` }} />
          ))}
        </span>
      ) : status === 'failed' ? (
        <span aria-hidden>!</span>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
          <path d="M3 8.5L6.5 12L13 4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

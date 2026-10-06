'use client';

import { formatDuration, formatTimestamp, mergeSegments, type ActionItem, type MeetingDetail, type MeetingStatus } from '@boringtalks/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar/Avatar';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SpeakerChip, speakerColor } from '@/components/ui/SpeakerChip';
import { StatusChip } from '@/components/ui/StatusChip';
import { useDeleteMeeting, useMeeting, useReprocessMeeting, useUpdateMeeting } from '@/hooks/queries';
import { useAudioSync } from '@/hooks/useAudioSync';
import { ApiRequestError } from '@/lib/api';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER, MEN } from '@/lib/avatar/styles';
import { formatMeetingDate } from '@/lib/format';
import { summaryToMarkdown } from '@/lib/markdown';
import { isProcessing, STATUS_QUIP } from '@/lib/status';

export function MeetingView({ id }: { id: string }) {
  const meeting = useMeeting(id);

  if (meeting.isPending) return <DetailSkeleton />;
  if (meeting.isError) {
    const notFound = meeting.error instanceof ApiRequestError && (meeting.error.status === 404 || meeting.error.status === 400);
    return notFound ? <MeetingNotFound /> : <ErrorNote onRetry={() => meeting.refetch()}>{meeting.error.message}</ErrorNote>;
  }
  return <MeetingDetailView meeting={meeting.data} />;
}

function MeetingDetailView({ meeting: m }: { meeting: MeetingDetail }) {
  const segments = useMemo(() => mergeSegments(m.segments), [m.segments]);
  const processing = isProcessing(m.status);

  return (
    <article>
      <Link href="/meetings" className="inline-flex items-center gap-1.5 rounded-full text-sm font-extrabold text-ink-soft hover:text-ink">
        <span aria-hidden>←</span> All meetings
      </Link>
      <Header meeting={m} />
      {processing && <ProcessingBanner status={m.status} />}
      {m.status === 'failed' && <FailedBanner meeting={m} />}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="space-y-8">
          {m.summary ? (
            <>
              <Section title="Summary">
                <div className="space-y-3 text-[1.05rem] leading-relaxed font-semibold text-ink">
                  {m.summary.summary
                    .split(/\n{2,}/)
                    .filter(Boolean)
                    .map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                </div>
              </Section>
              {m.summary.keyTopics.length > 0 && (
                <Section title="Key topics">
                  <ul className="flex flex-wrap gap-2">
                    {m.summary.keyTopics.map((t) => (
                      <li key={t} className="rounded-full border-2 border-ink bg-call-light px-3 py-1 text-sm font-extrabold">
                        {t}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              <ActionItems meeting={m} />
              {m.summary.decisions.length > 0 && (
                <Section title="Decisions">
                  <ul className="space-y-2">
                    {m.summary.decisions.map((d) => (
                      <li key={d} className="flex gap-3 font-semibold">
                        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun text-xs font-extrabold" aria-hidden>
                          ✓
                        </span>
                        {d}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {m.summary.model && <p className="text-xs font-bold text-ink-soft/80">Written by {m.summary.model}. It can be wrong; the transcript is the source.</p>}
            </>
          ) : (
            !processing && (
              <Section title="Summary">
                <p className="font-semibold text-ink-soft">There is no summary for this meeting yet.</p>
              </Section>
            )
          )}
        </div>
        <TranscriptPanel meeting={m} segments={segments} />
      </div>
    </article>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="sticker p-5 sm:p-6" aria-label={title}>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-display mr-auto text-2xl leading-none">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Header({ meeting: m }: { meeting: MeetingDetail }) {
  const router = useRouter();
  const del = useDeleteMeeting();
  const reprocess = useReprocessMeeting(m.id);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(summaryToMarkdown(m));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <header className="mt-4">
      <EditableTitle meeting={m} />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-bold text-ink-soft">
        <time dateTime={m.startedAt}>{formatMeetingDate(m.startedAt)}</time>
        <span>{formatDuration(m.durationSec)}</span>
        <StatusChip status={m.status} />
        {m.source === 'demo' && <span className="rounded-full bg-call-light px-2 py-0.5 text-xs font-extrabold text-ink">Demo meeting</span>}
      </div>
      {m.description && <p className="mt-3 max-w-[70ch] text-lg leading-relaxed font-semibold text-ink-soft">{m.description}</p>}
      {m.speakers.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Speakers">
          {m.speakers.map((s) => (
            <li key={s}>
              <SpeakerChip name={s} size="md" />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap gap-2.5">
        {m.summary && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy} aria-live="polite">
            {copied ? 'Copied' : 'Copy summary as Markdown'}
          </button>
        )}
        {m.status === 'failed' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}>
            {reprocess.isPending ? 'Starting…' : 'Reprocess'}
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-sm text-danger" onClick={() => setConfirming(true)}>
          Delete
        </button>
      </div>
      {reprocess.isError && (
        <div className="mt-3">
          <ErrorNote>{reprocess.error.message}</ErrorNote>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Delete this meeting?"
        confirmLabel="Delete meeting"
        busy={del.isPending}
        error={del.isError ? del.error.message : null}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          del.mutate(m.id, {
            onSuccess: () => {
              setConfirming(false);
              router.replace('/meetings');
            },
          })
        }
      >
        “{m.title}”, its transcript, summary and audio will be gone for good.
      </ConfirmDialog>
    </header>
  );
}

function EditableTitle({ meeting: m }: { meeting: MeetingDetail }) {
  const update = useUpdateMeeting(m.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function save() {
    const title = draft.trim();
    setEditing(false);
    if (!title || title === m.title) return;
    update.mutate({ title });
  }

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor="meeting-title" className="sr-only">
          Meeting title
        </label>
        <input
          id="meeting-title"
          ref={input}
          className="field font-display text-2xl sm:text-4xl"
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(m.title);
              setEditing(false);
            }
          }}
        />
      </form>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <h1 className="font-display text-3xl leading-[1.05] text-ink sm:text-[2.6rem]">{m.title}</h1>
      <button
        type="button"
        className="btn btn-ghost btn-sm mt-1 shrink-0 px-2"
        onClick={() => {
          setDraft(m.title);
          setEditing(true);
        }}
        aria-label="Rename meeting"
        title="Rename"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
        </svg>
      </button>
      {update.isError && <span role="alert" className="sr-only">Renaming failed: {update.error.message}</span>}
    </div>
  );
}

const PIPELINE: { status: MeetingStatus; label: string }[] = [
  { status: 'uploaded', label: 'Uploaded' },
  { status: 'transcribing', label: 'Transcribing' },
  { status: 'summarizing', label: 'Summarizing' },
  { status: 'ready', label: 'Ready' },
];

export function ProcessingBanner({ status }: { status: MeetingStatus }) {
  const order = ['recording', 'uploaded', 'transcribing', 'summarizing', 'ready'];
  const at = order.indexOf(status);
  return (
    <div className="sticker mt-6 flex flex-col items-center gap-4 overflow-hidden bg-sun-soft p-5 sm:flex-row sm:p-6" role="status" aria-live="polite" data-testid="processing-banner">
      <div className="relative shrink-0">
        <TalkingHead style={MEN[0]} yawning={status === 'transcribing'} talking={status === 'summarizing'} look={1} seed={9} className="h-28 w-28" />
      </div>
      <div className="min-w-0 flex-1">
        <SpeechBubble tail={false}>{STATUS_QUIP[status]}</SpeechBubble>
        <ol className="mt-4 flex flex-wrap gap-2 text-sm font-extrabold" aria-label="Progress">
          {PIPELINE.map((step) => {
            const i = order.indexOf(step.status);
            const state = i < at ? 'done' : i === at ? 'now' : 'later';
            return (
              <li
                key={step.status}
                className={`rounded-full border-2 px-3 py-1 ${
                  state === 'done' ? 'border-ink bg-mint-soft' : state === 'now' ? 'border-ink bg-white' : 'border-ink/20 text-ink-soft'
                }`}
                aria-current={state === 'now' ? 'step' : undefined}
              >
                {state === 'done' ? '✓ ' : ''}
                {step.label}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-sm font-semibold text-ink-soft">This page updates by itself. You can leave and come back.</p>
      </div>
    </div>
  );
}

function FailedBanner({ meeting: m }: { meeting: MeetingDetail }) {
  return (
    <div className="mt-6 flex flex-col gap-4 rounded-[22px] border-[2.5px] border-danger bg-danger-soft p-5 sm:flex-row sm:items-center" role="alert">
      <Avatar style={LISTENER} pose={stillPose({ emotion: 'scared' })} className="h-24 w-24 shrink-0" />
      <div>
        <p className="text-lg font-extrabold text-danger">Processing failed</p>
        <p className="mt-1 font-semibold text-ink">{m.error ?? 'Something went wrong while processing this meeting.'}</p>
        <p className="mt-1 text-sm font-semibold text-ink-soft">Reprocess runs transcription and the summary again from the saved recording.</p>
      </div>
    </div>
  );
}

function ActionItems({ meeting: m }: { meeting: MeetingDetail }) {
  const update = useUpdateMeeting(m.id);
  const items = m.summary?.actionItems ?? [];
  const done = items.filter((a) => a.done).length;
  return (
    <Section title="Action items" action={items.length > 0 && <span className="text-sm font-extrabold text-ink-soft">{done} of {items.length} done</span>}>
      {items.length === 0 ? (
        <p className="font-semibold text-ink-soft">Nobody promised anything. Suspicious, but fine.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => (
            <ActionItemRow key={a.id} item={a} onToggle={(next) => update.mutate({ actionItem: { id: a.id, done: next } })} />
          ))}
        </ul>
      )}
      {update.isError && (
        <div className="mt-3">
          <ErrorNote>{update.error.message}</ErrorNote>
        </div>
      )}
    </Section>
  );
}

function ActionItemRow({ item, onToggle }: { item: ActionItem; onToggle(next: boolean): void }) {
  const id = `ai-${item.id}`;
  return (
    <li className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={item.done}
        onChange={(e) => onToggle(e.target.checked)}
        className="check mt-1"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className={`font-bold ${item.done ? 'text-ink-soft line-through decoration-2' : 'text-ink'}`}>{item.text}</span>
        {(item.owner || item.due) && (
          <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-extrabold">
            {item.owner && <span className="rounded-full bg-paper px-2 py-0.5 text-ink">{item.owner}</span>}
            {item.due && <span className="rounded-full bg-sun-soft px-2 py-0.5 text-ink">Due {item.due}</span>}
          </span>
        )}
      </label>
    </li>
  );
}

function TranscriptPanel({ meeting: m, segments }: { meeting: MeetingDetail; segments: ReturnType<typeof mergeSegments> }) {
  const { ref, activeIndex, seek } = useAudioSync(segments);
  const list = useRef<HTMLOListElement>(null);
  const hasAudio = !!m.audioUrl;

  // Keep the playing segment in view inside the transcript box.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <section className="sticker overflow-hidden lg:sticky lg:top-24" aria-label="Transcript">
      <div className="border-b-[2.5px] border-ink bg-paper p-4">
        <h2 className="font-display text-2xl leading-none">Transcript</h2>
        {hasAudio ? (
          <audio ref={ref} src={m.audioUrl ?? undefined} controls preload="metadata" className="mt-3 w-full" data-testid="meeting-audio">
            Your browser can’t play this recording.
          </audio>
        ) : (
          <p className="mt-2 text-sm font-semibold text-ink-soft">No audio was kept for this meeting, only the text.</p>
        )}
      </div>
      {segments.length === 0 ? (
        <p className="p-5 font-semibold text-ink-soft">{isProcessing(m.status) ? 'The transcript shows up here once it’s ready.' : 'Nobody said anything. A true miracle.'}</p>
      ) : (
        <ol ref={list} className="max-h-[70svh] space-y-1 overflow-y-auto p-3" data-testid="transcript">
          {segments.map((s, i) => {
            const active = i === activeIndex;
            const content = (
              <>
                <span className="flex items-baseline gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink">
                    <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink" style={{ background: speakerColor(s.speaker) }} aria-hidden />
                    {s.speaker}
                  </span>
                  <span className="text-xs font-bold text-ink-soft tabular-nums">{formatTimestamp(s.startMs)}</span>
                </span>
                <span className="mt-0.5 block leading-relaxed font-semibold text-ink">{s.text}</span>
              </>
            );
            return (
              <li key={`${s.startMs}-${i}`} data-index={i} data-active={active || undefined}>
                {hasAudio ? (
                  <button
                    type="button"
                    onClick={() => seek(s.startMs)}
                    className={`w-full rounded-2xl border-2 px-3 py-2 text-left transition-colors ${active ? 'border-ink bg-sun-soft' : 'border-transparent hover:bg-paper'}`}
                    aria-current={active ? 'true' : undefined}
                    aria-label={`Play from ${formatTimestamp(s.startMs)}: ${s.speaker}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="rounded-2xl px-3 py-2">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading meeting">
      <div className="h-4 w-28 animate-pulse rounded-full bg-call-light/60" />
      <div className="mt-5 h-10 w-3/4 animate-pulse rounded-full bg-call-light/60" />
      <div className="mt-4 h-4 w-60 animate-pulse rounded-full bg-white" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[7fr_5fr]">
        <div className="sticker h-72 animate-pulse" />
        <div className="sticker h-96 animate-pulse" />
      </div>
    </div>
  );
}

export function MeetingNotFound() {
  return (
    <div className="sticker flex flex-col items-center px-6 py-14 text-center">
      <Avatar style={LISTENER} pose={stillPose({ emotion: 'surprised' })} look={-1} className="h-32 w-32" />
      <h1 className="font-display mt-4 text-3xl">This meeting isn’t here</h1>
      <p className="mt-2 max-w-[44ch] font-semibold text-ink-soft">It was deleted, or it belongs to someone else. Either way, you didn’t miss anything.</p>
      <Link href="/meetings" className="btn btn-primary mt-6">
        Back to meetings
      </Link>
    </div>
  );
}

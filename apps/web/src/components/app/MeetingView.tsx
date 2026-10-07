'use client';

import { formatDuration, formatTimestamp, mergeSegments, segmentAt, type ActionItem, type MeetingDetail, type MeetingStatus } from '@boringtalks/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar/Avatar';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SpeakerChip, speakerColor } from '@/components/ui/SpeakerChip';
import { Marked } from '@/components/ui/Marked';
import { StatusChip } from '@/components/ui/StatusChip';
import { TopicPill } from '@/components/ui/TopicPill';
import { useDeleteMeeting, useLeaveBot, useMeeting, useReprocessMeeting, useUpdateMeeting } from '@/hooks/queries';
import { useAudioSync } from '@/hooks/useAudioSync';
import { ApiRequestError } from '@/lib/api';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER, MEN } from '@/lib/avatar/styles';
import { meetingsHref } from '@/lib/filters';
import { formatDay, todayKey } from '@/lib/dates';
import { formatMeetingDate } from '@/lib/format';
import { hasMatch, highlightParts, searchTerms } from '@/lib/search';
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
      {m.bot && m.status === 'recording' ? <BotBanner meeting={m} /> : processing && <ProcessingBanner status={m.status} />}
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
              {m.summary.model && <p className="text-xs font-bold text-ink-soft/80">Written by AI. It can be wrong; the transcript is the source.</p>}
            </>
          ) : (
            !processing && (
              <Section title="Summary">
                <p className="font-semibold text-ink-soft">There is no summary for this meeting yet.</p>
              </Section>
            )
          )}
        </div>
        {/* Transcript, then the key topics under it; together they stay in view while the summary scrolls. */}
        <div className="space-y-6 lg:sticky lg:top-24">
          <TranscriptPanel meeting={m} segments={segments} />
          {m.summary && m.summary.keyTopics.length > 0 && (
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
        </div>
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
      <SpeakersAndTopics meeting={m} />
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

/** Speaker chips and topic pills that open the meeting list filtered by them, plus renaming speakers. */
function SpeakersAndTopics({ meeting: m }: { meeting: MeetingDetail }) {
  const [renaming, setRenaming] = useState(false);
  if (m.speakers.length === 0 && m.topics.length === 0) return null;
  return (
    <div className="mt-3">
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Speakers and topics">
        {m.speakers.map((s) => (
          <li key={`s:${s}`}>
            <Link href={meetingsHref({ speaker: s })} className="rounded-full" title={`All meetings with ${s}`}>
              <SpeakerChip name={s} size="md" />
            </Link>
          </li>
        ))}
        {m.topics.map((t) => (
          <li key={`t:${t}`}>
            <Link href={meetingsHref({ topic: t })} className="rounded-full" title={`All meetings about ${t}`}>
              <TopicPill topic={t} />
            </Link>
          </li>
        ))}
        {m.speakers.length > 0 && !renaming && (
          <li>
            <button type="button" className="ml-1 text-sm font-extrabold text-call-deep underline underline-offset-2" onClick={() => setRenaming(true)}>
              Rename speakers
            </button>
          </li>
        )}
      </ul>
      {renaming && <SpeakerEditor meeting={m} onDone={() => setRenaming(false)} />}
    </div>
  );
}

/** One field per speaker; saves only the names that changed. Two speakers given one name become one person. */
export function SpeakerEditor({ meeting: m, onDone }: { meeting: MeetingDetail; onDone: () => void }) {
  const update = useUpdateMeeting(m.id);
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(m.speakers.map((s) => [s, s])));
  const changes = Object.fromEntries(Object.entries(names).filter(([from, to]) => to.trim() && to.trim() !== from).map(([from, to]) => [from, to.trim()]));

  return (
    <form
      className="sticker mt-3 max-w-xl space-y-3 p-4"
      aria-label="Rename speakers"
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(changes).length === 0) return onDone();
        update.mutate({ speakers: changes }, { onSuccess: onDone });
      }}
    >
      <p className="text-sm font-semibold text-ink-soft">Names were picked up from the conversation. Fix any that are wrong; your names are kept even if the meeting is processed again.</p>
      {m.speakers.map((s, i) => (
        <div key={s} className="flex items-center gap-3">
          <label htmlFor={`speaker-${i}`} className="w-32 shrink-0 truncate text-sm font-extrabold" title={s}>
            {s}
          </label>
          <input
            id={`speaker-${i}`}
            className="field py-1.5"
            value={names[s] ?? s}
            maxLength={80}
            onChange={(e) => setNames((n) => ({ ...n, [s]: e.target.value }))}
          />
        </div>
      ))}
      {update.isError && <ErrorNote>{update.error.message}</ErrorNote>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save names'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
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

/** What the meeting bot is doing, while it's on its way, in the call, or just left. */
const BOT_LINE: Record<NonNullable<MeetingDetail['bot']>['status'], string> = {
  scheduled: 'The notetaker will join at the time you picked.',
  joining: 'The notetaker is joining the call…',
  waiting_room: 'The notetaker is in the waiting room. Someone in the call needs to let “BoringTalks Notetaker” in.',
  in_call: 'The notetaker is in the call and about to start recording.',
  recording: 'The notetaker is in the call, recording.',
  left: 'The notetaker left the call. The transcript arrives in a few minutes, then the notes.',
  done: 'The notetaker left the call. The transcript arrives in a few minutes, then the notes.',
  failed: 'The notetaker couldn’t record this meeting.',
};

function BotBanner({ meeting: m }: { meeting: MeetingDetail }) {
  const leave = useLeaveBot(m.id);
  const bot = m.bot!;
  const inCall = ['joining', 'waiting_room', 'in_call', 'recording', 'scheduled'].includes(bot.status);
  return (
    <div className="sticker mt-6 flex flex-col items-center gap-4 overflow-hidden bg-call-light/50 p-5 sm:flex-row sm:p-6" role="status" aria-live="polite" data-testid="bot-banner">
      <TalkingHead style={MEN[1]} talking={bot.status === 'recording'} look={-1} seed={11} className="h-24 w-24 shrink-0" />
      <div className="min-w-0 flex-1">
        <SpeechBubble tail={false}>
          {BOT_LINE[bot.status]}
          {bot.status === 'scheduled' && bot.joinAt && <> ({new Date(bot.joinAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})</>}
        </SpeechBubble>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold text-ink-soft">
          <a href={bot.meetingUrl} target="_blank" rel="noreferrer" className="truncate font-extrabold text-call-deep underline underline-offset-2">
            Open the meeting
          </a>
          {inCall && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => leave.mutate()} disabled={leave.isPending}>
              {leave.isPending ? 'Calling it back…' : bot.status === 'scheduled' ? 'Cancel the notetaker' : 'Make it leave'}
            </button>
          )}
        </div>
        {leave.isError && (
          <div className="mt-3">
            <ErrorNote>{leave.error.message}</ErrorNote>
          </div>
        )}
      </div>
    </div>
  );
}

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
  useHighlightHashTarget(items.length > 0);
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
    // `task-<id>` is the anchor the tasks page links to; arriving there highlights the row for a moment.
    <li
      id={`task-${item.id}`}
      className="-mx-2 flex scroll-mt-28 items-start gap-3 rounded-xl px-2 py-1 transition-colors duration-700 data-[highlight=true]:bg-sun-soft data-[highlight=true]:ring-2 data-[highlight=true]:ring-ink"
    >
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
            {item.due && (
              <span className="rounded-full bg-sun-soft px-2 py-0.5 text-ink">
                Due {item.due}
                {item.dueDate && <span className="font-bold text-ink-soft"> · {formatDay(item.dueDate, todayKey())}</span>}
              </span>
            )}
          </span>
        )}
      </label>
    </li>
  );
}

/**
 * The meeting loads after navigation, so the browser's own jump to `#task-…` finds
 * nothing. Once the items are on the page, scroll to that one and flash it.
 */
function useHighlightHashTarget(ready: boolean) {
  useEffect(() => {
    if (!ready || !window.location.hash.startsWith('#task-')) return;
    const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el.dataset.highlight = 'true';
    const off = setTimeout(() => {
      el.dataset.highlight = 'false';
    }, 2500);
    return () => clearTimeout(off);
  }, [ready]);
}

function TranscriptPanel({ meeting: m, segments }: { meeting: MeetingDetail; segments: ReturnType<typeof mergeSegments> }) {
  const { ref, activeIndex, seek } = useAudioSync(segments);
  const list = useRef<HTMLOListElement>(null);
  const hasAudio = !!m.audioUrl;
  const params = useSearchParams();
  // Arriving from a search: the words to find, and the moment that matched.
  const [find, setFind] = useState(() => params.get('q') ?? '');
  const startAt = Number(params.get('t') ?? NaN);
  const terms = useMemo(() => searchTerms(find), [find]);
  const matches = useMemo(() => (terms.length ? segments.flatMap((s, i) => (hasMatch(s.text, terms) ? [i] : [])) : []), [segments, terms]);
  const [current, setCurrent] = useState(-1);
  const focused = matches.length ? matches[Math.min(Math.max(current, 0), matches.length - 1)] : -1;

  const scrollTo = useCallback((index: number) => {
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, []);

  // Keep the playing segment in view inside the transcript box.
  useEffect(() => {
    if (activeIndex >= 0) scrollTo(activeIndex);
  }, [activeIndex, scrollTo]);

  // Opened at a moment (?t=): show that line and cue the audio there, without playing.
  const cued = useRef(false);
  useEffect(() => {
    if (cued.current || segments.length === 0) return;
    cued.current = true;
    const index = Number.isFinite(startAt) ? segmentAt(segments, startAt) : matches[0];
    if (index === undefined || index < 0) return;
    scrollTo(index);
    if (Number.isFinite(startAt) && hasAudio) seek(segments[index].startMs, false);
  }, [segments, startAt, matches, scrollTo, seek, hasAudio]);

  const step = (by: number) => {
    if (matches.length === 0) return;
    const next = (Math.max(current, 0) + by + matches.length) % matches.length;
    setCurrent(next);
    scrollTo(matches[next]);
  };

  return (
    <section className="sticker overflow-hidden" aria-label="Transcript">
      <div className="border-b-[2.5px] border-ink bg-paper p-4">
        <h2 className="font-display text-2xl leading-none">Transcript</h2>
        {hasAudio ? (
          <audio ref={ref} src={m.audioUrl ?? undefined} controls preload="metadata" className="mt-3 w-full" data-testid="meeting-audio">
            Your browser can’t play this recording.
          </audio>
        ) : (
          <p className="mt-2 text-sm font-semibold text-ink-soft">No audio was kept for this meeting, only the text.</p>
        )}
        {segments.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="find-in-transcript" className="sr-only">
              Find in transcript
            </label>
            <input
              id="find-in-transcript"
              type="search"
              className="field py-1.5 text-sm"
              placeholder="Find in transcript"
              value={find}
              autoComplete="off"
              onChange={(e) => {
                setFind(e.target.value);
                setCurrent(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : current < 0 ? 0 : 1);
                }
              }}
            />
            {terms.length > 0 && (
              <>
                <span className="shrink-0 text-xs font-extrabold text-ink-soft tabular-nums" aria-live="polite" data-testid="find-count">
                  {matches.length === 0 ? 'No matches' : `${Math.max(current, 0) + 1} of ${matches.length}`}
                </span>
                <button type="button" className="btn btn-secondary btn-sm px-2.5" onClick={() => step(-1)} disabled={matches.length === 0} aria-label="Previous match">
                  ↑
                </button>
                <button type="button" className="btn btn-secondary btn-sm px-2.5" onClick={() => step(1)} disabled={matches.length === 0} aria-label="Next match">
                  ↓
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {segments.length === 0 ? (
        <p className="p-5 font-semibold text-ink-soft">{isProcessing(m.status) ? 'The transcript shows up here once it’s ready.' : 'Nobody said anything. A true miracle.'}</p>
      ) : (
        <ol ref={list} className="max-h-[60svh] space-y-1 overflow-y-auto p-3" data-testid="transcript">
          {segments.map((s, i) => {
            const active = i === activeIndex;
            const found = i === focused;
            const content = (
              <>
                <span className="flex items-baseline gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink">
                    <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink" style={{ background: speakerColor(s.speaker) }} aria-hidden />
                    {s.speaker}
                  </span>
                  <span className="text-xs font-bold text-ink-soft tabular-nums">{formatTimestamp(s.startMs)}</span>
                </span>
                <span className="mt-0.5 block leading-relaxed font-semibold text-ink">
                  <Marked parts={highlightParts(s.text, terms)} />
                </span>
              </>
            );
            const tone = active ? 'border-ink bg-sun-soft' : found ? 'border-ink/50 bg-white' : 'border-transparent hover:bg-paper';
            return (
              <li key={`${s.startMs}-${i}`} data-index={i} data-active={active || undefined} data-found={found || undefined}>
                {hasAudio ? (
                  <button
                    type="button"
                    onClick={() => seek(s.startMs)}
                    className={`w-full rounded-2xl border-2 px-3 py-2 text-left transition-colors ${tone}`}
                    aria-current={active ? 'true' : undefined}
                    aria-label={`Play from ${formatTimestamp(s.startMs)}: ${s.speaker}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={`rounded-2xl border-2 px-3 py-2 ${tone}`}>{content}</div>
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

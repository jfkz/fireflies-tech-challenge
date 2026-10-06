'use client';

import { MAX_AUDIO_BYTES } from '@boringtalks/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useSyncExternalStore, type ChangeEvent, type DragEvent } from 'react';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { useAuth } from '@/components/providers/AuthProvider';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SendBotPanel } from './SendBotPanel';
import { useMe } from '@/hooks/queries';
import { useMicrophones } from '@/hooks/useMicrophones';
import { useRecorder } from '@/hooks/useRecorder';
import { TALKER } from '@/lib/avatar/styles';
import { formatBytes, formatClock } from '@/lib/format';
import { AUDIO_ACCEPT, checkAudioFile, normalizeAudioType, submitAudio, type SubmitStage } from '@/lib/upload';

const STAGE_LABEL: Record<SubmitStage, string> = {
  creating: 'Creating the meeting…',
  uploading: 'Uploading the audio…',
  finishing: 'Handing it to the summarizer…',
};

export function RecordView() {
  const me = useMe();
  return (
    <div>
      <h1 className="font-display text-4xl leading-none sm:text-5xl">New recording</h1>
      <p className="mt-3 max-w-[62ch] font-semibold text-ink-soft">
        No Mac app? Record from this browser, or upload audio you already have. The server transcribes it and writes the summary, usually within a
        couple of minutes. The <Link href="/#download" className="font-extrabold text-call-deep underline underline-offset-2">Mac app</Link> does the
        transcribing on your computer instead and tells the speakers apart.
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <RecorderPanel />
        <UploadPanel />
        {me.data?.meetingBot && (
          <div className="lg:col-span-2">
            <SendBotPanel />
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm font-extrabold">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value * 100)}%</span>
      </div>
      <div
        className="mt-1.5 h-4 overflow-hidden rounded-full border-2 border-ink bg-white"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <div className="h-full bg-sun transition-[width] duration-200" style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
    </div>
  );
}

function RecorderPanel() {
  const { api } = useAuth();
  const router = useRouter();
  const rec = useRecorder(api);
  const [withTab, setWithTab] = useState(false);
  const mics = useMicrophones();
  const micSelectId = useId();
  const { refresh: refreshMics } = mics;
  // Device names become readable once permission is granted by the first recording.
  useEffect(() => {
    if (rec.state.kind === 'recording' || rec.state.kind === 'recorded') void refreshMics();
  }, [rec.state.kind, refreshMics]);
  const [title, setTitle] = useState('');
  const tabId = useId();
  const titleId = useId();
  const s = rec.state;
  const canCaptureTab = useCanCaptureTab();

  useEffect(() => {
    if (s.kind === 'done') router.push(`/meetings/${s.meetingId}`);
  }, [s, router]);

  const talking = s.kind === 'recording' && rec.level > 0.12;

  return (
    <section className="sticker p-5 sm:p-6" aria-labelledby="rec-title">
      <h2 id="rec-title" className="font-display text-2xl">
        Record in the browser
      </h2>
      <div className="mt-4 flex items-center gap-5">
        <TalkingHead
          style={TALKER}
          talking={talking}
          asleep={s.kind === 'idle'}
          cheering={s.kind === 'done'}
          look="cursor"
          seed={5}
          className="h-28 w-28 shrink-0 sm:h-32 sm:w-32"
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-5xl tabular-nums" aria-live="off" data-testid="rec-timer">
            {formatClock(s.kind === 'recorded' || s.kind === 'submitting' ? s.durationSec : rec.elapsed)}
          </p>
          <LevelMeter level={s.kind === 'recording' ? rec.level : 0} />
          <p className="mt-2 text-sm font-bold text-ink-soft" role="status">
            {s.kind === 'idle' && 'Ready when you are. The head wakes up when you start.'}
            {s.kind === 'requesting' && 'Waiting for permission…'}
            {s.kind === 'recording' && (s.withTab ? 'Recording you and the shared tab.' : 'Recording your microphone.')}
            {s.kind === 'stopping' && 'Finishing the recording…'}
            {s.kind === 'recorded' && 'Got it. Listen back, then save it.'}
            {s.kind === 'submitting' && STAGE_LABEL[s.stage]}
            {s.kind === 'done' && 'Saved. Opening the meeting…'}
          </p>
        </div>
      </div>

      {s.kind === 'error' && (
        <div className="mt-4">
          <ErrorNote onRetry={s.recorded ? rec.retry : undefined}>{s.message}</ErrorNote>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {(s.kind === 'idle' || s.kind === 'error') && !(s.kind === 'error' && s.recorded) && (
          <>
            {mics.microphones.length > 1 && (
              <div>
                <label htmlFor={micSelectId} className="label">
                  Microphone
                </label>
                <select id={micSelectId} className="field" value={mics.selected} onChange={(e) => mics.choose(e.target.value)}>
                  <option value="">System default</option>
                  {mics.microphones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {canCaptureTab && (
              <label htmlFor={tabId} className="flex cursor-pointer items-start gap-3 font-bold">
                <input id={tabId} type="checkbox" className="check mt-0.5" checked={withTab} onChange={(e) => setWithTab(e.target.checked)} />
                <span>
                  Also capture a tab
                  <span className="block text-sm font-semibold text-ink-soft">
                    For a call running in another tab: pick it and tick “Share tab audio” so the other side is recorded too.
                  </span>
                </span>
              </label>
            )}
            <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => rec.start(withTab, mics.selected || undefined)}>
              <span className="h-3.5 w-3.5 rounded-full border-2 border-ink bg-danger" aria-hidden /> Start recording
            </button>
          </>
        )}
        {s.kind === 'recording' && (
          <button type="button" className="btn btn-danger btn-lg w-full" onClick={rec.stop}>
            <span className="h-3.5 w-3.5 rounded-sm bg-white" aria-hidden /> Stop
          </button>
        )}
        {s.kind === 'recorded' && (
          <>
            {rec.previewUrl && (
              <audio src={rec.previewUrl} controls className="w-full" aria-label="Your recording">
                Your browser can’t play this recording.
              </audio>
            )}
            <p className="text-sm font-bold text-ink-soft">{formatBytes(s.blob.size)}</p>
            <div>
              <label htmlFor={titleId} className="label">
                Title (optional, the summary writes a better one)
              </label>
              <input id={titleId} className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Quick sync that wasn’t" />
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary" onClick={() => rec.submit(title)}>
                Save and summarize
              </button>
              <button type="button" className="btn btn-secondary" onClick={rec.discard}>
                Discard
              </button>
            </div>
          </>
        )}
        {s.kind === 'submitting' && <ProgressBar value={s.stage === 'creating' ? 0 : s.progress} label={STAGE_LABEL[s.stage]} />}
      </div>
    </section>
  );
}

const noop = () => () => {};
/** Tab capture exists on desktop browsers only; false during SSR so hydration matches. */
function useCanCaptureTab(): boolean {
  return useSyncExternalStore(noop, () => !!navigator.mediaDevices?.getDisplayMedia, () => false);
}

function LevelMeter({ level }: { level: number }) {
  const bars = 16;
  const lit = Math.round(level * bars);
  return (
    <div className="mt-1 flex h-5 items-end gap-1" aria-hidden data-testid="level-meter">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`w-full rounded-sm border border-ink/30 transition-colors ${i < lit ? (i > bars * 0.8 ? 'bg-tomato' : i > bars * 0.55 ? 'bg-sun' : 'bg-mint') : 'bg-paper'}`}
          style={{ height: `${30 + (i / bars) * 70}%` }}
        />
      ))}
    </div>
  );
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'submitting'; stage: SubmitStage; progress: number }
  | { kind: 'error'; message: string };

function UploadPanel() {
  const { api } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  const titleId = useId();
  const busy = state.kind === 'submitting';

  function choose(f: File | undefined | null) {
    setState({ kind: 'idle' });
    if (!f) return;
    const p = checkAudioFile(f);
    if (p) {
      setFile(null);
      setProblem(
        p.kind === 'size'
          ? `That file is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_AUDIO_BYTES)}.`
          : p.kind === 'empty'
            ? 'That file is empty.'
            : 'That isn’t an audio format we take. Use M4A, MP3, WAV, WebM or OGG.',
      );
      return;
    }
    setProblem(null);
    setFile(f);
  }

  async function upload() {
    if (!file) return;
    const contentType = normalizeAudioType(file.type, file.name);
    if (!contentType) return;
    setState({ kind: 'submitting', stage: 'creating', progress: 0 });
    try {
      const id = await submitAudio({
        api,
        source: 'upload',
        audio: file,
        contentType,
        title,
        startedAt: file.lastModified ? new Date(file.lastModified) : undefined,
        onStage: (stage) => setState((s) => (s.kind === 'submitting' ? { ...s, stage } : s)),
        onProgress: (progress) => setState((s) => (s.kind === 'submitting' ? { ...s, progress } : s)),
      });
      router.push(`/meetings/${id}`);
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
    }
  }

  return (
    <section className="sticker p-5 sm:p-6" aria-labelledby="upload-title">
      <h2 id="upload-title" className="font-display text-2xl">
        Upload an audio file
      </h2>
      <label
        htmlFor={inputId}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files[0]);
        }}
        className={`mt-4 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-[20px] border-[2.5px] border-dashed border-ink px-4 py-6 text-center transition-colors ${
          dragging ? 'bg-sun-soft' : 'bg-paper hover:bg-sun-soft/60'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-9 w-9 text-ink" aria-hidden>
          <path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="mt-2 font-extrabold">{file ? file.name : 'Drop a file here or choose one'}</span>
        <span className="mt-1 text-sm font-semibold text-ink-soft">
          {file ? formatBytes(file.size) : `M4A, MP3, WAV, WebM or OGG, up to ${formatBytes(MAX_AUDIO_BYTES)}`}
        </span>
        <input
          id={inputId}
          type="file"
          accept={AUDIO_ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e: ChangeEvent<HTMLInputElement>) => choose(e.target.files?.[0])}
          data-testid="upload-input"
        />
      </label>
      {problem && (
        <p role="alert" className="mt-3 font-bold text-danger">
          {problem}
        </p>
      )}
      <div className="mt-4">
        <label htmlFor={titleId} className="label">
          Title (optional)
        </label>
        <input id={titleId} className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={busy} placeholder="Leave empty and we’ll name it from what was said" />
      </div>
      <div className="mt-5 space-y-4">
        {state.kind === 'submitting' ? (
          <ProgressBar value={state.stage === 'creating' ? 0 : state.progress} label={STAGE_LABEL[state.stage]} />
        ) : (
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={!file} onClick={upload}>
            Upload and summarize
          </button>
        )}
        {state.kind === 'error' && <ErrorNote onRetry={upload}>{state.message}</ErrorNote>}
      </div>
    </section>
  );
}

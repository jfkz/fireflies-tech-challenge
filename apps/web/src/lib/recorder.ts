import type { AudioContentType, SubmitStage } from './upload';

/** The browser recorder as an explicit state machine; the hook only wires browser APIs to it. */
export type RecorderState =
  | { kind: 'idle' }
  | { kind: 'requesting'; withTab: boolean }
  | { kind: 'recording'; startedAt: number; withTab: boolean }
  | { kind: 'stopping'; startedAt: number }
  | { kind: 'recorded'; blob: Blob; contentType: AudioContentType; durationSec: number }
  | { kind: 'submitting'; stage: SubmitStage; progress: number; durationSec: number }
  | { kind: 'done'; meetingId: string }
  | { kind: 'error'; message: string; recorded?: Extract<RecorderState, { kind: 'recorded' }> };

export type RecorderEvent =
  | { type: 'request'; withTab: boolean }
  | { type: 'granted'; startedAt: number }
  | { type: 'denied'; message: string }
  | { type: 'stop' }
  | { type: 'stopped'; blob: Blob; contentType: AudioContentType; stoppedAt: number }
  | { type: 'discard' }
  | { type: 'submit' }
  | { type: 'stage'; stage: SubmitStage }
  | { type: 'progress'; fraction: number }
  | { type: 'submitted'; meetingId: string }
  | { type: 'failed'; message: string; recorded?: Extract<RecorderState, { kind: 'recorded' }> }
  | { type: 'retry' };

export const INITIAL_RECORDER: RecorderState = { kind: 'idle' };

/** Pure transition function. Events that make no sense in the current state are ignored. */
export function recorderReducer(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case 'request':
      return state.kind === 'idle' || state.kind === 'error' ? { kind: 'requesting', withTab: event.withTab } : state;
    case 'granted':
      return state.kind === 'requesting' ? { kind: 'recording', startedAt: event.startedAt, withTab: state.withTab } : state;
    case 'denied':
      return state.kind === 'requesting' ? { kind: 'error', message: event.message } : state;
    case 'stop':
      return state.kind === 'recording' ? { kind: 'stopping', startedAt: state.startedAt } : state;
    case 'stopped': {
      if (state.kind !== 'stopping' && state.kind !== 'recording') return state;
      if (event.blob.size === 0) return { kind: 'error', message: 'The recording came out empty. Check that your microphone works and try again.' };
      const durationSec = Math.max(0, (event.stoppedAt - state.startedAt) / 1000);
      return { kind: 'recorded', blob: event.blob, contentType: event.contentType, durationSec };
    }
    case 'discard':
      return state.kind === 'recorded' || state.kind === 'error' ? INITIAL_RECORDER : state;
    case 'submit':
      return state.kind === 'recorded' ? { kind: 'submitting', stage: 'creating', progress: 0, durationSec: state.durationSec } : state;
    case 'stage':
      return state.kind === 'submitting' ? { ...state, stage: event.stage } : state;
    case 'progress':
      return state.kind === 'submitting' ? { ...state, progress: Math.min(1, Math.max(state.progress, event.fraction)) } : state;
    case 'submitted':
      return state.kind === 'submitting' ? { kind: 'done', meetingId: event.meetingId } : state;
    case 'failed':
      // Keep the recording so "Try again" doesn't lose it.
      return { kind: 'error', message: event.message, recorded: event.recorded };
    case 'retry':
      return state.kind === 'error' && state.recorded ? state.recorded : state;
  }
}

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** The first container MediaRecorder supports here, in the order the API prefers. */
export function pickRecorderMimeType(isTypeSupported: (type: string) => boolean): string | undefined {
  return PREFERRED_TYPES.find((t) => {
    try {
      return isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

/** RMS of time-domain bytes (128 = silence) mapped to 0…1 with a little gain. */
export function levelFromSamples(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}

/** Friendly text for getUserMedia / getDisplayMedia failures. */
export function mediaErrorMessage(err: unknown, what: 'microphone' | 'tab'): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return what === 'microphone'
      ? 'The browser blocked the microphone. Allow it in the address bar and try again.'
      : 'Tab sharing was cancelled. Pick a tab and tick “Share tab audio” to include the other side.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Plug one in and try again.';
  if (name === 'NotReadableError') return 'Another app is using the microphone. Close it and try again.';
  return `Could not start recording${err instanceof Error && err.message ? `: ${err.message}` : '.'}`;
}

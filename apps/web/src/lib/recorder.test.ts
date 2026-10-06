import { describe, expect, it } from 'vitest';
import { INITIAL_RECORDER, levelFromSamples, mediaErrorMessage, pickRecorderMimeType, recorderReducer, type RecorderEvent, type RecorderState } from './recorder';

const run = (events: RecorderEvent[], from: RecorderState = INITIAL_RECORDER) => events.reduce(recorderReducer, from);
const blob = new Blob(['x'.repeat(10)]);

describe('recorder state machine', () => {
  it('goes idle → requesting → recording → stopping → recorded', () => {
    const s = run([
      { type: 'request', withTab: true },
      { type: 'granted', startedAt: 1000 },
      { type: 'stop' },
      { type: 'stopped', blob, contentType: 'audio/webm', stoppedAt: 61_000 },
    ]);
    expect(s).toEqual({ kind: 'recorded', blob, contentType: 'audio/webm', durationSec: 60 });
  });

  it('keeps withTab while recording', () => {
    expect(run([{ type: 'request', withTab: true }, { type: 'granted', startedAt: 5 }])).toEqual({ kind: 'recording', startedAt: 5, withTab: true });
  });

  it('turns a refused permission into an error, and can start again', () => {
    const s = run([{ type: 'request', withTab: false }, { type: 'denied', message: 'blocked' }]);
    expect(s).toEqual({ kind: 'error', message: 'blocked' });
    expect(recorderReducer(s, { type: 'request', withTab: false }).kind).toBe('requesting');
  });

  it('treats an empty recording as an error', () => {
    const s = run([{ type: 'request', withTab: false }, { type: 'granted', startedAt: 0 }, { type: 'stop' }, { type: 'stopped', blob: new Blob([]), contentType: 'audio/webm', stoppedAt: 10 }]);
    expect(s.kind).toBe('error');
  });

  it('submits with stages and monotonic progress, then is done', () => {
    const recorded: RecorderState = { kind: 'recorded', blob, contentType: 'audio/webm', durationSec: 3 };
    let s = recorderReducer(recorded, { type: 'submit' });
    expect(s).toEqual({ kind: 'submitting', stage: 'creating', progress: 0, durationSec: 3 });
    s = run([{ type: 'stage', stage: 'uploading' }, { type: 'progress', fraction: 0.6 }, { type: 'progress', fraction: 0.4 }], s);
    expect(s).toMatchObject({ stage: 'uploading', progress: 0.6 });
    s = run([{ type: 'progress', fraction: 3 }], s);
    expect(s).toMatchObject({ progress: 1 });
    expect(recorderReducer(s, { type: 'submitted', meetingId: 'm1' })).toEqual({ kind: 'done', meetingId: 'm1' });
  });

  it('keeps the recording after a failed upload so retry restores it', () => {
    const recorded = { kind: 'recorded', blob, contentType: 'audio/webm', durationSec: 3 } as const;
    const failed = recorderReducer({ kind: 'submitting', stage: 'uploading', progress: 0.2, durationSec: 3 }, { type: 'failed', message: 'offline', recorded });
    expect(failed).toEqual({ kind: 'error', message: 'offline', recorded });
    expect(recorderReducer(failed, { type: 'retry' })).toBe(recorded);
    expect(recorderReducer({ kind: 'error', message: 'x' }, { type: 'retry' })).toEqual({ kind: 'error', message: 'x' });
  });

  it('discards a take back to idle', () => {
    expect(recorderReducer({ kind: 'recorded', blob, contentType: 'audio/webm', durationSec: 1 }, { type: 'discard' })).toBe(INITIAL_RECORDER);
  });

  it('ignores events that make no sense in the current state', () => {
    const idle = INITIAL_RECORDER;
    for (const e of [
      { type: 'stop' },
      { type: 'granted', startedAt: 1 },
      { type: 'denied', message: 'x' },
      { type: 'submit' },
      { type: 'stage', stage: 'uploading' },
      { type: 'progress', fraction: 1 },
      { type: 'submitted', meetingId: 'x' },
      { type: 'discard' },
      { type: 'stopped', blob, contentType: 'audio/webm', stoppedAt: 1 },
    ] as RecorderEvent[]) {
      expect(recorderReducer(idle, e)).toBe(idle);
    }
    const recording: RecorderState = { kind: 'recording', startedAt: 0, withTab: false };
    expect(recorderReducer(recording, { type: 'request', withTab: false })).toBe(recording);
  });
});

describe('recorder helpers', () => {
  it('picks the first supported container', () => {
    expect(pickRecorderMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecorderMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
    expect(
      pickRecorderMimeType(() => {
        throw new Error('nope');
      }),
    ).toBeUndefined();
  });

  it('measures level from time-domain samples', () => {
    expect(levelFromSamples(new Uint8Array([]))).toBe(0);
    expect(levelFromSamples(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelFromSamples(new Uint8Array(64).fill(255))).toBe(1);
    const mid = levelFromSamples(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 140 : 116)));
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.4);
  });

  it('explains media errors', () => {
    expect(mediaErrorMessage({ name: 'NotAllowedError' }, 'microphone')).toMatch(/blocked the microphone/);
    expect(mediaErrorMessage({ name: 'NotAllowedError' }, 'tab')).toMatch(/Share tab audio/);
    expect(mediaErrorMessage({ name: 'NotFoundError' }, 'microphone')).toMatch(/No microphone/);
    expect(mediaErrorMessage({ name: 'NotReadableError' }, 'microphone')).toMatch(/Another app/);
    expect(mediaErrorMessage(new Error('weird'), 'microphone')).toBe('Could not start recording: weird');
    expect(mediaErrorMessage(null, 'microphone')).toBe('Could not start recording.');
  });
});

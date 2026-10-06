'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ApiClient } from '@/lib/api';
import {
  INITIAL_RECORDER,
  levelFromSamples,
  mediaErrorMessage,
  pickRecorderMimeType,
  recorderReducer,
  type RecorderState,
} from '@/lib/recorder';
import { normalizeAudioType, submitAudio, type SubmitAudioOptions } from '@/lib/upload';

/**
 * Echo cancellation removes whatever the speakers play from the microphone. That is
 * right when the tab's audio is recorded separately (it would be there twice), and
 * wrong otherwise: a call playing through the speakers is exactly what should be
 * recorded. Auto gain keeps a quiet room or far-away speakers audible.
 */
export function micConstraints(withTab: boolean, micId?: string): MediaTrackConstraints {
  return {
    echoCancellation: withTab,
    noiseSuppression: true,
    autoGainControl: true,
    ...(micId ? { deviceId: { exact: micId } } : {}),
  };
}

interface Live {
  recorder: MediaRecorder;
  streams: MediaStream[];
  context: AudioContext | null;
  raf: number;
}

/**
 * Records the microphone (and optionally a shared tab's audio, mixed through
 * Web Audio) with MediaRecorder, then uploads it as a meeting.
 */
export function useRecorder(api: ApiClient, put?: SubmitAudioOptions['put']) {
  const [state, dispatch] = useReducer(recorderReducer, INITIAL_RECORDER);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const live = useRef<Live | null>(null);
  // A playable URL for the finished take, created when recording stops.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const preview = useRef<string | null>(null);
  const setPreview = useCallback((blob: Blob | null) => {
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
    setPreviewUrl(preview.current);
  }, []);

  const teardown = useCallback(() => {
    const l = live.current;
    if (!l) return;
    cancelAnimationFrame(l.raf);
    for (const s of l.streams) for (const t of s.getTracks()) t.stop();
    void l.context?.close().catch(() => {});
    live.current = null;
    setLevel(0);
  }, []);

  useEffect(
    () => () => {
      teardown();
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [teardown],
  );

  useEffect(() => {
    if (state.kind !== 'recording') return;
    const tick = () => setElapsed((Date.now() - state.startedAt) / 1000);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(
    async (withTab = false, micId?: string) => {
      dispatch({ type: 'request', withTab });
      setElapsed(0);
      const streams: MediaStream[] = [];
      try {
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('This browser cannot record audio.'), { name: 'NotSupportedError' });
        }
        let mic: MediaStream;
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(withTab, micId) });
        } catch (err) {
          throw Object.assign(new Error(mediaErrorMessage(err, 'microphone')), { friendly: true });
        }
        streams.push(mic);

        let tab: MediaStream | null = null;
        if (withTab) {
          try {
            tab = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          } catch (err) {
            throw Object.assign(new Error(mediaErrorMessage(err, 'tab')), { friendly: true });
          }
          streams.push(tab);
          // Only the sound is wanted; drop the picture right away.
          for (const t of tab.getVideoTracks()) t.stop();
          if (tab.getAudioTracks().length === 0) {
            throw Object.assign(new Error('That share has no sound. Share a browser tab and tick “Share tab audio”.'), { friendly: true });
          }
        }

        let context: AudioContext | null = null;
        let recordStream = mic;
        let analyser: AnalyserNode | null = null;
        if (typeof AudioContext !== 'undefined') {
          context = new AudioContext();
          analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          const dest = context.createMediaStreamDestination();
          context.createMediaStreamSource(mic).connect(analyser);
          context.createMediaStreamSource(mic).connect(dest);
          if (tab) {
            const tabSource = context.createMediaStreamSource(new MediaStream(tab.getAudioTracks()));
            tabSource.connect(dest);
            tabSource.connect(analyser);
            recordStream = dest.stream;
          }
        }

        const mimeType = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t));
        const recorder = new MediaRecorder(recordStream, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          const type = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type });
          const contentType = normalizeAudioType(type) ?? 'audio/webm';
          teardown();
          if (blob.size > 0) setPreview(blob);
          dispatch({ type: 'stopped', blob, contentType, stoppedAt: Date.now() });
        };
        // If the person stops sharing from the browser bar, stop the recording too.
        tab?.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (recorder.state === 'recording') {
            dispatch({ type: 'stop' });
            recorder.stop();
          }
        });

        const samples = new Uint8Array(analyser?.fftSize ?? 0);
        let lastLevel = 0;
        const meter = () => {
          if (!live.current) return;
          if (analyser) {
            analyser.getByteTimeDomainData(samples);
            const next = levelFromSamples(samples);
            // Fast attack, slow release, like a VU meter.
            lastLevel = next > lastLevel ? next : lastLevel * 0.9 + next * 0.1;
            setLevel(lastLevel);
          }
          live.current.raf = requestAnimationFrame(meter);
        };

        live.current = { recorder, streams, context, raf: 0 };
        recorder.start(1000);
        dispatch({ type: 'granted', startedAt: Date.now() });
        live.current.raf = requestAnimationFrame(meter);
      } catch (err) {
        for (const s of streams) for (const t of s.getTracks()) t.stop();
        const e = err as Error & { friendly?: boolean };
        dispatch({ type: 'denied', message: e.friendly ? e.message : mediaErrorMessage(err, 'microphone') });
      }
    },
    [teardown, setPreview],
  );

  const stop = useCallback(() => {
    const l = live.current;
    if (!l || l.recorder.state !== 'recording') return;
    dispatch({ type: 'stop' });
    l.recorder.stop();
  }, []);

  const discard = useCallback(() => {
    teardown();
    setPreview(null);
    dispatch({ type: 'discard' });
    setElapsed(0);
  }, [teardown, setPreview]);

  const submit = useCallback(
    async (title?: string) => {
      if (state.kind !== 'recorded') return null;
      const recorded = state;
      dispatch({ type: 'submit' });
      try {
        const id = await submitAudio({
          api,
          source: 'browser',
          audio: recorded.blob,
          contentType: recorded.contentType,
          durationSec: recorded.durationSec,
          title,
          startedAt: new Date(Date.now() - recorded.durationSec * 1000),
          onStage: (stage) => dispatch({ type: 'stage', stage }),
          onProgress: (fraction) => dispatch({ type: 'progress', fraction }),
          put,
        });
        dispatch({ type: 'submitted', meetingId: id });
        return id;
      } catch (err) {
        dispatch({ type: 'failed', message: err instanceof Error ? err.message : 'Upload failed.', recorded });
        return null;
      }
    },
    [api, put, state],
  );

  const retry = useCallback(() => dispatch({ type: 'retry' }), []);

  return { state: state as RecorderState, level, elapsed, previewUrl, start, stop, discard, submit, retry };
}

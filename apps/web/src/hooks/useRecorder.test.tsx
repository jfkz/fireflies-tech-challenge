import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '@/test/utils';
import { micConstraints, useRecorder } from './useRecorder';

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = vi.fn((t: string) => t.startsWith('audio/webm'));
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? '';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
    this.ondataavailable?.({ data: new Blob([]) });
    this.onstop?.();
  }
}

function track(kind: 'audio' | 'video') {
  return { kind, stop: vi.fn(), addEventListener: vi.fn() };
}

function stream(tracks: ReturnType<typeof track>[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as unknown as MediaStream;
}

let mic: MediaStream;
const getUserMedia = vi.fn();
const getDisplayMedia = vi.fn();

beforeEach(() => {
  FakeRecorder.instances = [];
  mic = stream([track('audio')]);
  getUserMedia.mockReset().mockResolvedValue(mic);
  getDisplayMedia.mockReset();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', undefined);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, getDisplayMedia } });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('useRecorder', () => {
  it('records the microphone, then uploads it as a browser meeting', async () => {
    const api = fakeApi({
      createMeeting: vi.fn(async () => ({ id: 'm1' }) as never),
      uploadUrl: vi.fn(async () => ({ url: 'https://r2.test/x', key: 'k', headers: {}, expiresInSec: 60 })),
      completeMeeting: vi.fn(async () => ({}) as never),
    });
    const put = vi.fn(async (_u: string, _b: Blob, _h: Record<string, string>, p?: (f: number) => void) => p?.(1));
    const { result } = renderHook(() => useRecorder(api, put));

    await act(() => result.current.start());
    expect(result.current.state.kind).toBe('recording');
    // Speakers playing a call are what we want recorded, so no echo cancellation for the mic alone.
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    expect(FakeRecorder.instances[0].mimeType).toBe('audio/webm;codecs=opus');

    act(() => result.current.stop());
    expect(result.current.state).toMatchObject({ kind: 'recorded', contentType: 'audio/webm' });
    expect(result.current.previewUrl).toBe('blob:preview');
    expect(mic.getTracks()[0].stop).toHaveBeenCalled();

    let id: string | null = null;
    await act(async () => {
      id = await result.current.submit('Standup');
    });
    expect(id).toBe('m1');
    expect(result.current.state).toEqual({ kind: 'done', meetingId: 'm1' });
    expect(api.createMeeting).toHaveBeenCalledWith(expect.objectContaining({ source: 'browser', title: 'Standup' }));
    expect(api.uploadUrl).toHaveBeenCalledWith('m1', { contentType: 'audio/webm', sizeBytes: 3 });
  });

  it('records from the chosen microphone', async () => {
    const { result } = renderHook(() => useRecorder(fakeApi()));
    await act(() => result.current.start(false, 'built-in'));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, deviceId: { exact: 'built-in' } },
    });
  });

  it('keeps the take when the upload fails, and retry brings it back', async () => {
    const api = fakeApi({ createMeeting: vi.fn(async () => Promise.reject(new Error('API down'))) });
    const { result } = renderHook(() => useRecorder(api));
    await act(() => result.current.start());
    act(() => result.current.stop());
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toMatchObject({ kind: 'error', message: 'API down' });
    act(() => result.current.retry());
    expect(result.current.state.kind).toBe('recorded');
    act(() => result.current.discard());
    expect(result.current.state.kind).toBe('idle');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('explains a blocked microphone', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const { result } = renderHook(() => useRecorder(fakeApi()));
    await act(() => result.current.start());
    expect(result.current.state).toEqual({ kind: 'error', message: expect.stringMatching(/blocked the microphone/) });
  });

  it('needs tab audio when capturing a tab, and releases the mic when it is missing', async () => {
    getDisplayMedia.mockResolvedValue(stream([track('video')]));
    const { result } = renderHook(() => useRecorder(fakeApi()));
    await act(() => result.current.start(true));
    expect(result.current.state).toEqual({ kind: 'error', message: expect.stringMatching(/Share tab audio/) });
    expect(mic.getTracks()[0].stop).toHaveBeenCalled();
  });

  it('says so when the browser cannot record', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const { result } = renderHook(() => useRecorder(fakeApi()));
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.state.kind).toBe('error'));
  });

  it('ignores submit when nothing is recorded', async () => {
    const { result } = renderHook(() => useRecorder(fakeApi()));
    await expect(result.current.submit()).resolves.toBeNull();
  });

  it('cancels echo only when the tab is recorded separately', () => {
    expect(micConstraints(true)).toMatchObject({ echoCancellation: true });
    expect(micConstraints(false)).toMatchObject({ echoCancellation: false });
  });
});


import { MAX_AUDIO_BYTES } from '@boringtalks/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './api';
import { checkAudioFile, normalizeAudioType, putWithProgress, submitAudio, UploadError } from './upload';

describe('normalizeAudioType', () => {
  it.each([
    ['audio/webm;codecs=opus', undefined, 'audio/webm'],
    ['audio/mp4', undefined, 'audio/mp4'],
    ['audio/x-wav', undefined, 'audio/wav'],
    ['audio/mp3', undefined, 'audio/mpeg'],
    ['', 'meeting.m4a', 'audio/m4a'],
    ['application/octet-stream', 'call.MP3', 'audio/mpeg'],
    ['text/plain', 'notes.txt', null],
    [undefined, undefined, null],
  ])('%s + %s → %s', (type, name, expected) => {
    expect(normalizeAudioType(type, name)).toBe(expected);
  });
});

describe('checkAudioFile', () => {
  it('accepts audio within the limit', () => {
    expect(checkAudioFile({ type: 'audio/mpeg', name: 'a.mp3', size: 10 })).toBeNull();
  });
  it('rejects empty, wrong type and oversized files', () => {
    expect(checkAudioFile({ type: 'audio/mpeg', name: 'a.mp3', size: 0 })).toEqual({ kind: 'empty' });
    expect(checkAudioFile({ type: 'image/png', name: 'a.png', size: 10 })).toEqual({ kind: 'type' });
    expect(checkAudioFile({ type: 'audio/wav', name: 'a.wav', size: MAX_AUDIO_BYTES + 1 })).toEqual({ kind: 'size', max: MAX_AUDIO_BYTES });
  });
});

/** A scriptable XMLHttpRequest stand-in. */
class FakeXHR {
  static last: FakeXHR;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 0;
  body: unknown;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
}

describe('putWithProgress', () => {
  function start(signal?: AbortSignal) {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const progress: number[] = [];
    const blob = new Blob(['abc']);
    const done = putWithProgress('https://r2.test/put', blob, { 'Content-Type': 'audio/webm', 'Content-Length': '3' }, (f) => progress.push(f), signal);
    return { done, progress, xhr: FakeXHR.last, blob };
  }

  it('PUTs the blob with the presigned headers and reports progress', async () => {
    const { done, progress, xhr, blob } = start();
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://r2.test/put');
    expect(xhr.headers).toEqual({ 'Content-Type': 'audio/webm' });
    expect(xhr.body).toBe(blob);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 });
    xhr.status = 200;
    xhr.onload?.();
    await done;
    expect(progress).toEqual([0.25, 1]);
  });

  it('rejects with the storage status', async () => {
    const { done, xhr } = start();
    xhr.status = 403;
    xhr.onload?.();
    await expect(done).rejects.toMatchObject({ name: 'UploadError', status: 403 });
  });

  it('rejects on network errors', async () => {
    const { done, xhr } = start();
    xhr.onerror?.();
    await expect(done).rejects.toBeInstanceOf(UploadError);
  });

  it('aborts when the signal fires', async () => {
    const ctl = new AbortController();
    const { done } = start(ctl.signal);
    ctl.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('submitAudio', () => {
  it('creates, uploads, then completes, in that order', async () => {
    const order: string[] = [];
    const api = {
      createMeeting: vi.fn(async (b) => (order.push('create'), { id: 'm1', ...b })),
      uploadUrl: vi.fn(async () => (order.push('upload-url'), { url: 'https://r2.test/x', key: 'k', headers: { 'x-amz-acl': 'private' }, expiresInSec: 60 })),
      completeMeeting: vi.fn(async () => (order.push('complete'), {})),
    } as unknown as ApiClient;
    const put = vi.fn(async (_u: string, _b: Blob, _h: Record<string, string>, onProgress?: (f: number) => void) => {
      order.push('put');
      onProgress?.(0.5);
    });
    const stages: string[] = [];
    const progress: number[] = [];
    const audio = new Blob(['12345']);
    const id = await submitAudio({
      api,
      source: 'browser',
      audio,
      contentType: 'audio/webm',
      title: '  Standup ',
      durationSec: 61.6,
      startedAt: new Date('2026-10-01T10:00:00Z'),
      onStage: (s) => stages.push(s),
      onProgress: (p) => progress.push(p),
      put,
    });
    expect(id).toBe('m1');
    expect(order).toEqual(['create', 'upload-url', 'put', 'complete']);
    expect(api.createMeeting).toHaveBeenCalledWith({ source: 'browser', title: 'Standup', startedAt: '2026-10-01T10:00:00.000Z' });
    expect(api.uploadUrl).toHaveBeenCalledWith('m1', { contentType: 'audio/webm', sizeBytes: 5 });
    expect(put.mock.calls[0][2]).toEqual({ 'Content-Type': 'audio/webm', 'x-amz-acl': 'private' });
    expect(api.completeMeeting).toHaveBeenCalledWith('m1', { durationSec: 62 });
    expect(stages).toEqual(['creating', 'uploading', 'finishing']);
    expect(progress).toEqual([0.5]);
  });

  it('omits an empty title and duration', async () => {
    const api = {
      createMeeting: vi.fn(async () => ({ id: 'm2' })),
      uploadUrl: vi.fn(async () => ({ url: 'https://r2.test/x', key: 'k', headers: {}, expiresInSec: 60 })),
      completeMeeting: vi.fn(async () => ({})),
    } as unknown as ApiClient;
    await submitAudio({ api, source: 'upload', audio: new Blob(['1']), contentType: 'audio/wav', title: '  ', put: vi.fn(async () => {}) });
    expect((api.createMeeting as ReturnType<typeof vi.fn>).mock.calls[0][0].title).toBeUndefined();
    expect(api.completeMeeting).toHaveBeenCalledWith('m2', {});
  });
});

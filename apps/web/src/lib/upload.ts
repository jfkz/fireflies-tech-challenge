import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, type MeetingSource } from '@boringtalks/shared';
import type { ApiClient } from './api';

export type AudioContentType = (typeof AUDIO_CONTENT_TYPES)[number];

const ALIASES: Record<string, AudioContentType> = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/aac': 'audio/mp4',
  'video/webm': 'audio/webm',
  'video/mp4': 'audio/mp4',
};

const BY_EXTENSION: Record<string, AudioContentType> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/**
 * Maps a browser MIME type (with codecs, aliases) or a file name to one of the
 * content types the API accepts, or null when it is not audio we take.
 */
export function normalizeAudioType(type: string | undefined, fileName?: string): AudioContentType | null {
  const base = (type ?? '').split(';')[0].trim().toLowerCase();
  if ((AUDIO_CONTENT_TYPES as readonly string[]).includes(base)) return base as AudioContentType;
  if (ALIASES[base]) return ALIASES[base];
  const ext = fileName?.split('.').pop()?.toLowerCase();
  return ext && BY_EXTENSION[ext] ? BY_EXTENSION[ext] : null;
}

/** File picker `accept` value. */
export const AUDIO_ACCEPT = [...AUDIO_CONTENT_TYPES, ...Object.keys(BY_EXTENSION).map((e) => `.${e}`)].join(',');

export type FileProblem = { kind: 'type' } | { kind: 'size'; max: number } | { kind: 'empty' };

export function checkAudioFile(file: { type: string; name: string; size: number }): FileProblem | null {
  if (file.size === 0) return { kind: 'empty' };
  if (!normalizeAudioType(file.type, file.name)) return { kind: 'type' };
  if (file.size > MAX_AUDIO_BYTES) return { kind: 'size', max: MAX_AUDIO_BYTES };
  return null;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * PUTs a file straight to a presigned URL with XMLHttpRequest, because fetch
 * cannot report upload progress. `onProgress` gets 0…1.
 */
export function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) {
      // Browsers refuse to set these themselves; the presigned URL still matches.
      if (/^(content-length|host)$/i.test(k)) continue;
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new UploadError(`Storage refused the upload (HTTP ${xhr.status}).`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError('The upload was interrupted. Check your connection and try again.', 0));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export type SubmitStage = 'creating' | 'uploading' | 'finishing';

export interface SubmitAudioOptions {
  api: ApiClient;
  source: Exclude<MeetingSource, 'demo' | 'macos'>;
  audio: Blob;
  contentType: AudioContentType;
  title?: string;
  durationSec?: number;
  startedAt?: Date;
  onStage?: (stage: SubmitStage) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  put?: typeof putWithProgress;
}

/**
 * The browser side of a recording or upload: create the meeting, get a
 * presigned URL, PUT the audio straight to storage, then mark it complete so
 * the workers transcribe and summarise it. Resolves to the meeting id.
 */
export async function submitAudio(o: SubmitAudioOptions): Promise<string> {
  const put = o.put ?? putWithProgress;
  o.onStage?.('creating');
  const meeting = await o.api.createMeeting({
    source: o.source,
    title: o.title?.trim() || undefined,
    startedAt: (o.startedAt ?? new Date()).toISOString(),
  });
  const target = await o.api.uploadUrl(meeting.id, { contentType: o.contentType, sizeBytes: o.audio.size });
  o.onStage?.('uploading');
  await put(target.url, o.audio, { 'Content-Type': o.contentType, ...target.headers }, o.onProgress, o.signal);
  o.onStage?.('finishing');
  await o.api.completeMeeting(meeting.id, o.durationSec !== undefined ? { durationSec: Math.round(o.durationSec) } : {});
  return meeting.id;
}

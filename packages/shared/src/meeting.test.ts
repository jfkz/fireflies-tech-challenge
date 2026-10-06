import { describe, expect, it } from 'vitest';
import {
  canTransition,
  CreateMeetingRequest,
  ListMeetingsQuery,
  MAX_AUDIO_BYTES,
  Segment,
  TranscriptUpload,
  UpdateMeetingRequest,
  UploadUrlRequest,
} from './meeting';
import { AuthorizeDeviceRequest, DeviceTokenRequest } from './device';

describe('status machine', () => {
  it('lets a Mac recording skip transcription', () => {
    expect(canTransition('recording', 'summarizing')).toBe(true);
  });
  it('sends uploads through transcription', () => {
    expect(canTransition('uploaded', 'transcribing')).toBe(true);
    expect(canTransition('transcribing', 'summarizing')).toBe(true);
  });
  it('allows reprocessing a ready or failed meeting', () => {
    expect(canTransition('ready', 'summarizing')).toBe(true);
    expect(canTransition('failed', 'transcribing')).toBe(true);
  });
  it('rejects going backwards', () => {
    expect(canTransition('ready', 'recording')).toBe(false);
    expect(canTransition('summarizing', 'transcribing')).toBe(false);
  });
});

describe('Segment', () => {
  it('accepts a normal phrase and trims it', () => {
    const s = Segment.parse({ speaker: ' You ', startMs: 0, endMs: 1200, text: ' hi ' });
    expect(s).toEqual({ speaker: 'You', startMs: 0, endMs: 1200, text: 'hi' });
  });
  it('rejects an end before the start', () => {
    expect(Segment.safeParse({ speaker: 'A', startMs: 500, endMs: 100, text: 'x' }).success).toBe(false);
  });
  it('rejects empty text', () => {
    expect(Segment.safeParse({ speaker: 'A', startMs: 0, endMs: 1, text: '   ' }).success).toBe(false);
  });
});

describe('requests', () => {
  it('needs at least one segment in a transcript', () => {
    expect(TranscriptUpload.safeParse({ segments: [] }).success).toBe(false);
  });
  it('does not let clients create demo meetings', () => {
    expect(CreateMeetingRequest.safeParse({ source: 'demo' }).success).toBe(false);
    expect(CreateMeetingRequest.parse({ source: 'macos' }).source).toBe('macos');
  });
  it('caps audio size and type', () => {
    expect(UploadUrlRequest.safeParse({ contentType: 'audio/mp4', sizeBytes: MAX_AUDIO_BYTES + 1 }).success).toBe(false);
    expect(UploadUrlRequest.safeParse({ contentType: 'video/mp4', sizeBytes: 10 }).success).toBe(false);
    expect(UploadUrlRequest.safeParse({ contentType: 'audio/webm', sizeBytes: 10 }).success).toBe(true);
  });
  it('requires something to update', () => {
    expect(UpdateMeetingRequest.safeParse({}).success).toBe(false);
    expect(UpdateMeetingRequest.safeParse({ title: 'New' }).success).toBe(true);
    expect(UpdateMeetingRequest.safeParse({ actionItem: { id: 'a', done: true } }).success).toBe(true);
  });
  it('coerces and bounds the page size', () => {
    expect(ListMeetingsQuery.parse({ limit: '5' }).limit).toBe(5);
    expect(ListMeetingsQuery.parse({}).limit).toBe(20);
    expect(ListMeetingsQuery.safeParse({ limit: '500' }).success).toBe(false);
  });
  it('validates PKCE values', () => {
    const challenge = 'a'.repeat(43);
    expect(AuthorizeDeviceRequest.safeParse({ codeChallenge: challenge, deviceName: 'MacBook' }).success).toBe(true);
    expect(AuthorizeDeviceRequest.safeParse({ codeChallenge: 'short', deviceName: 'MacBook' }).success).toBe(false);
    expect(DeviceTokenRequest.safeParse({ code: 'c', codeVerifier: 'has space'.padEnd(50, 'x') }).success).toBe(false);
  });
});

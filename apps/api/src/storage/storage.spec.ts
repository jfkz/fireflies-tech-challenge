import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { testConfig } from '../testing/fixtures';
import { audioExtension, audioKey, meetingPrefix, summaryKey, transcriptKey } from './keys';
import { StorageService } from './storage.service';

describe('object keys', () => {
  it('keeps everything of a meeting under one prefix', () => {
    expect(meetingPrefix('u', 'm')).toBe('users/u/meetings/m/');
    expect(audioKey('u', 'm', 'audio/x-m4a')).toBe('users/u/meetings/m/audio.m4a');
    expect(audioKey('u', 'm', 'audio/mpeg')).toBe('users/u/meetings/m/audio.mp3');
    expect(audioExtension('audio/unknown')).toBe('bin');
    expect(transcriptKey('u', 'm')).toBe('users/u/meetings/m/transcript.json');
    expect(summaryKey('u', 'm', new Date('2026-10-06T14:05:00.123Z'))).toBe('users/u/meetings/m/summary-2026-10-06T14-05-00-123Z.json');
  });
});

describe('StorageService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('presigns PUT and GET against the public endpoint when one is set', async () => {
    const s = new StorageService(testConfig({ R2_PUBLIC_ENDPOINT: 'http://localhost:9100' }));
    const put = new URL(await s.presignPut('users/u/meetings/m/audio.m4a', 'audio/mp4'));
    expect(put.origin).toBe('http://localhost:9100');
    expect(put.pathname).toBe('/bucket/users/u/meetings/m/audio.m4a');
    expect(put.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(put.searchParams.get('X-Amz-SignedHeaders')).toContain('host');
    const get = new URL(await s.presignGet('k'));
    expect(get.searchParams.get('X-Amz-Expires')).toBe('3600');
    s.onApplicationShutdown();
  });

  it('presigns against the main endpoint by default', async () => {
    const s = new StorageService(testConfig());
    expect(new URL(await s.presignGet('k')).origin).toBe('http://storage.internal:9000');
  });

  it('writes JSON, reads bytes and heads objects', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    const s = new StorageService(testConfig());

    send.mockResolvedValueOnce({} as never);
    await s.putJson('k.json', { a: 1 });
    const put = send.mock.calls[0][0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: 'bucket', Key: 'k.json', Body: '{"a":1}', ContentType: 'application/json' });

    send.mockResolvedValueOnce({ Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2])) } } as never);
    await expect(s.getBytes('a')).resolves.toEqual(new Uint8Array([1, 2]));
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    send.mockResolvedValueOnce({} as never);
    await expect(s.getBytes('a')).rejects.toThrow('Empty object');

    send.mockResolvedValueOnce({ ContentLength: 5, ContentType: 'audio/mp4' } as never);
    await expect(s.head('a')).resolves.toEqual({ size: 5, contentType: 'audio/mp4' });
    expect(send.mock.calls[3][0]).toBeInstanceOf(HeadObjectCommand);
    send.mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFound' }));
    await expect(s.head('a')).resolves.toBeNull();
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } }));
    await expect(s.head('a')).resolves.toBeNull();
    send.mockRejectedValueOnce(new Error('network'));
    await expect(s.head('a')).rejects.toThrow('network');
  });

  it('keeps an environment inside its R2_KEY_PREFIX', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    const s = new StorageService(testConfig({ R2_KEY_PREFIX: 'prod/' }));
    expect(new URL(await s.presignPut('users/u/a.m4a', 'audio/mp4')).pathname).toBe('/bucket/prod/users/u/a.m4a');
    expect(new URL(await s.presignGet('users/u/a.m4a')).pathname).toBe('/bucket/prod/users/u/a.m4a');

    send.mockResolvedValueOnce({} as never);
    await s.putJson('k.json', {});
    expect((send.mock.calls[0][0] as PutObjectCommand).input.Key).toBe('prod/k.json');
    send.mockResolvedValueOnce({ ContentLength: 1 } as never);
    await s.head('a');
    expect((send.mock.calls[1][0] as HeadObjectCommand).input.Key).toBe('prod/a');
    send.mockResolvedValueOnce({ Body: { transformToByteArray: () => Promise.resolve(new Uint8Array()) } } as never);
    await s.getBytes('a');
    expect((send.mock.calls[2][0] as GetObjectCommand).input.Key).toBe('prod/a');

    // Listed keys already carry the prefix and are deleted as listed, never prefixed twice.
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'prod/p/a' }], IsTruncated: false } as never)
      .mockResolvedValueOnce({} as never);
    await s.deletePrefix('p/');
    expect((send.mock.calls[3][0] as ListObjectsV2Command).input.Prefix).toBe('prod/p/');
    expect((send.mock.calls[4][0] as DeleteObjectsCommand).input.Delete?.Objects).toEqual([{ Key: 'prod/p/a' }]);
  });

  it('deletes a prefix page by page', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/a' }, { Key: 'p/b' }], IsTruncated: true, NextContinuationToken: 't' } as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/c' }, {}], IsTruncated: false } as never)
      .mockResolvedValueOnce({} as never);
    const s = new StorageService(testConfig());
    await expect(s.deletePrefix('p/')).resolves.toBe(3);
    const calls = send.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBeInstanceOf(ListObjectsV2Command);
    expect((calls[2] as ListObjectsV2Command).input.ContinuationToken).toBe('t');
    expect((calls[3] as DeleteObjectsCommand).input.Delete?.Objects).toEqual([{ Key: 'p/c' }]);

    send.mockResolvedValueOnce({ Contents: [], IsTruncated: false } as never);
    await expect(s.deletePrefix('empty/')).resolves.toBe(0);
  });
});

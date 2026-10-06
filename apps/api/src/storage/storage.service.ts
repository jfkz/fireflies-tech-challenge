import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config/config.module';

export const UPLOAD_URL_TTL_SEC = 15 * 60;
export const AUDIO_URL_TTL_SEC = 60 * 60;

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
}

/**
 * Cloudflare R2 (or MinIO locally) over the S3 API. Presigned URLs are signed
 * against R2_PUBLIC_ENDPOINT when the API reaches storage at a different address
 * than browsers do (e.g. MinIO inside docker).
 *
 * Environments share one bucket: every key is stored under R2_KEY_PREFIX
 * ("prod/", "dev/"). Callers and the database only ever see keys without it.
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  readonly bucket: string;
  private readonly prefix: string;
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(config: AppConfig) {
    const { env } = config;
    this.bucket = env.R2_BUCKET;
    this.prefix = env.R2_KEY_PREFIX;
    const base: S3ClientConfig = {
      region: env.R2_REGION,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      forcePathStyle: true,
      // R2 rejects the newer default CRC checksums on presigned PUTs from browsers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    this.client = new S3Client({ ...base, endpoint: env.R2_ENDPOINT });
    this.signer = env.R2_PUBLIC_ENDPOINT ? new S3Client({ ...base, endpoint: env.R2_PUBLIC_ENDPOINT }) : this.client;
  }

  presignPut(key: string, contentType: string): Promise<string> {
    return getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), ContentType: contentType }), {
      expiresIn: UPLOAD_URL_TTL_SEC,
    });
  }

  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }), {
      expiresIn: AUDIO_URL_TTL_SEC,
    });
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: JSON.stringify(value),
        ContentType: 'application/json',
      }),
    );
  }

  /** Metadata of an object, or null when it does not exist. */
  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getBytes(key: string): Promise<Uint8Array> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
    if (!out.Body) throw new Error(`Empty object ${key}`);
    return out.Body.transformToByteArray();
  }

  /** Deletes every object under a prefix; returns how many were removed. */
  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.key(prefix), ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }

  private key(key: string): string {
    return this.prefix + key;
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    if (this.signer !== this.client) this.signer.destroy();
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

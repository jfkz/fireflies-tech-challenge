// Uploads one file to R2 with the S3 SDK the API already depends on: publish.ps1's fallback
// when the AWS CLI isn't installed (needs `pnpm install` at the repo root).
//
//   node scripts/r2-put.mjs <file> <bucket> <key> <content-type> <max-age seconds>
//
// Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
import { createReadStream, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../api/package.json', import.meta.url)));
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const [file, bucket, key, contentType, maxAge] = process.argv.slice(2);
if (!file || !bucket || !key || !contentType || !/^\d+$/.test(maxAge ?? '')) {
  console.error('usage: r2-put.mjs <file> <bucket> <key> <content-type> <max-age seconds>');
  process.exit(2);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
await s3.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(file),
    ContentLength: statSync(file).size,
    ContentType: contentType,
    CacheControl: `public, max-age=${maxAge}`,
  }),
);

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { DeviceTokenResponse } from './device';
import { MeetingDetail, MeetingPage, TranscriptUpload, UploadUrlResponse } from './meeting';
import { ProblemReportRequest, ProblemReportResponse } from './report';
import { ApiError, LatestDownload } from './user';

const dir = join(__dirname, '..', 'fixtures');

const schemas: Record<string, z.ZodType> = {
  'created-meeting.json': MeetingDetail,
  'device-token-response.json': DeviceTokenResponse,
  'error-400.json': ApiError,
  'latest-windows.json': LatestDownload,
  'meeting-page.json': MeetingPage,
  'problem-report-request.json': ProblemReportRequest,
  'problem-report-response.json': ProblemReportResponse,
  'transcript-upload.json': TranscriptUpload,
  'upload-url-response.json': UploadUrlResponse,
};

describe('contract fixtures', () => {
  it('has a schema for every fixture', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual(Object.keys(schemas).sort());
  });

  it.each(Object.entries(schemas))('%s matches its schema', (file, schema) => {
    const result = schema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    expect(result.error?.issues ?? []).toEqual([]);
  });
});

import { z } from 'zod';

export const Me = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  name: z.string().nullable(),
  emailOnReady: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Me = z.infer<typeof Me>;

export const UpdateSettingsRequest = z.object({
  emailOnReady: z.boolean(),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

/** `latest.json` next to the DMGs, and the body of `GET /downloads/latest`. */
export const LatestDownload = z.object({
  version: z.string(),
  build: z.string(),
  url: z.string().url(),
  sizeBytes: z.number().int().nonnegative(),
  minimumOs: z.string(),
  notarized: z.boolean(),
  publishedAt: z.string().datetime(),
});
export type LatestDownload = z.infer<typeof LatestDownload>;

export const ApiError = z.object({
  statusCode: z.number().int(),
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

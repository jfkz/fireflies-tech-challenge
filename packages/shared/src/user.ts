import { z } from 'zod';

export const Me = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  name: z.string().nullable(),
  emailOnReady: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Me = z.infer<typeof Me>;

export const UpdateSettingsRequest = z
  .object({
    emailOnReady: z.boolean().optional(),
    /** How transcripts should call the person recording (speaker "You"). */
    name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => v.emailOnReady !== undefined || v.name !== undefined, { message: 'Nothing to update' });
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

/** The desktop apps we build. */
export const DownloadPlatform = z.enum(['macos', 'windows']);
export type DownloadPlatform = z.infer<typeof DownloadPlatform>;

/**
 * One published desktop build: `latest.json` (Mac) or `latest-windows.json`
 * next to the installers, and the body of `GET /downloads/latest[/:platform]`.
 */
export const LatestDownload = z.object({
  /** Missing in manifests published before the Windows app existed, which are all Mac builds. */
  platform: DownloadPlatform.default('macos'),
  version: z.string(),
  build: z.string(),
  url: z.string().url(),
  sizeBytes: z.number().int().nonnegative(),
  minimumOs: z.string(),
  /** Opens without an OS warning: notarized by Apple, or code-signed on Windows. */
  notarized: z.boolean(),
  publishedAt: z.string().datetime(),
});
export type LatestDownload = z.infer<typeof LatestDownload>;

/** `GET /downloads`: the latest build for each platform, `null` until one ships. */
export const Downloads = z.object({
  macos: LatestDownload.nullable(),
  windows: LatestDownload.nullable(),
});
export type Downloads = z.infer<typeof Downloads>;

export const ApiError = z.object({
  statusCode: z.number().int(),
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

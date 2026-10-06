import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const flag = z
  .enum(['0', '1', 'true', 'false', ''])
  .optional()
  .transform((v) => v === '1' || v === 'true');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    APP_VERSION: z.string().default('0.0.0-dev'),
    GIT_SHA: z.string().default('unknown'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    QUEUE_PREFIX: z.string().default('bt'),

    WEB_URL: z.string().url().default('http://localhost:3000'),
    WEB_ORIGINS: csv,

    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),

    R2_ENDPOINT: z.string().url(),
    R2_PUBLIC_ENDPOINT: z.string().url().optional(),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    /** Environments share one bucket; "prod/" or "dev/". Empty locally. */
    R2_KEY_PREFIX: z
      .string()
      .regex(/^([a-z0-9-]+\/)?$/, 'R2_KEY_PREFIX must be empty or like "prod/"')
      .default(''),
    R2_REGION: z.string().default('auto'),

    DOWNLOADS_BASE_URL: z.string().url().default('https://download.boringtalks.lol'),

    AI_GATEWAY_API_KEY: z.string().optional(),
    SUMMARY_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
    TRANSCRIBE_MODEL: z.string().default('openai/whisper-1'),
    AI_FAKE: flag,
    SUMMARIZE_CONCURRENCY: z.coerce.number().int().positive().default(4),
    TRANSCRIBE_CONCURRENCY: z.coerce.number().int().positive().default(2),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('BoringTalks <hello@send.boringtalks.lol>'),
    EMAIL_ALLOWLIST: csv,

    /** Recall.ai meeting bots; without a key the feature is off. */
    RECALL_API_KEY: z.string().optional(),
    /** The region the Recall.ai account lives in. */
    RECALL_BASE_URL: z.string().url().default('https://us-west-2.recall.ai'),
    /** "whsec_…" from Recall's dashboard (Developers → API keys & secrets); webhooks are refused without it. */
    RECALL_WEBHOOK_SECRET: z.string().optional(),
    RECALL_BOT_NAME: z.string().default('BoringTalks Notetaker'),

    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  })
  .superRefine((env, ctx) => {
    if (env.AI_FAKE && env.NODE_ENV !== 'test') {
      ctx.addIssue({ code: 'custom', path: ['AI_FAKE'], message: 'AI_FAKE is only allowed when NODE_ENV=test' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parses the environment or throws one readable error listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** The Firebase emulator is honoured only outside production. */
export function emulatorEnabled(env: Pick<Env, 'FIREBASE_AUTH_EMULATOR_HOST' | 'NODE_ENV'>): boolean {
  return Boolean(env.FIREBASE_AUTH_EMULATOR_HOST) && env.NODE_ENV !== 'production';
}

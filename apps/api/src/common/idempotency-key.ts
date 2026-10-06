import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { validationError } from './zod.pipe';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** 1–200 printable ASCII characters, no leading or trailing space. */
const IdempotencyKeySchema = z
  .string()
  .max(200, 'Idempotency-Key must be at most 200 characters')
  .regex(/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/, 'Idempotency-Key must be printable ASCII');

/** Returns the validated key, undefined when absent; throws a 400 ApiError when invalid. */
export function parseIdempotencyKey(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const result = IdempotencyKeySchema.safeParse(Array.isArray(raw) ? raw.join(',') : raw);
  if (!result.success) throw validationError(result.error.issues.map((i) => ({ path: IDEMPOTENCY_HEADER, message: i.message })));
  return result.data;
}

/** The request's optional `Idempotency-Key` header, validated. */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined =>
  parseIdempotencyKey(ctx.switchToHttp().getRequest<Request>().headers['idempotency-key']),
);
